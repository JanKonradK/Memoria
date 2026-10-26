/* global window, document */
import { chromium, expect } from '@playwright/test';
import { spawn, execFile } from 'node:child_process';
import { once } from 'node:events';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { freePort, isolatedHostEnv } from './launcher-test-support.mjs';

// Exercise the packaged Windows executable in its real WebView2 window. The
// copied package and synthetic profile keep this check away from the owner's
// data, ports and phone pairings. Playwright attaches through WebView2's
// DevTools port; Win32 calls stand in for the person closing or minimizing it.
const root = resolve(import.meta.dirname, '..');
const scratch = join(root, 'dist/native-check', String(Date.now()));
const install = join(scratch, 'install');
const appdata = join(scratch, 'roaming');
const localAppdata = join(scratch, 'local');
const stateFile = join(appdata, 'memoria/state.json');
mkdirSync(join(appdata, 'memoria'), { recursive: true });
mkdirSync(localAppdata, { recursive: true });
cpSync(join(root, 'dist/release/Memoria'), install, { recursive: true });

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
writeFileSync(stateFile, JSON.stringify(fixture));

const executablePath = join(install, 'Memoria.exe');
if (!existsSync(executablePath)) throw new Error('Build the Windows package before running check:native.');
expect(JSON.parse(readFileSync(join(install, 'release.json'), 'utf8')).runtime).toBe('tauri');
const devtoolsPort = await freePort();
const env = {
  ...(await isolatedHostEnv({ appdata, ports: [17817, 17818, 17819] })),
  LOCALAPPDATA: localAppdata,
  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${devtoolsPort}`,
};
let desktop;
let browser;
let page;
const errors = [];

function readState() {
  return JSON.parse(readFileSync(stateFile, 'utf8'));
}

function latestEnergy() {
  return readState()
    .snapshots.filter((snapshot) => snapshot.resourceId === 'native-archive-energy')
    .sort((left, right) => right.takenAt - left.takenAt)[0]?.value;
}

function checkExistingData() {
  const state = readState();
  expect(state.games.map((game) => game.id)).toEqual(['native-archive-game']);
  expect(state.resources.map((resource) => resource.id)).toEqual(['native-archive-energy']);
  expect(state.snapshots.some((snapshot) => snapshot.id === 'native-old-reading')).toBe(true);
  expect(state.settings).toMatchObject({ quietStart: 135, quietEnd: 555, localTz: 'Asia/Tokyo', sleepHours: 6.5 });
}

/** Runs a Win32 call on the Memoria window: close, minimize, minimized, windows, or size W H. */
async function windowCall(action, ...args) {
  const script = `
$ErrorActionPreference = 'Stop'
Add-Type -Namespace Check -Name Win -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
[DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
[DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int t, bool r);
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
public delegate bool Visit(IntPtr h, IntPtr l);
[DllImport("user32.dll")] public static extern bool EnumWindows(Visit v, IntPtr l);
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, System.Text.StringBuilder s, int n);
'@
$found = New-Object System.Collections.Generic.List[IntPtr]
[Check.Win]::EnumWindows({ param($h, $l)
  $owner = 0; [void][Check.Win]::GetWindowThreadProcessId($h, [ref]$owner)
  $title = New-Object System.Text.StringBuilder 64; [void][Check.Win]::GetWindowText($h, $title, 64)
  if ($owner -eq ${desktop.pid} -and $title.ToString() -eq 'Memoria' -and [Check.Win]::IsWindowVisible($h)) { $found.Add($h) }
  $true }, [IntPtr]::Zero) | Out-Null
$action = '${action}'
if ($action -eq 'windows') { $found.Count; exit }
if ($found.Count -ne 1) { throw "Expected one Memoria window, found $($found.Count)." }
$h = $found[0]
switch ($action) {
  'close' { [void][Check.Win]::PostMessage($h, 0x10, [IntPtr]::Zero, [IntPtr]::Zero) }
  'minimize' { [void][Check.Win]::ShowWindow($h, 6) }
  'minimized' { [Check.Win]::IsIconic($h) }
  'size' { [void][Check.Win]::MoveWindow($h, 40, 40, ${args[0] ?? 0}, ${args[1] ?? 0}, $true) }
}`;
  const { stdout } = await promisify(execFile)(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    {
      windowsHide: true,
    },
  );
  return stdout.trim();
}

async function launch() {
  desktop = spawn(executablePath, [], { cwd: install, env, windowsHide: false, stdio: 'ignore' });
  await expect
    .poll(
      () =>
        fetch(`http://127.0.0.1:${devtoolsPort}/json/version`).then(
          (r) => r.ok,
          () => false,
        ),
      {
        timeout: 45_000,
      },
    )
    .toBe(true);
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${devtoolsPort}`);
  await expect
    .poll(() => browser.contexts().flatMap((context) => context.pages()).length, { timeout: 30_000 })
    .toBeGreaterThan(0);
  page = browser.contexts()[0].pages()[0];
  page.setDefaultTimeout(15_000);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.getByRole('button', { name: 'Today', exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Review Native archive', exact: true }).click();
  // The card beside Today's list gives way to the list on a narrow window; the
  // game's own page keeps its values in reach at every size the test resizes to.
  await page.getByRole('button', { name: 'Open full page', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Native archive', exact: true })).toBeVisible();
  return page.getByLabel('Archive energy current value', { exact: true });
}

/** Ctrl+Q, which the window's own key handler turns into Quit Memoria. */
async function requestQuit() {
  await page.keyboard.press('Control+q');
}

async function waitForExit() {
  const [code] = await Promise.race([
    once(desktop, 'exit'),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Memoria did not close.')), 30_000).unref()),
  ]);
  await browser.close().catch(() => undefined);
  desktop = undefined;
  return code;
}

async function closeWindow(quit = false) {
  if (quit) await requestQuit();
  else await windowCall('close');
  expect(await waitForExit()).toBe(0);
}

try {
  let energy = await launch();
  await expect(energy).toHaveValue('31');
  checkExistingData();
  // The page sees the narrow bridge and nothing else from the host.
  expect(
    await page.evaluate(() => ({
      node: typeof window.require,
      process: typeof window.process,
      tauri: typeof window.__TAURI__,
      bridge: Object.keys(window.memoriaDesktop ?? {}).sort(),
      frozen: Object.isFrozen(window.memoriaDesktop),
    })),
  ).toEqual({
    node: 'undefined',
    process: 'undefined',
    tauri: 'undefined',
    bridge: ['completeClose', 'launch', 'onCloseRequested', 'update', 'version'],
    frozen: true,
  });
  // Only Memoria's own commands are granted, never plugin or core commands.
  expect(
    await page.evaluate(() =>
      window.__TAURI_INTERNALS__.invoke('plugin:app|version').then(
        () => 'unexpected access',
        (error) => String(error),
      ),
    ),
  ).toContain('not allowed');
  expect(await page.evaluate(async () => (await window.navigator.serviceWorker.getRegistrations()).length)).toBe(0);
  expect(existsSync(join(appdata, 'memoria/webview-profile'))).toBe(true);
  // Resize the native frame. Its contents must reflow and keep the values.
  for (const [width, height] of [
    [480, 640],
    [960, 700],
    [1280, 900],
  ]) {
    await windowCall('size', width, height);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1))
      .toBe(true);
    await expect(energy).toHaveValue('31');
  }
  expect(
    await page.evaluate(async () => (await window.navigator.permissions.query({ name: 'clipboard-write' })).state),
  ).toBe('granted');

  // Closing immediately must commit the active input and drain both local
  // storage and the disk sync queue before the window goes.
  await energy.fill('42');
  await closeWindow();
  expect(latestEnergy()).toBe(42);
  checkExistingData();
  energy = await launch();
  await expect(energy).toHaveValue('42');

  // A second launch hands off to the open window and restores it.
  await windowCall('minimize');
  await expect.poll(() => windowCall('minimized')).toBe('True');
  const second = spawn(executablePath, [], { cwd: install, env, windowsHide: true, stdio: 'ignore' });
  const [secondCode] = await Promise.race([
    once(second, 'exit'),
    new Promise((_, reject) => {
      const timeout = setTimeout(() => {
        second.kill();
        reject(new Error('The second native launch did not hand off to the open app.'));
      }, 15_000);
      timeout.unref();
      second.once('exit', () => clearTimeout(timeout));
    }),
  ]);
  expect(secondCode).toBe(0);
  await expect.poll(() => windowCall('minimized')).toBe('False');
  expect(await windowCall('windows')).toBe('1');
  await expect(energy).toHaveValue('42');

  // Quit asks before it discards an unsaved draft, and Cancel keeps the window.
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Game settings for Native archive', exact: true }).click();
  await page.getByRole('tab', { name: 'Tasks', exact: true }).click();
  const draft = page.getByRole('textbox', { name: 'New task name', exact: true });
  await draft.fill('Keep my unsaved task');
  // Answer inside the listener: Playwright dismisses a dialog nobody is listening for.
  const confirmation = new Promise((resolve) =>
    page.once('dialog', async (dialog) => {
      resolve({ type: dialog.type(), message: dialog.message() });
      await dialog.dismiss();
    }),
  );
  await requestQuit();
  const dialog = await confirmation;
  expect(dialog.type).toBe('confirm');
  expect(dialog.message).toContain('unsaved changes');
  await expect(draft).toHaveValue('Keep my unsaved task');
  expect(desktop.exitCode).toBe(null);
  expect(await windowCall('windows')).toBe('1');
  await page.getByRole('button', { name: 'Add task', exact: true }).click();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect.poll(() => readState().tasks.some((task) => task.name === 'Keep my unsaved task')).toBe(true);

  await page.getByRole('button', { name: 'Connect my phone or tablet', exact: true }).click();
  await expect(
    page.getByRole('img', { name: 'Scan this code with Memoria on your phone or tablet to connect' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Today', exact: true }).click();
  // External changes take the same path used by an already paired phone.
  const synced = readState();
  synced.games[0].name = 'Synced archive';
  synced.games[0].updatedAt = Date.now();
  writeFileSync(stateFile, JSON.stringify(synced));
  await expect(page.getByRole('heading', { name: 'Synced archive', exact: true })).toBeVisible({ timeout: 15_000 });
  checkExistingData();

  // The window refuses to leave the app for a website or a local file.
  const origin = new URL(page.url()).origin;
  for (const target of ['https://example.com/memoria-native-navigation-check', 'file:///C:/Windows/win.ini']) {
    await page.evaluate((url) => window.location.assign(url), target);
    await page.waitForTimeout(1_000);
    expect(new URL(page.url()).origin).toBe(origin);
  }
  await expect(page.getByRole('heading', { name: 'Synced archive', exact: true })).toBeVisible();
  await page.screenshot({ path: join(root, 'dist/native-desktop.png') });

  // Quit flushes a focused editor before the window goes.
  await page.getByLabel('Archive energy current value', { exact: true }).fill('124');
  await closeWindow(true);
  expect(latestEnergy()).toBe(124);
  checkExistingData();
  expect(errors).toEqual([]);
  console.log(
    JSON.stringify({
      native:
        'PASS: packaged Rust host, WebView2 window, narrow bridge, plugin IPC denied, native resizing, existing PC data, close and quit flush, relaunch, single instance, unsaved draft, phone pairing, disk sync, blocked navigation',
      screenshot: 'dist/native-desktop.png',
    }),
  );
} catch (error) {
  await page?.screenshot({ path: join(root, 'dist/native-failure.png') }).catch(() => undefined);
  throw error;
} finally {
  await browser?.close().catch(() => undefined);
  if (desktop) {
    // A failed dirty-draft test can deliberately leave close guarded. Only the
    // synthetic test process tree is terminated; no installed app is touched.
    await promisify(execFile)('taskkill', ['/PID', String(desktop.pid), '/T', '/F'], { windowsHide: true }).catch(
      () => undefined,
    );
  }
}
