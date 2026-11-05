import {
  newDeviceKey,
  devicePublicKey,
  deviceFingerprint,
  lanKeys,
  sealLan,
  openLan,
} from '../shared/src/lan-crypto.ts';
/* global window, document, location */
// Exercises the packaged Windows program (dist/release/Memoria) end to end:
// the real Memoria.exe, its WebView2 window, loopback server and Wi-Fi sync.
// A copied install, a scratch data folder and a separate instance name keep
// it away from the owner's data and from a copy they have open. The scratch
// folder is deleted afterwards.
import { chromium, expect } from '@playwright/test';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { safeParseAppState } from '../desktop/dist/shared-core.mjs';

const root = resolve(import.meta.dirname, '..');
const checks = join(root, 'dist/native-check');
// Earlier runs that crashed before cleaning up.
rmSync(checks, { recursive: true, force: true });
const scratch = join(checks, String(Date.now()));
const install = join(scratch, 'install');
const appdata = join(scratch, 'roaming');
const localAppdata = join(scratch, 'local');
const dataDir = join(appdata, 'memoria');
const stateFile = join(dataDir, 'state.json');
mkdirSync(dataDir, { recursive: true });
mkdirSync(localAppdata, { recursive: true });
cpSync(join(root, 'dist/release/Memoria'), install, { recursive: true });
const executablePath = join(install, 'Memoria.exe');
if (!existsSync(executablePath)) throw new Error('Run npm run package before check:native.');

async function freePort(candidates) {
  for (const candidate of candidates) {
    const probe = createServer();
    probe.listen(candidate, '127.0.0.1');
    try {
      await once(probe, 'listening');
    } catch {
      continue;
    }
    const { port } = probe.address();
    await new Promise((done) => probe.close(done));
    return port;
  }
  throw new Error('No free port for the check.');
}

// The app only syncs from its own fixed origins, so the check takes a free one of those.
const appPort = await freePort([17819, 17818, 17817]);
const debugPort = await freePort([0]);

const stamp = Date.now() - 86_400_000;
const fixture = {
  schemaVersion: 8,
  games: [
    {
      id: 'native-archive-game',
      name: 'Native archive',
      short: 'NA',
      color: '#6699cc',
      icon: 'gamepad',
      platform: 'pc',
      tz: 'Etc/GMT-1',
      dailyResetHour: 4,
      weeklyResetDay: 1,
      monthlyResetDay: 1,
      paused: false,
      sort: 0,
      notes: 'A pre-existing PC game must survive the new desktop profile.',
      updatedAt: stamp,
    },
  ],
  resources: [
    {
      id: 'native-archive-energy',
      gameId: 'native-archive-game',
      name: 'Archive energy',
      cap: 200,
      regenMinutes: 1_000_000,
      reserveCap: 0,
      kind: 'regen',
      sort: 0,
      updatedAt: stamp,
    },
  ],
  snapshots: [{ id: 'native-old-reading', resourceId: 'native-archive-energy', value: 31, takenAt: stamp }],
  tasks: [],
  completions: [],
  events: [],
  chips: [],
  alertRules: [],
  reminders: [],
  settings: {
    quietStart: 135,
    quietEnd: 555,
    localTz: 'Asia/Tokyo',
    sleepHours: 6.5,
    updatedAt: stamp,
    fieldUpdatedAt: { quietStart: stamp, quietEnd: stamp, localTz: stamp, sleepHours: stamp },
  },
};
const parsed = safeParseAppState(fixture);
if (!parsed.success) throw new Error(`Invalid native check fixture: ${parsed.error}`);
writeFileSync(stateFile, JSON.stringify(fixture));
// Closing quits rather than hiding to the tray, so the check can close the window.
writeFileSync(join(dataDir, 'desktop-preferences.json'), JSON.stringify({ closeToTray: false, openAtLogin: false }));

