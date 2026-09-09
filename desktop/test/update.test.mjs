// The updater decides, unattended, whether to overwrite the user's install.
// These cover the two ways that goes wrong quietly: mis-ordering versions so a
// build never updates (or downgrades itself), and applying a tree when it
// should not have.
//
// update.mjs resolves its state directory from APPDATA at import time, so every
// test imports a fresh copy of the module against its own scratch APPDATA.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import os from 'node:os';

let scratch;
let installRoot;
const originalAppData = process.env['APPDATA'];

/** A fresh update.mjs bound to this test's APPDATA. */
async function loadUpdater() {
  process.env['APPDATA'] = scratch;
  // Dropping the module registry forces update.mjs to re-read APPDATA, which it
  // resolves once at import time.
  vi.resetModules();
  return import('../update.mjs');
}

function writeRelease(root, version) {
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'release.json'), JSON.stringify({ name: 'Memoria', version, tag: `v${version}` }));
}

/** `files` keys may be nested paths ('app/dist/assets/index.js'), like a real release tree. */
function stagePending(version, files) {
  const pending = join(scratch, 'memoria', 'updates', 'pending');
  mkdirSync(pending, { recursive: true });
  writeRelease(pending, version);
  for (const [name, content] of Object.entries(files)) {
    const file = join(pending, name);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
  writeFileSync(
    join(scratch, 'memoria', 'updates', 'pending.json'),
    JSON.stringify({ version, tag: `v${version}`, stagedAt: new Date().toISOString() }),
  );
  return pending;
}

beforeEach(() => {
  scratch = join(os.tmpdir(), `memoria-update-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  installRoot = join(scratch, 'install');
  mkdirSync(installRoot, { recursive: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalAppData === undefined) delete process.env['APPDATA'];
  else process.env['APPDATA'] = originalAppData;
  rmSync(scratch, { recursive: true, force: true });
});

describe('bounded update downloads', () => {
  it('streams a valid download to disk', async () => {
    const { downloadTo } = await loadUpdater();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('verified bytes')),
    );
    const file = join(scratch, 'download.bin');
    await downloadTo('https://example.invalid/download', file, 20);
    expect(readFileSync(file, 'utf8')).toBe('verified bytes');
  });

  it('stops a chunked oversized body and removes the incomplete file', async () => {
    const { downloadTo } = await loadUpdater();
    const cancelled = vi.fn();
    const body = new ReadableStream({
      pull(controller) {
        controller.enqueue(new Uint8Array(8));
      },
      cancel: cancelled,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(body)),
    );
    const file = join(scratch, 'download.bin');
    await expect(downloadTo('https://example.invalid/download', file, 10)).rejects.toThrow(/size ceiling/);
    expect(existsSync(file)).toBe(false);
    expect(cancelled).toHaveBeenCalled();
  });

  it('rejects an oversized declared length before creating a destination', async () => {
    const { downloadTo } = await loadUpdater();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('small', { headers: { 'content-length': '1000' } })),
    );
    const file = join(scratch, 'download.bin');
    await expect(downloadTo('https://example.invalid/download', file, 10)).rejects.toThrow(/size ceiling/);
    expect(existsSync(file)).toBe(false);
  });
});

describe('compareVersions', () => {
  it('orders release versions numerically, not as strings', async () => {
    const { compareVersions } = await loadUpdater();
    // The one that a lexical sort gets backwards, and the reason this is tested
    // at all: 0.9.0 must never look newer than 0.10.0.
    expect(compareVersions('0.10.0', '0.9.0')).toBe(1);
    expect(compareVersions('0.9.0', '0.10.0')).toBe(-1);
    expect(compareVersions('1.2.10', '1.2.9')).toBe(1);
    expect(compareVersions('2.0.0', '1.99.99')).toBe(1);
  });

  it('ignores a leading v and treats equal versions as equal', async () => {
    const { compareVersions } = await loadUpdater();
    expect(compareVersions('v1.2.3', '1.2.3')).toBe(0);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
  });

  it('sorts a prerelease below the finished version of the same number', async () => {
    const { compareVersions } = await loadUpdater();
    expect(compareVersions('1.0.0', '1.0.0-beta.1')).toBe(1);
    expect(compareVersions('1.0.0-beta.1', '1.0.0')).toBe(-1);
    expect(compareVersions('1.0.0-beta.2', '1.0.0-beta.1')).toBe(1);
  });
});

describe('isPackagedInstall', () => {
  it('is false for a source checkout, which has no release.json', async () => {
    const { isPackagedInstall } = await loadUpdater();
    expect(isPackagedInstall(installRoot)).toBe(false);
  });

  it('is true once a release record is present', async () => {
    writeRelease(installRoot, '0.1.0');
    const { isPackagedInstall } = await loadUpdater();
    expect(isPackagedInstall(installRoot)).toBe(true);
  });
});

describe('applyPendingUpdate', () => {
  it('refuses to touch a source checkout even with an update staged', async () => {
    stagePending('9.9.9', { 'README.txt': 'from the update' });
    const { applyPendingUpdate } = await loadUpdater();

    const result = applyPendingUpdate(installRoot);

    expect(result.applied).toBe(false);
    // A developer's working tree must survive a stray staged download.
    expect(existsSync(join(installRoot, 'README.txt'))).toBe(false);
  });

  it('replaces the install with a newer staged build and clears the staging area', async () => {
    writeRelease(installRoot, '0.1.0');
    writeFileSync(join(installRoot, 'README.txt'), 'from 0.1.0');
    stagePending('0.2.0', { 'README.txt': 'from 0.2.0', 'added.txt': 'new in 0.2.0' });
    const { applyPendingUpdate } = await loadUpdater();

    const result = applyPendingUpdate(installRoot);

    expect(result.applied).toBe(true);
    expect(result.version).toBe('0.2.0');
    expect(readFileSync(join(installRoot, 'README.txt'), 'utf8')).toBe('from 0.2.0');
    expect(readFileSync(join(installRoot, 'added.txt'), 'utf8')).toBe('new in 0.2.0');
    expect(JSON.parse(readFileSync(join(installRoot, 'release.json'), 'utf8')).version).toBe('0.2.0');
    expect(existsSync(join(scratch, 'memoria', 'updates', 'pending'))).toBe(false);
  });

  it('never downgrades, and discards a stale staged tree', async () => {
    writeRelease(installRoot, '0.3.0');
    writeFileSync(join(installRoot, 'README.txt'), 'from 0.3.0');
    stagePending('0.2.0', { 'README.txt': 'from 0.2.0' });
    const { applyPendingUpdate } = await loadUpdater();

    const result = applyPendingUpdate(installRoot);

    expect(result.applied).toBe(false);
    expect(readFileSync(join(installRoot, 'README.txt'), 'utf8')).toBe('from 0.3.0');
    // The stale tree is cleared, or it would be reconsidered on every launch.
    expect(existsSync(join(scratch, 'memoria', 'updates', 'pending'))).toBe(false);
    // The manifest goes with it: one left behind points at a tree that is gone.
    expect(existsSync(join(scratch, 'memoria', 'updates', 'pending.json'))).toBe(false);
  });

  it('carries nested directories across, which is the whole shape of a release tree', async () => {
    writeRelease(installRoot, '0.1.0');
    mkdirSync(join(installRoot, 'app', 'dist', 'assets'), { recursive: true });
    writeFileSync(join(installRoot, 'app', 'dist', 'assets', 'index.js'), 'old bundle');
    stagePending('0.2.0', {
      'app/dist/index.html': 'new page',
      'app/dist/assets/index.js': 'new bundle',
      'desktop/dist/shared-core.mjs': 'new core',
    });
    const { applyPendingUpdate } = await loadUpdater();

    const result = applyPendingUpdate(installRoot);

    expect(result.applied).toBe(true);
    // release.json plus the three nested files — a walk that stopped at the top
    // level would report 1 and ship a build with no app in it.
    expect(result.files).toBe(4);
    expect(readFileSync(join(installRoot, 'app', 'dist', 'assets', 'index.js'), 'utf8')).toBe('new bundle');
    expect(readFileSync(join(installRoot, 'app', 'dist', 'index.html'), 'utf8')).toBe('new page');
    expect(readFileSync(join(installRoot, 'desktop', 'dist', 'shared-core.mjs'), 'utf8')).toBe('new core');
  });

  it('leaves no half-swapped staging files behind on success', async () => {
    writeRelease(installRoot, '0.1.0');
    stagePending('0.2.0', { 'a.txt': 'a', 'b.txt': 'b' });
    const { applyPendingUpdate } = await loadUpdater();

    applyPendingUpdate(installRoot);

    expect(existsSync(join(installRoot, 'a.txt.mem-new'))).toBe(false);
    expect(existsSync(join(installRoot, 'b.txt.mem-new'))).toBe(false);
  });
});

describe('updateStatus', () => {
  it('reports a staged version only while it is genuinely newer', async () => {
    writeRelease(installRoot, '0.1.0');
    stagePending('0.2.0', {});
    const { updateStatus } = await loadUpdater();

    const status = updateStatus(installRoot);

    expect(status.packaged).toBe(true);
    expect(status.version).toBe('0.1.0');
    expect(status.pending).toBe('0.2.0');
  });

  it('reports an unpackaged checkout without inventing a version', async () => {
    const { updateStatus } = await loadUpdater();

    const status = updateStatus(installRoot);

    expect(status.packaged).toBe(false);
    expect(status.version).toBeNull();
    expect(status.pending).toBeNull();
  });
});
