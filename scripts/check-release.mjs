// Checks the download before it is published: the Windows zip holds the
// program and nothing it should not.
// The Windows program itself is exercised by check-native.mjs.
import { expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const release = join(root, 'dist/release');
const zip = join(release, 'Memoria-win-x64.zip');
// Windows' own bsdtar reads zips; a Git or MSYS tar earlier on PATH does not.
const tar = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;

// The zip: one Memoria folder with the program, the app and the install scripts.
const entries = execFileSync(tar, ['-tf', zip], { encoding: 'utf8' })
  .split(/\r?\n/)
  .filter(Boolean)
  .map((entry) => entry.replaceAll('\\', '/'));
for (const required of [
  'Memoria/Memoria.exe',
  'Memoria/release.json',
  'Memoria/app/dist/index.html',
  'Memoria/desktop/Install-Shortcut.ps1',
  'Memoria/desktop/Install-Lock.ps1',
  'Memoria/desktop/memoria.ico',
  'Memoria/desktop/browser-helper/manifest.json',
]) {
  expect(entries, `${required} is in the zip`).toContain(required);
}
expect(entries.every((entry) => entry.startsWith('Memoria/'))).toBe(true);
expect(entries.filter((entry) => /\.(map|pdb|mjs|cjs|asar)$|node_modules|electron/i.test(entry))).toEqual([]);
const record = JSON.parse(
  execFileSync(tar, ['-xOf', zip, 'Memoria/release.json'], { encoding: 'utf8' }).replace(/^\uFEFF/, ''),
);
expect(record).toMatchObject({ name: 'Memoria', version, runtime: 'tauri', platform: 'win-x64' });
const digest = createHash('sha256').update(readFileSync(zip)).digest('hex');
expect(readFileSync(join(release, 'SHA256SUMS.txt'), 'utf8')).toContain(`${digest}  Memoria-win-x64.zip`);

// The installer: built from the same tree, listed and signed beside the zip.
const setup = readFileSync(join(release, 'Memoria-setup-x64.exe'));
const setupDigest = createHash('sha256').update(setup).digest('hex');
expect(readFileSync(join(release, 'SHA256SUMS.txt'), 'utf8')).toContain(`${setupDigest}  Memoria-setup-x64.exe`);
expect(setup.subarray(0, 2).toString()).toBe('MZ');
console.log(JSON.stringify({ windowsSetup: `PASS: ${(setup.length / 1024 / 1024).toFixed(1)} MB, checksum listed` }));

console.log(
  JSON.stringify({ windowsZip: `PASS: ${entries.length} files, release ${record.version}, checksum listed` }),
);
