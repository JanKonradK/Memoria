/* global window, document */
import { chromium, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { cpSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isolatedHostEnv, launchUrlFrom } from './launcher-test-support.mjs';
const root = resolve(import.meta.dirname, '..');
const scratch = join(root, 'dist/security-browser', String(Date.now()));
const install = join(scratch, 'install');
const appdata = join(scratch, 'data');
mkdirSync(scratch, { recursive: true });
cpSync(join(root, 'dist/release/Memoria'), install, { recursive: true });
const stateFile = join(appdata, 'memoria/state.json');
// The packaged Memoria.exe serves the app without a window. The built app
// accepts only its own launcher origins, so take a free one of those ports.
const exe = join(install, 'Memoria.exe');
const args = ['--headless'];
const options = {
  cwd: install,
  windowsHide: true,
  env: await isolatedHostEnv({ appdata, ports: [17817, 17818, 17819] }),
};
const child = spawn(exe, args, options);
let browser;
const errors = [];
try {
  const url = await launchUrlFrom(child);
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
  await page.getByRole('button', { name: 'Add a game' }).click();
  await page.getByRole('button', { name: /Genshin Impact/ }).click();
  await page.getByRole('button', { name: 'Add Genshin', exact: true }).click();
  await expect
    .poll(() => (existsSync(stateFile) ? JSON.parse(readFileSync(stateFile)).games.length : 0), { timeout: 20_000 })
    .toBe(1);
  expect(await page.evaluate(() => window.auditCsp)).toEqual([]);
  await page.reload();
  await page.getByRole('button', { name: 'Review Genshin Impact', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Genshin Impact', exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.auditCsp)).toEqual([]);
  // A second launch finds the running host and hands over a fresh ticket.
  const secondChild = spawn(exe, args, options);
  const secondUrl = await launchUrlFrom(secondChild);
  secondChild.kill();
  expect(new URL(secondUrl).origin).toBe(new URL(url).origin);
  const second = await context.newPage();
  second.on('pageerror', (error) => errors.push(error.message));
  await second.goto(secondUrl);
  await second.getByRole('button', { name: 'Review Genshin Impact', exact: true }).click();
  await expect(second.getByRole('heading', { name: 'Genshin Impact', exact: true })).toBeVisible();
  const state = JSON.parse(readFileSync(stateFile));
  state.games[0].name = 'Audit sync check';
  state.games[0].updatedAt = Date.now();
  writeFileSync(stateFile, JSON.stringify(state));
  await expect(page.getByRole('heading', { name: 'Audit sync check', exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(second.getByRole('heading', { name: 'Audit sync check', exact: true })).toBeVisible({ timeout: 15_000 });
  expect(await second.evaluate(() => window.auditCsp)).toEqual([]);
  await page.screenshot({ path: join(root, 'dist/security-desktop.png') });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Connect my phone or tablet', exact: true }).click();
  await expect(
    page.getByRole('img', { name: 'Scan this code with Memoria on your phone or tablet to connect' }),
  ).toBeVisible();
  await expect(page.getByText('Waiting for your device…', { exact: true })).toBeVisible();
  await expect(page.getByText('PC address', { exact: true })).not.toBeVisible();
  await page.screenshot({ path: join(root, 'dist/wifi-desktop.png') });
  await page
    .getByRole('img', { name: 'Scan this code with Memoria on your phone or tablet to connect' })
    .screenshot({ path: join(root, 'dist/wifi-code.png') });
  const wifi = await page.evaluate(async () =>
    (
      await fetch('/api/devices', {
        headers: { authorization: `Bearer ${sessionStorage.getItem('memoria-launcher-token')}` },
      })
    ).json(),
  );
  const paired = await fetch(`http://127.0.0.1:${wifi.port}/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: wifi.code, name: 'Test phone' }),
  });
  expect(paired.status).toBe(200);
  await expect(page.getByText('Device connected', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('img', { name: 'Scan this code with Memoria on your phone or tablet to connect' }),
  ).toHaveCount(0);
  await page.getByText('Manage connection', { exact: true }).click();
  await page.getByRole('button', { name: 'Pause sync', exact: true }).click();
  await expect(page.getByText('Sync paused', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Resume sync', exact: true }).click();
  await expect(page.getByText('Device connected', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('img', { name: 'Scan this code with Memoria on your phone or tablet to connect' }),
  ).toHaveCount(0);
  await page.getByText('Manage connection', { exact: true }).click();
  await page.getByRole('button', { name: 'Pause sync', exact: true }).click();
  // Exercise a real waiting service worker in the isolated package copy.
  // An update must offer the existing prompt, not reload over an active edit.
  await second.close();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect(page.getByRole('button', { name: 'Today', exact: true })).toHaveAttribute('aria-current', 'page');
  const openGame = page.getByRole('button', { name: 'Review Audit sync check', exact: true });
  const energy = page.getByLabel('Original Resin current value');
  await expect.poll(async () => (await openGame.isVisible()) || (await energy.isVisible())).toBe(true);
  if (!(await energy.isVisible())) await openGame.click();
  await energy.fill('42');
  const pageStarted = await page.evaluate(() => performance.timeOrigin);
  const sw = join(install, 'app/dist/sw.js');
  writeFileSync(sw, `${readFileSync(sw, 'utf8')}\n// isolated update test ${Date.now()}\n`);
  await page.evaluate(async () => {
    await (await navigator.serviceWorker.getRegistration()).update();
  });
  await expect(page.getByRole('button', { name: 'Update now', exact: true })).toBeVisible({ timeout: 20000 });
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(pageStarted);
  await expect(energy).toHaveValue('42');
  await energy.press('Enter');
  await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: 'Update now', exact: true }).click()]);
  await page.getByRole('button', { name: 'Review Audit sync check', exact: true }).click();
  await expect(energy).toHaveValue('42');
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
      desktop:
        'PASS: launch, add game, disk sync, reload, second launch, live events, Wi-Fi controls, safe PWA update, CSP',
      singleFile: 'PASS: add game, reload, no HTTP requests',
      release: JSON.parse(readFileSync(join(install, 'release.json'), 'utf8')).version,
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
