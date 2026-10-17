import { describe, expect, it } from 'vitest';
import { compareVersions, releaseChanges, releaseNotes } from '../src/app-update';

describe('app updates', () => {
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
