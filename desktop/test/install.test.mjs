import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

let scratch;
let source;
let destination;

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'memoria-install-test-'));
  source = join(scratch, 'download');
  destination = join(scratch, 'programs', 'Memoria');
  for (const directory of ['desktop', 'resources/app', 'app/dist']) {
    mkdirSync(join(source, directory), { recursive: true });
  }
  copyFileSync(resolve('desktop/Install-Shortcut.ps1'), join(source, 'desktop/Install-Shortcut.ps1'));
  for (const name of [
    'Memoria.exe',
    'resources/app/package.json',
    'desktop/electron-main.mjs',
    'app/dist/index.html',
  ]) {
    writeFileSync(join(source, name), 'test bundle');
  }
  writeFileSync(
    join(source, 'release.json'),
    JSON.stringify({ name: 'Memoria', version: '2.0.0', runtime: 'electron' }),
  );
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

function install() {
  return spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      join(source, 'desktop/Install-Shortcut.ps1'),
      '-InstallRoot',
      destination,
      '-NoShortcuts',
    ],
    { encoding: 'utf8', windowsHide: true },
  );
}

describe.skipIf(process.platform !== 'win32')('standalone Windows install', () => {
  it('installs and replaces a complete bundle without touching separate saved data', () => {
    const data = join(scratch, 'saved-data');
    mkdirSync(data);
    writeFileSync(join(data, 'state.json'), 'saved progress');
    const first = install();
    expect(first.status, first.stderr).toBe(0);
    expect(readFileSync(join(destination, 'Memoria.exe'), 'utf8')).toBe('test bundle');
    writeFileSync(join(destination, 'obsolete.txt'), 'old program file');
    writeFileSync(join(source, 'Memoria.exe'), 'new runtime');

    const second = install();
    expect(second.status, second.stderr).toBe(0);
    expect(readFileSync(join(destination, 'Memoria.exe'), 'utf8')).toBe('new runtime');
    expect(existsSync(join(destination, 'obsolete.txt'))).toBe(false);
    expect(readFileSync(join(data, 'state.json'), 'utf8')).toBe('saved progress');
  }, 30_000);

  it('refuses to replace an unrelated destination folder', () => {
    mkdirSync(destination, { recursive: true });
    writeFileSync(join(destination, 'personal.txt'), 'keep this file');
    const result = install();
    expect(result.status).not.toBe(0);
    expect(readFileSync(join(destination, 'personal.txt'), 'utf8')).toBe('keep this file');
    expect(existsSync(join(destination, 'Memoria.exe'))).toBe(false);
  }, 15_000);

  it('refuses an incomplete download before changing an installed app', () => {
    const first = install();
    expect(first.status, first.stderr).toBe(0);
    rmSync(join(source, 'desktop/electron-main.mjs'));
    writeFileSync(join(source, 'Memoria.exe'), 'incomplete replacement');
    const result = install();
    expect(result.status).not.toBe(0);
    expect(readFileSync(join(destination, 'Memoria.exe'), 'utf8')).toBe('test bundle');
  }, 20_000);

  it('refuses to replace an app whose executable is still running', async () => {
    const first = install();
    expect(first.status, first.stderr).toBe(0);
    const executable = join(destination, 'Memoria.exe');
    // A harmless Windows process exercises the actual process-path guard.
    copyFileSync(join(process.env['WINDIR'], 'System32/ping.exe'), executable);
    const before = readFileSync(executable);
    const child = spawn(executable, ['-t', '127.0.0.1'], { windowsHide: true, stdio: 'ignore' });
    try {
      await once(child, 'spawn');
      const result = install();
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('Close Memoria before');
      expect(readFileSync(executable)).toEqual(before);
    } finally {
      if (child.exitCode === null) {
        const exited = once(child, 'exit');
        child.kill();
        await exited;
      }
    }
  }, 20_000);
});
