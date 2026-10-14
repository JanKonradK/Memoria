/* global window, document */
import { _electron as electron, expect } from '@playwright/test';
import { spawn, execFile } from 'node:child_process';
import { once } from 'node:events';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { safeParseAppState } from '../desktop/dist/shared-core.mjs';
import { isolateLauncherPort } from './launcher-test-support.mjs';

// Exercise the actual Windows executable and its bundled engine. The copied
// package and synthetic profile keep this check away from the owner's data.
const root = resolve(import.meta.dirname, '..');
const scratch = join(root, 'dist/native-check', String(Date.now()));
const install = join(scratch, 'install');
const appdata = join(scratch, 'roaming');
const localAppdata = join(scratch, 'local');
const stateFile = join(appdata, 'memoria/state.json');
mkdirSync(join(appdata, 'memoria'), { recursive: true });
mkdirSync(localAppdata, { recursive: true });
cpSync(join(root, 'dist/release/Memoria'), install, { recursive: true });
await isolateLauncherPort(join(install, 'desktop/memoria.mjs'), [17817, 17818, 17819]);
const lanModule = join(install, 'desktop/lan-sync.mjs');
const lanSource = readFileSync(lanModule, 'utf8');
const lanDeclaration = 'export const LAN_PORT = 17820;';
if (!lanSource.includes(lanDeclaration)) throw new Error('Test LAN port declaration changed');
writeFileSync(lanModule, lanSource.replace(lanDeclaration, 'export const LAN_PORT = 0;'));

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

const executablePath = join(install, 'Memoria.exe');
if (!existsSync(executablePath)) throw new Error('Build the Windows package before running check:native.');
const env = {
  ...process.env,
  APPDATA: appdata,
  LOCALAPPDATA: localAppdata,
  MEMORIA_NO_BROWSER: '1',
  MEMORIA_NO_UPDATE: '1',
};
delete env.ELECTRON_RUN_AS_NODE;
let desktop;
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

