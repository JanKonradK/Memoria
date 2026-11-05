import { ed25519 } from '@noble/curves/ed25519.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { describe, expect, it, vi } from 'vitest';
import {
  compareVersions,
  displayVersion,
  releaseChanges,
  releaseNotes,
  checkForUpdates,
  useAppUpdate,
} from '../src/app-update';

vi.mock('@memoria/shared/publisher', async (original) => {
  const actual = await original<typeof import('@memoria/shared/publisher')>();
  return {
    ...actual,
    verifyPublished: (
      file: unknown,
      context: string,
      previous: import('@memoria/shared/publisher').TrustStamp | null,
    ) => actual.verifyPublished(file, context, previous, bytesToHex(ed25519.getPublicKey(new Uint8Array(32).fill(42)))),
  };
});

describe('app updates', () => {
  it('shows versions as betas with a 0. in front, while ordering keeps the real numbers', () => {
    expect(displayVersion('3.3.0')).toBe('Beta 0.3.3');
    expect(displayVersion('v3.0.1')).toBe('Beta 0.3.0.1');
    expect(displayVersion('3.4.0-rc.1')).toBe('Beta 0.3.4-rc.1');
    expect(compareVersions('3.3.0', '3.2.0')).toBeGreaterThan(0);
  });

  it('orders versions numerically and treats a prerelease as older', () => {
    expect(compareVersions('3.10.0', '3.9.9')).toBe(1);
    expect(compareVersions('v3.1.0', '3.1.0')).toBe(0);
    expect(compareVersions('3.1.0-beta.1', '3.1.0')).toBe(-1);
    expect(compareVersions('3.0.1', '3.1.0')).toBe(-1);
  });

  it('shows only the notes above the download table', () => {
    const release = {
      version: '3.1.0',
      tag: 'v3.1.0',
      name: 'Memoria v3.1.0',
      notes: '# Memoria 3.1.0\n\n- Updates itself\n\n## Download\n\n| a | b |',
      url: '',
      publishedAt: null,
      assets: [],
    };
    expect(releaseNotes(release)).toBe('# Memoria 3.1.0\n\n- Updates itself');
    expect(releaseNotes({ ...release, notes: '## Downloads\n\n- zip' })).toBe('');
  });

  it('lists every newer version, falling back to the latest release alone', () => {
    const release = {
      version: '3.2.0',
      tag: 'v3.2.0',
      name: 'Memoria v3.2.0',
      notes: '- Two\n\n## Downloads\n\n| a |',
      url: '',
      publishedAt: null,
      assets: [],
    };
    expect(releaseChanges(release)).toEqual([{ ...release, notes: '- Two' }]);
    const changes = [
      { version: '3.2.0', notes: '- Two\n## Downloads', publishedAt: null },
      { version: '3.1.1', notes: '- One', publishedAt: null },
    ];
    expect(releaseChanges({ ...release, changes }).map((change) => [change.version, change.notes])).toEqual([
      ['3.2.0', '- Two'],
      ['3.1.1', '- One'],
    ]);
  });
});

it('rejects unsigned, altered and replayed releases before offering the update', async () => {
  localStorage.clear();
  const secret = new Uint8Array(32).fill(42);
  const sequence = Date.now();
  const sign = (sequence: number) => {
    const bytes = new TextEncoder().encode(
      JSON.stringify({
        context: 'memoria-release-v1',
        sequence,
        data: { version: '4.1.0', tag: 'v4.1.0', files: {}, windows: {} },
      }),
    );
    return { payload: btoa(String.fromCharCode(...bytes)), signature: bytesToHex(ed25519.sign(bytes, secret)) };
  };
  let file: unknown = sign(sequence);
  const request = vi.spyOn(globalThis, 'fetch').mockImplementation(
    async (url) =>
      new Response(
        JSON.stringify(
          String(url).includes('api.github.com')
            ? [
                {
                  tag_name: 'v4.1.0',
                  body: `<!-- memoria-signed-release ${JSON.stringify(file)} -->`,
                  assets: [{ name: 'release-manifest.json', browser_download_url: 'https://example.test/manifest' }],
                },
              ]
            : file,
        ),
      ),
  );
  try {
    await checkForUpdates();
    expect(useAppUpdate.getState().status).toBe('available');
    expect(request).toHaveBeenCalledTimes(1);
    for (const bad of [{}, { ...sign(sequence), signature: '00'.repeat(64) }, sign(sequence - 1)]) {
      file = bad;
      await checkForUpdates();
      expect(useAppUpdate.getState().status).toBe('error');
      expect(useAppUpdate.getState().error).toMatch(/signature|older/);
    }
  } finally {
    request.mockRestore();
    localStorage.clear();
  }
});
