// Checks the downloads before they are published: the Windows zip holds the
// program and nothing it should not, and the one-file HTML works offline.
// The Windows program itself is exercised by check-native.mjs.
import { chromium, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

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
  'Memoria/desktop/Enable-Phone-Sync.ps1',
  'Memoria/desktop/memoria.ico',
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

const browser = await chromium.launch();
const errors = [];
try {
  const standaloneContext = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    reducedMotion: 'reduce',
  });
  await standaloneContext.addInitScript(() => localStorage.setItem('memoria-onboarding', 'complete'));
  const standalone = await standaloneContext.newPage();
  const requests = [];
  standalone.on('pageerror', (error) => errors.push(error.message));
  standalone.on('request', (request) => {
    if (/^https?:/.test(request.url())) requests.push(request.url());
  });
  await standalone.goto(pathToFileURL(join(root, 'app/dist-single/Memoria.html')).href);
  await standalone.getByRole('button', { name: 'Add a game' }).click();
  await standalone.getByRole('button', { name: /Genshin Impact/ }).click();
  await standalone.getByRole('button', { name: 'Add Genshin', exact: true }).click();
  await standalone.getByRole('button', { name: 'Review Genshin Impact', exact: true }).click();
  await expect(standalone.getByRole('heading', { name: 'Genshin Impact', exact: true })).toBeVisible();
  // Wait for the debounced local write before reload.
  await standalone.waitForTimeout(300);
  await standalone.reload();
  await standalone.getByRole('button', { name: 'Review Genshin Impact', exact: true }).click();
  await expect(standalone.getByRole('heading', { name: 'Genshin Impact', exact: true })).toBeVisible();
  expect(requests).toEqual([]);
  expect(errors).toEqual([]);
  console.log(
    JSON.stringify({
      windowsZip: `PASS: ${entries.length} files, release ${record.version}, checksum listed`,
      singleFile: 'PASS: add game, reload, no HTTP requests',
    }),
  );
} finally {
  await browser.close();
}