async function launch() {
  desktop = await electron.launch({ executablePath, cwd: install, env, timeout: 45_000 });
  page = await desktop.firstWindow({ timeout: 45_000 });
  page.setDefaultTimeout(15_000);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.getByRole('button', { name: 'Games', exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Games', exact: true }).click();
  await page.getByRole('button', { name: 'Open Native archive controls', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Native archive', exact: true })).toBeVisible();
  return page.getByLabel('Archive energy current value', { exact: true });
}

async function requestQuit() {
  await desktop.evaluate(({ Menu }) => {
    const item = Menu.getApplicationMenu()
      ?.items.find((entry) => entry.label === 'File')
      ?.submenu?.items.find((entry) => entry.label === 'Quit Memoria');
    if (!item) throw new Error('The native Quit Memoria action is missing.');
    item.click();
  });
}

async function closeWindow(quit = false) {
  const closed = desktop.waitForEvent('close', { timeout: 30_000 });
  if (quit) await requestQuit();
  else await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await closed;
  desktop = undefined;
}

try {
  let energy = await launch();
  await expect(energy).toHaveValue('31');
  checkExistingData();
  // Send keys through Electron; CDP key presses bypass native input handling.
  const zoomLevel = () =>
    desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomLevel());
  const zoomShortcut = (input) =>
    desktop.evaluate(({ BrowserWindow }, key) => {
      const target = BrowserWindow.getAllWindows()[0];
      target.focus();
      target.webContents.focus();
      target.webContents.sendInputEvent({ type: 'keyDown', ...key });
      target.webContents.sendInputEvent({ type: 'keyUp', ...key });
    }, input);
  await zoomShortcut({ keyCode: '0', modifiers: ['control'] });
  await expect.poll(zoomLevel).toBe(0);
  await zoomShortcut({ keyCode: '-', modifiers: ['control'] });
  await expect.poll(zoomLevel).toBe(-0.5);
  for (const shortcut of [
    { keyCode: '=', modifiers: ['control'] },
    { keyCode: '+', modifiers: ['control', 'shift'] },
    { keyCode: 'numadd', modifiers: ['control'] },
  ]) {
    await zoomShortcut(shortcut);
    await expect.poll(zoomLevel, { message: `${JSON.stringify(shortcut)} must zoom in once` }).toBe(0);
    await zoomShortcut(shortcut);
    await expect
      .poll(zoomLevel, { message: `${JSON.stringify(shortcut)} must enlarge the app above actual size` })
      .toBe(0.5);
    await zoomShortcut({ keyCode: '0', modifiers: ['control'] });
    await expect.poll(zoomLevel).toBe(0);
    await zoomShortcut({ keyCode: '-', modifiers: ['control'] });
    await expect.poll(zoomLevel).toBe(-0.5);
  }
  await zoomShortcut({ keyCode: '0', modifiers: ['control'] });
  await expect.poll(zoomLevel).toBe(0);
  await zoomShortcut({ keyCode: '+', modifiers: ['control', 'alt'] });
  await zoomShortcut({ keyCode: '=', modifiers: [] });
  await expect.poll(zoomLevel).toBe(0);
  await expect(energy).toHaveValue('31');
  console.log('PASS: Ctrl+Plus, Ctrl+Equal, number-pad Plus, Ctrl+Minus, and Ctrl+0');
  const security = await desktop.evaluate(({ BrowserWindow, app }) => {
    const windows = BrowserWindow.getAllWindows();
    const preferences = windows[0].webContents.getLastWebPreferences();
    return {
      windows: windows.length,
      contextIsolation: preferences.contextIsolation,
      sandbox: preferences.sandbox,
      nodeIntegration: preferences.nodeIntegration,
      webSecurity: preferences.webSecurity,
      packaged: app.isPackaged,
      profile: app.getPath('userData'),
      executable: process.execPath,
    };
  });
  expect(security).toMatchObject({
    windows: 1,
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    webSecurity: true,
    packaged: true,
    executable: executablePath,
  });
  expect(security.profile).toBe(join(appdata, 'memoria/desktop-profile'));
  expect(
    await page.evaluate(() => ({
      node: typeof window.require,
      process: typeof window.process,
      bridge: Object.keys(window.memoriaDesktop ?? {}).sort(),
    })),
  ).toEqual({
    node: 'undefined',
    process: 'undefined',
    bridge: ['completeClose', 'launch', 'onCloseRequested', 'version'],
  });
  expect(await page.evaluate(async () => (await window.navigator.serviceWorker.getRegistrations()).length)).toBe(0);
  // Resize the actual native frame, including the narrowest supported PC width.
  // Its web contents must reflow while keeping the user's values intact.
  for (const [width, height] of [
    [360, 480],
    [960, 600],
    [1280, 900],
  ]) {
    await desktop.evaluate(
      ({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(...size),
      [width, height],
    );
    await expect
      .poll(() => desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getSize()))
      .toEqual([width, height]);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1))
      .toBe(true);
    await expect(energy).toHaveValue('31');
  }
  // Check the renderer's copy permission without replacing the owner's system
  // clipboard, which is shared even when the app profile is isolated.
  expect(
    await page.evaluate(async () => (await window.navigator.permissions.query({ name: 'clipboard-write' })).state),
  ).toBe('granted');

  // Closing immediately must commit the active input and drain both local
  // storage and the disk sync queue before the renderer is destroyed.
  await energy.fill('42');
  await closeWindow();
  expect(latestEnergy()).toBe(42);
  checkExistingData();
  energy = await launch();
  await expect(energy).toHaveValue('42');

  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize());
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
  await expect
    .poll(() =>
      desktop.evaluate(({ BrowserWindow }) => ({
        windows: BrowserWindow.getAllWindows().length,
        minimized: BrowserWindow.getAllWindows()[0].isMinimized(),
      })),
    )
    .toEqual({ windows: 1, minimized: false });

  await expect(energy).toHaveValue('42');

  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Game settings for Native archive', exact: true }).click();
  await page.getByRole('tab', { name: 'Tasks', exact: true }).click();
  const draft = page.getByRole('textbox', { name: 'New task name', exact: true });
  await draft.fill('Keep my unsaved task');
  const confirmation = page.waitForEvent('dialog');
  await requestQuit();
  const dialog = await confirmation;
  expect(dialog.type()).toBe('confirm');
  expect(dialog.message()).toContain('unsaved changes');
  await dialog.dismiss();
  await expect(draft).toHaveValue('Keep my unsaved task');
  expect(await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);

  // Terminate only the synthetic app's named utility process. Recovery must
  // renew launcher authorization and the event stream without reloading over
  // this live editor draft.
  const startedAt = await page.evaluate(() => {
    window.nativeRestoredForCheck = false;
    window.addEventListener('memoria-launcher-restored', () => (window.nativeRestoredForCheck = true), { once: true });
    return window.performance.timeOrigin;
  });
  const stoppedPid = await desktop.evaluate(({ app }) => {
    const worker = app
      .getAppMetrics()
      .find((metric) => metric.type === 'Utility' && metric.name === 'Memoria local data and phone sync');
    if (!worker || worker.pid === process.pid) throw new Error('The isolated app data worker was not found.');
    process.kill(worker.pid, 'SIGTERM');
    return worker.pid;
  });
  await expect
    .poll(
      () =>
        desktop.evaluate(
          ({ app }, stopped) =>
            app
              .getAppMetrics()
              .some(
                (metric) =>
                  metric.type === 'Utility' &&
                  metric.name === 'Memoria local data and phone sync' &&
                  metric.pid !== stopped,
              ),
          stoppedPid,
        ),
      { timeout: 30_000 },
    )
    .toBe(true);
  await expect.poll(() => page.evaluate(() => window.nativeRestoredForCheck), { timeout: 30_000 }).toBe(true);
  expect(
    await page.evaluate(async () => {
      const response = await fetch('/api/state', {
        headers: { authorization: `Bearer ${sessionStorage.getItem('memoria-launcher-token')}` },
      });
      return response.status;
    }),
  ).toBe(200);
  expect(await page.evaluate(() => window.performance.timeOrigin)).toBe(startedAt);
  await expect(draft).toHaveValue('Keep my unsaved task');
  await page.getByRole('button', { name: 'Add task', exact: true }).click();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect.poll(() => readState().tasks.some((task) => task.name === 'Keep my unsaved task')).toBe(true);

  await page.getByRole('button', { name: 'Connect my phone or tablet', exact: true }).click();
  await expect(page.getByRole('img', { name: 'Scan this code with Memoria on your phone to connect' })).toBeVisible();
  await page.getByRole('button', { name: 'Games', exact: true }).click();
  // External changes take the same path used by an already paired phone.
  const synced = readState();
  synced.games[0].name = 'Synced archive';
  synced.games[0].updatedAt = Date.now();
  writeFileSync(stateFile, JSON.stringify(synced));
  await expect(page.getByRole('heading', { name: 'Synced archive', exact: true })).toBeVisible({ timeout: 15_000 });
  checkExistingData();
  const origin = new URL(page.url()).origin;
  // Exercise the actual window's registered guard without triggering the two
  // competing Electron/CDP beforeunload dialog implementations in automation.
  const navigation = await desktop.evaluate(({ BrowserWindow }) => {
    const contents = BrowserWindow.getAllWindows()[0].webContents;
    const check = (target) => {
      let prevented = false;
      contents.emit('will-navigate', { preventDefault: () => (prevented = true) }, target);
      return prevented;
    };
    return {
      remote: check('https://example.com/memoria-native-navigation-check'),
      file: check('file:///C:/Windows/win.ini'),
      internal: check(new URL('/', contents.getURL()).href),
    };
  });
  expect(navigation).toEqual({ remote: true, file: true, internal: false });
  await expect(page.getByRole('heading', { name: 'Synced archive', exact: true })).toBeVisible();
  expect(new URL(page.url()).origin).toBe(origin);

  // An unrelated window loading the same preload cannot use privileged IPC.
  const stranger = await desktop.evaluate(
    async ({ BrowserWindow }, preload) => {
      const fixtureWindow = new BrowserWindow({
        show: false,
        webPreferences: { preload, sandbox: true, contextIsolation: true, nodeIntegration: false },
      });
      await fixtureWindow.loadURL(
        'data:text/html;charset=utf-8,%3C!doctype%20html%3E%3Ctitle%3EStranger%3C%2Ftitle%3E',
      );
      const answer = await fixtureWindow.webContents.executeJavaScript(
        "window.memoriaDesktop.launch.list().then(() => 'unexpected access', error => error.message)",
      );
      fixtureWindow.destroy();
      return answer;
    },
    join(install, 'desktop/electron-preload.cjs'),
  );
  expect(stranger).toContain('only available in Memoria');
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
        'PASS: bundled executable, isolated renderer, responsive native resizing, existing PC data, close and quit flush, relaunch, single instance, unsaved draft, backend recovery, phone pairing, disk sync, blocked remote navigation, privileged IPC limited to the app window',
      screenshot: 'dist/native-desktop.png',
    }),
  );
} catch (error) {
  if (desktop) {
    console.error(
      JSON.stringify(
        await desktop
          .evaluate(({ app, BrowserWindow }) => ({
            nativeFailure: BrowserWindow.getAllWindows().map((item) => ({
              id: item.id,
              title: item.getTitle(),
              visible: item.isVisible(),
              minimized: item.isMinimized(),
              destroyed: item.isDestroyed(),
            })),
            activateHandlers: app.listeners('activate').map((handler) => handler.name),
          }))
          .catch(() => ({ nativeFailure: 'The isolated app stopped.' })),
      ),
    );
  }
  await page?.screenshot({ path: join(root, 'dist/native-failure.png') }).catch(() => undefined);
  throw error;
} finally {
  if (desktop) {
    // A failed dirty-draft test can deliberately leave close guarded. Only the
    // synthetic test process tree is terminated; no installed app is touched.
    const pid = desktop.process().pid;
    await promisify(execFile)('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }).catch(
      () => undefined,
    );
  }
}