const env = {
  ...process.env,
  APPDATA: appdata,
  LOCALAPPDATA: localAppdata,
  MEMORIA_INSTANCE: 'nativecheck',
  MEMORIA_PORTS: String(appPort),
  MEMORIA_LAN_PORT: '0',
  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${debugPort}`,
  MEMORIA_DEBUG_PORT: String(debugPort),
};
let app;
let browser;
let page;
const errors = [];
const run = promisify(execFile);

const readState = () => JSON.parse(readFileSync(stateFile, 'utf8'));
const latestEnergy = () =>
  readState()
    .snapshots.filter((snapshot) => snapshot.resourceId === 'native-archive-energy')
    .sort((left, right) => right.takenAt - left.takenAt)[0]?.value;

function checkExistingData() {
  const state = readState();
  expect(state.games.map((game) => game.id)).toEqual(['native-archive-game']);
  expect(state.resources.map((resource) => resource.id)).toEqual(['native-archive-energy']);
  expect(state.snapshots.some((snapshot) => snapshot.id === 'native-old-reading')).toBe(true);
  expect(state.settings).toMatchObject({ quietStart: 135, quietEnd: 555, localTz: 'Asia/Tokyo', sleepHours: 6.5 });
}

/** Private memory of Memoria.exe and the WebView2 processes it started, in MB. Shared pages are not counted twice. */
async function memoryInUse(pid) {
  const { stdout } = await run(
    'powershell',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `$all = Get-CimInstance Win32_Process; $tree = @(${pid}); do { $added = @($all | Where-Object { $tree -contains $_.ParentProcessId -and $tree -notcontains $_.ProcessId } | ForEach-Object ProcessId); $tree += $added } while ($added.Count); [math]::Round(((Get-CimInstance Win32_PerfFormattedData_PerfProc_Process | Where-Object { $tree -contains $_.IDProcess } | Measure-Object WorkingSetPrivate -Sum).Sum / 1MB))`,
    ],
    { windowsHide: true },
  );
  return Number(stdout.trim());
}

async function launch() {
  app = spawn(executablePath, [], { cwd: install, env, stdio: ['ignore', 'ignore', 'pipe'] });
  const output = [];
  app.stderr.on('data', (chunk) => output.push(String(chunk)));
  const started = app;
  let exitCode;
  started.once('exit', (code, signal) => (exitCode = code ?? signal));
  const deadline = Date.now() + 45_000;
  while (!page && Date.now() < deadline) {
    await new Promise((done) => setTimeout(done, 300));
    browser ??= await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`).catch(() => undefined);
    page = browser
      ?.contexts()
      .flatMap((context) => context.pages())
      .find((item) => item.url().includes(`:${appPort}`));
  }
  if (!page) {
    // Say why, so a failure on a build machine can be read from its log.
    const probe = (url) =>
      fetch(url, { signal: AbortSignal.timeout(3000) }).then(
        (response) => `HTTP ${response.status}`,
        (error) => String(error.cause?.code ?? error.message),
      );
    const pages = browser?.contexts().flatMap((context) => context.pages().map((item) => item.url()));
    throw new Error(
      `The Memoria window did not open. ${JSON.stringify({
        exitCode,
        stderr: output.join('').slice(-2000),
        debugPort: await probe(`http://127.0.0.1:${debugPort}/json/version`),
        debugPortV6: await probe(`http://[::1]:${debugPort}/json/version`),
        devToolsActivePort: (() => {
          try {
            return readFileSync(join(dataDir, 'webview', 'EBWebView', 'DevToolsActivePort'), 'utf8');
          } catch (error) {
            return String(error.code);
          }
        })(),
        webviewFiles: (() => {
          try {
            return readdirSync(join(dataDir, 'webview'), { recursive: true }).slice(0, 40);
          } catch (error) {
            return String(error.code);
          }
        })(),
        processes: await run(
          'powershell',
          [
            '-NoProfile',
            '-Command',
            `$all = Get-CimInstance Win32_Process; $tree = @(${started.pid}); do { $added = @($all | Where-Object { $tree -contains $_.ParentProcessId -and $tree -notcontains $_.ProcessId } | ForEach-Object ProcessId); $tree += $added } while ($added.Count); $all | Where-Object { $tree -contains $_.ProcessId } | ForEach-Object { $_.Name + ' ' + $_.CommandLine.Substring(0, [Math]::Min(160, $_.CommandLine.Length)) }`,
          ],
          { windowsHide: true },
        ).then(
          ({ stdout }) => stdout.trim().split(/\s*\n/),
          (error) => error.message,
        ),
        browser: await run(
          'powershell',
          [
            '-NoProfile',
            '-Command',
            `(Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'" | Where-Object { $_.CommandLine -notmatch '--type=' } | Select-Object -First 1).CommandLine; Get-ChildItem 'HKLM:\\SOFTWARE\\Policies\\Microsoft' -Recurse -ErrorAction SilentlyContinue | Where-Object { $_.PSChildName -match 'Edge|WebView' } | ForEach-Object { $_.Name + ' ' + (($_.Property) -join ',') }`,
          ],
          { windowsHide: true },
        ).then(
          ({ stdout }) => stdout.trim(),
          (error) => error.message,
        ),
        session: await run(
          'powershell',
          ['-NoProfile', '-Command', '[Environment]::UserInteractive; (Get-Process -Id $PID).SessionId; whoami'],
          { windowsHide: true },
        ).then(
          ({ stdout }) => stdout.trim().split(/\s*\n/),
          (error) => error.message,
        ),
        appServer: await probe(`http://127.0.0.1:${appPort}/`),
        pages,
      })}`,
    );
  }
  page.setDefaultTimeout(15_000);
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    // The blocked-navigation probe below logs its own refusal.
    if (message.type() === 'error' && !message.text().startsWith('Not allowed to load local resource'))
      errors.push(message.text());
  });
  // Record any content policy violation from the first script onward.
  await page.context().addInitScript(() => {
    window.cspViolations = [];
    document.addEventListener('securitypolicyviolation', (event) =>
      window.cspViolations.push(`${event.violatedDirective} ${event.blockedURI}`),
    );
    try {
      window.localStorage.setItem('memoria-onboarding', 'complete');
    } catch {
      // Storage is optional for this check.
    }
  });
  await page.reload();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.getByRole('button', { name: 'Today', exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Review Native archive', exact: true }).click();
  await page.getByRole('button', { name: 'Open full page', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Native archive', exact: true })).toBeVisible();
  return page.getByLabel('Archive energy current value', { exact: true });
}

/** The Memoria window's handle while it is on screen. */
async function windowHandle() {
  const { stdout } = await run(
    'powershell',
    ['-NoProfile', '-Command', `(Get-Process -Id ${app.pid}).MainWindowHandle`],
    {
      windowsHide: true,
    },
  );
  return stdout.trim();
}

/** Whether Windows shows that window. */
async function windowShown(handle) {
  const { stdout } = await run(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      `Add-Type -Namespace Check -Name Win -MemberDefinition '[DllImport("user32.dll")] public static extern bool IsWindowVisible(System.IntPtr h);'; [Check.Win]::IsWindowVisible([IntPtr]${handle})`,
    ],
    { windowsHide: true },
  );
  return stdout.trim() === 'True';
}

/** Asks Windows to close the window, as its close button does. */
async function closeWindow() {
  const exited = once(app, 'exit');
  await run('powershell', ['-NoProfile', '-Command', `(Get-Process -Id ${app.pid}).CloseMainWindow() | Out-Null`], {
    windowsHide: true,
  });
  return exited;
}

async function quit() {
  const [code] = await Promise.race([
    closeWindow(),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Memoria did not quit within 30 seconds.')), 30_000)),
  ]);
  expect(code).toBe(0);
  await browser?.close().catch(() => undefined);
  app = undefined;
  browser = undefined;
  page = undefined;
}

try {
  let energy = await launch();
  await expect(energy).toHaveValue('31');
  checkExistingData();

  const surface = await page.evaluate(async () => ({
    node: typeof window.require,
    process: typeof window.process,
    bridge: Object.keys(window.memoriaDesktop ?? {}).sort(),
    workers: (await navigator.serviceWorker.getRegistrations()).length,
    presence: await window.memoriaDesktop.presence.get(),
  }));
  expect(surface).toMatchObject({
    node: 'undefined',
    process: 'undefined',
    bridge: ['completeClose', 'launch', 'onCloseRequested', 'presence', 'update', 'version'],
    workers: 0,
    presence: { canStartWithWindows: false, closeToTray: false, gameWatch: true },
  });
  // The page cannot leave the app for a local file.
  await page.evaluate(() => {
    location.href = 'file:///C:/Windows/win.ini';
  });
  await page.waitForTimeout(500);
  expect(new URL(page.url()).port).toBe(String(appPort));
  await expect(energy).toHaveValue('31');
  const memory = await memoryInUse(app.pid);

  // Closing at once must commit the focused input and finish both saves first.
  await energy.fill('42');
  await quit();
  expect(latestEnergy()).toBe(42);
  checkExistingData();

  energy = await launch();
  await expect(energy).toHaveValue('42');

  // A second start hands off to the open window and exits.
  const second = spawn(executablePath, [], { cwd: install, env, stdio: 'ignore' });
  const [secondCode] = await Promise.race([
    once(second, 'exit'),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('The second start did not hand off to the open app.')), 15_000),
    ),
  ]);
  expect(secondCode).toBe(0);
  expect(app.exitCode).toBe(null);

  // An unsaved draft keeps the app open when the window is closed.
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Game settings for Native archive', exact: true }).click();
  await page.getByRole('tab', { name: 'Tasks', exact: true }).click();
  const draft = page.getByRole('textbox', { name: 'New task name', exact: true });
  await draft.fill('Keep my unsaved task');
  const confirmation = page.waitForEvent('dialog');
  await run('powershell', ['-NoProfile', '-Command', `(Get-Process -Id ${app.pid}).CloseMainWindow() | Out-Null`], {
    windowsHide: true,
  });
  const dialog = await confirmation;
  expect(dialog.type()).toBe('confirm');
  expect(dialog.message()).toContain('unsaved changes');
  await dialog.dismiss();
  await expect(draft).toHaveValue('Keep my unsaved task');
  await page.waitForTimeout(500);
  expect(app.exitCode).toBe(null);
  await page.getByRole('button', { name: 'Add task', exact: true }).click();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect.poll(() => readState().tasks.some((task) => task.name === 'Keep my unsaved task')).toBe(true);

  // Ctrl and + or - zoom the page; the level is kept for the next launch.
  const width = await page.evaluate(() => window.innerWidth);
  await page.keyboard.press('Control+Equal');
  await expect.poll(() => page.evaluate(() => window.innerWidth)).toBeLessThan(width);
  await expect
    .poll(
      () => existsSync(join(dataDir, 'desktop-zoom.json')) && readFileSync(join(dataDir, 'desktop-zoom.json'), 'utf8'),
    )
    .toContain('1.1');
  await page.keyboard.press('Control+0');
  await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(width);

  // Phone pairing, through the real Wi-Fi listener. A wide window shows one Settings section at a time.
  const sections = page.getByRole('navigation', { name: 'Settings sections' });
  if (await sections.isVisible()) await sections.getByRole('button', { name: /^Device sync/ }).click();
  await page.getByRole('button', { name: 'Connect my phone or tablet', exact: true }).click();
  const code = page.getByRole('img', { name: 'Scan this code with Memoria on your phone or tablet to connect' });
  await expect(code).toBeVisible();
  const wifi = await page.evaluate(async () =>
    (
      await fetch('/api/devices', {
        headers: { authorization: `Bearer ${sessionStorage.getItem('memoria-launcher-token')}` },
      })
    ).json(),
  );
  const secret = newDeviceKey();
  const phone = devicePublicKey(secret);
  const encrypted = async (path, data) => {
    const url = `http://127.0.0.1:${wifi.port}`;
    const post = (path, data) =>
      fetch(`${url}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(data),
      });
    const hello = await (await post('/hello', {})).json();
    expect(deviceFingerprint(hello.publicKey)).toBe(wifi.fingerprint);
    const keys = lanKeys(secret, hello.publicKey, hello.publicKey, phone);
    const request = sealLan(keys.request, path, phone, hello.challenge, data);
    const response = await post(path, request);
    expect(response.status).toBe(200);
    return openLan(keys.response, path, await response.json(), request.nonce);
  };
  const paired = await encrypted('/pair', { code: wifi.code, name: 'Check phone' });
  expect(paired.deviceId).toBeTruthy();
  await expect(page.getByText('Device connected', { exact: true })).toBeVisible();
  const phoneState = readState();
  phoneState.games[0].name = 'Phone archive';
  phoneState.games[0].updatedAt = Date.now();
  const phoneSync = await encrypted('/sync', { state: phoneState });
  expect(phoneSync.state).toBeTruthy();
  await page.getByRole('button', { name: 'Today', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Phone archive', exact: true })).toBeVisible({ timeout: 15_000 });

  // A change written to the file by something else reaches the open window.
  const synced = readState();
  synced.games[0].name = 'Synced archive';
  synced.games[0].updatedAt = Date.now();
  writeFileSync(stateFile, JSON.stringify(synced));
  await expect(page.getByRole('heading', { name: 'Synced archive', exact: true })).toBeVisible({ timeout: 15_000 });
  checkExistingData();
  expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
  await page.screenshot({ path: join(root, 'dist/native-desktop.png') });

  // With the tray on, closing hides the window and Memoria keeps running.
  await page.evaluate(() => window.memoriaDesktop.presence.set({ closeToTray: true }));
  const handle = await windowHandle();
  await run('powershell', ['-NoProfile', '-Command', `(Get-Process -Id ${app.pid}).CloseMainWindow() | Out-Null`], {
    windowsHide: true,
  });
  await expect.poll(() => windowShown(handle)).toBe(false);
  await page.waitForTimeout(3000);
  expect(app.exitCode).toBe(null);
  const trayMemory = await memoryInUse(app.pid);
  // Starting Memoria again brings the hidden window back.
  const reopen = spawn(executablePath, [], { cwd: install, env, stdio: 'ignore' });
  expect((await once(reopen, 'exit'))[0]).toBe(0);
  await expect.poll(() => windowShown(handle)).toBe(true);
  await page.evaluate(() => window.memoriaDesktop.presence.set({ closeToTray: false }));

  await page.getByLabel('Archive energy current value', { exact: true }).fill('124');
  await quit();
  expect(latestEnergy()).toBe(124);
  checkExistingData();
  expect(errors).toEqual([]);
  const megabytes = (bytes) => Math.round(bytes / 1024 / 1024);
  const folderBytes = (dir) =>
    readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .reduce((sum, entry) => sum + statSync(join(entry.parentPath, entry.name)).size, 0);
  console.log(
    JSON.stringify({
      native:
        'PASS: packaged program, existing PC data, narrow bridge, no service worker, blocked navigation, close flush, relaunch, single instance, unsaved draft, phone pairing and sync, disk sync, tray hide and reopen, zoom keys, content policy',
      installMB: megabytes(folderBytes(install)),
      memoryMB: memory,
      trayMemoryMB: trayMemory,
      screenshot: 'dist/native-desktop.png',
    }),
  );
} catch (error) {
  await page?.screenshot({ path: join(root, 'dist/native-failure.png') }).catch(() => undefined);
  console.error(JSON.stringify({ errors }));
  throw error;
} finally {
  await browser?.close().catch(() => undefined);
  if (app && app.exitCode === null) {
    // Only the check's own process tree is ended; an installed copy is never touched.
    await run('taskkill', ['/PID', String(app.pid), '/T', '/F'], { windowsHide: true }).catch(() => undefined);
  }
  // WebView2 can hold its profile for a moment after exit.
  for (let attempt = 0; attempt < 10 && existsSync(checks); attempt++) {
    try {
      rmSync(checks, { recursive: true, force: true });
    } catch {
      await new Promise((done) => setTimeout(done, 500));
    }
  }
}
