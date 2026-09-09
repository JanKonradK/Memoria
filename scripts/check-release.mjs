/* global window, document */
import { chromium, expect } from '@playwright/test';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { cpSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isolateLauncherPort } from './launcher-test-support.mjs';
const root = resolve(import.meta.dirname, '..');
const scratch = join(root, 'dist/security-browser', String(Date.now()));
const install = join(scratch, 'install');
const appdata = join(scratch, 'data');
mkdirSync(scratch, { recursive: true });
cpSync(join(root, 'dist/release/Memoria'), install, { recursive: true });
// The built app accepts only these launcher origins. Skip any occupied port in
// the test copy, while the shipped launcher retains its identity checks.
await isolateLauncherPort(join(install, 'desktop/memoria.mjs'), [17817, 17818, 17819]);
const stateFile = join(appdata, 'memoria/state.json');
const exe = join(install, 'node/node.exe');
const args = [join(install, 'desktop/memoria.mjs')];
const options = {
  cwd: install,
  windowsHide: true,
  env: { ...process.env, APPDATA: appdata, MEMORIA_NO_BROWSER: '1', MEMORIA_NO_UPDATE: '1' },
};
const child = spawn(exe, args, options);
let browser;
const errors = [];
const matchUrl = (text) => text.match(/http:\/\/127\.0\.0\.1:\d+\/api\/launch\/[A-Za-z0-9_-]{43}/)?.[0];
try {
  const url = await new Promise((resolve, reject) => {
    let text = '';
    child.once('error', reject);
    child.once('exit', () => reject(new Error(`Test launcher exited early: ${errors.join('')}`)));
    child.stdout.on('data', (chunk) => {
      text += chunk;
      const url = matchUrl(text);
      if (url) resolve(url);
    });
    child.stderr.on('data', (chunk) => {
      errors.push(String(chunk));
    });
  });
  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  await context.addInitScript(() => {
    localStorage.setItem('memoria-onboarding', 'complete');
    window.auditCsp = [];
    document.addEventListener('securitypolicyviolation', (event) =>
      window.auditCsp.push({
        directive: event.violatedDirective,
        blocked: event.blockedURI.startsWith('data:') ? 'data:' : event.blockedURI,
        sample: event.sample,
        line: event.lineNumber,
      }),
    );
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(url);
  await page.getByRole('button', { name: 'Add your first game' }).click();
  await page.getByRole('button', { name: /Genshin Impact/ }).click();
  await page.getByRole('button', { name: 'Add Genshin', exact: true }).click();
  await expect
    .poll(() => (existsSync(stateFile) ? JSON.parse(readFileSync(stateFile)).games.length : 0), { timeout: 20_000 })
    .toBe(1);
  expect(await page.evaluate(() => window.auditCsp)).toEqual([]);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Genshin Impact', exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.auditCsp)).toEqual([]);
  const secondLaunch = await promisify(execFile)(exe, args, options);
  const secondUrl = matchUrl(secondLaunch.stdout);
  expect(new URL(secondUrl).origin).toBe(new URL(url).origin);
  const second = await context.newPage();
  second.on('pageerror', (error) => errors.push(error.message));
  await second.goto(secondUrl);
  await expect(second.getByRole('heading', { name: 'Genshin Impact', exact: true })).toBeVisible();
  const state = JSON.parse(readFileSync(stateFile));
  state.games[0].name = 'Audit sync check';
  state.games[0].updatedAt = Date.now();
  writeFileSync(stateFile, JSON.stringify(state));
  await expect(page.getByRole('heading', { name: 'Audit sync check', exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(second.getByRole('heading', { name: 'Audit sync check', exact: true })).toBeVisible({ timeout: 15_000 });
  expect(await second.evaluate(() => window.auditCsp)).toEqual([]);
  await page.screenshot({ path: join(root, 'dist/security-desktop.png') });
  await context.close();
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
  await standalone.getByRole('button', { name: 'Add your first game' }).click();
  await standalone.getByRole('button', { name: /Genshin Impact/ }).click();
  await standalone.getByRole('button', { name: 'Add Genshin', exact: true }).click();
  await expect(standalone.getByRole('heading', { name: 'Genshin Impact', exact: true })).toBeVisible();
  // Wait for the debounced local write before reload.
  await standalone.waitForTimeout(300);
  await standalone.reload();
  await expect(standalone.getByRole('heading', { name: 'Genshin Impact', exact: true })).toBeVisible();
  expect(requests).toEqual([]);
  expect(errors).toEqual([]);
  console.log(
    JSON.stringify({
      desktop: 'PASS: launch, add game, disk sync, reload, second launch, live events, CSP',
      singleFile: 'PASS: add game, reload, no HTTP requests',
      runtime: (await promisify(execFile)(exe, ['--version'])).stdout.trim(),
    }),
  );
} finally {
  await browser?.close();
  if (child.exitCode === null) {
    const exited = once(child, 'exit');
    child.kill();
    await exited;
  }
}
