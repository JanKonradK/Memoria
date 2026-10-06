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
    bridge: ['completeClose', 'hoyo', 'onCloseRequested', 'play', 'version'],
  });
  expect(await page.evaluate(async () => (await window.navigator.serviceWorker.getRegistrations()).length)).toBe(0);
  expect(await page.evaluate(async () => window.memoriaDesktop.play.status())).toMatchObject({
    enabled: false,
    background: false,
    registered: false,
    busy: false,
    count: 0,
    pending: [],
  });
  expect(
    await page.evaluate(async () =>
      (await window.memoriaDesktop.play.sources()).every(
        (source) =>
          source.id.startsWith('window:') && typeof source.name === 'string' && !Object.hasOwn(source, 'thumbnail'),
      ),
    ),
  ).toBe(true);

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

  // Background account checks and phone sync do not require enabling capture.
  expect(
    await page.evaluate(async () =>
      window.memoriaDesktop.play.configure({
        enabled: false,
        background: true,
        hotkey: 'CommandOrControl+Shift+M',
        sourceId: '',
        gameId: '',
      }),
    ),
  ).toMatchObject({ background: true, enabled: false, registered: false });
  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await expect
    .poll(() => desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()))
    .toBe(false);
  expect(desktop.process().exitCode).toBeNull();
  await desktop.evaluate(({ app }) => app.emit('activate'));
  await expect
    .poll(() => desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()))
    .toBe(true);
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
  await page.getByRole('button', { name: '+ Task', exact: true }).click();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect.poll(() => readState().tasks.some((task) => task.name === 'Keep my unsaved task')).toBe(true);

  await page.getByRole('button', { name: 'Connect my phone', exact: true }).click();
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

  // This synthetic native window is the sole source selected for OCR. Its own
  // isolated renderer also proves an unrelated window cannot use privileged IPC.
  const synthetic = await desktop.evaluate(
    async ({ BrowserWindow }, preload) => {
      const fixtureWindow = new BrowserWindow({
        title: 'Memoria capture fixture',
        width: 1150,
        height: 520,
        show: true,
        webPreferences: { preload, sandbox: true, contextIsolation: true, nodeIntegration: false },
      });
      const html =
        '<!doctype html><html><head><title>Memoria capture fixture</title></head><body style="margin:0;padding:40px;background:white;color:black;font-family:Arial,sans-serif"><p style="font-size:58px;font-weight:700;white-space:nowrap">Archive energy 123 / 200</p><p style="font-size:28px">Memoria synthetic game window</p></body></html>';
      await fixtureWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
      fixtureWindow.show();
      fixtureWindow.focus();
      return { id: fixtureWindow.id, sourceId: fixtureWindow.getMediaSourceId() };
    },
    join(install, 'desktop/electron-preload.cjs'),
  );
  const sourceAuthorization = await desktop.evaluate(async ({ BrowserWindow }, id) => {
    const contents = BrowserWindow.fromId(id).webContents;
    return contents.executeJavaScript(
      "window.memoriaDesktop.play.sources().then(() => 'unexpected access', error => error.message)",
    );
  }, synthetic.id);
  expect(sourceAuthorization).toContain('only available in Memoria');
  const available = await page.evaluate(
    async (id) => (await window.memoriaDesktop.play.sources()).some((source) => source.id === id),
    synthetic.sourceId,
  );
  expect(available).toBe(true);
  expect(
    await page.evaluate(
      async (sourceId) =>
        window.memoriaDesktop.play.configure({
          enabled: true,
          background: true,
          hotkey: 'CommandOrControl+Shift+M',
          sourceId,
          gameId: 'native-archive-game',
        }),
      synthetic.sourceId,
    ),
  ).toMatchObject({ enabled: true, sourceId: synthetic.sourceId });
  await desktop.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id).focus(), synthetic.id);
  await expect
    .poll(() => desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getFocusedWindow()?.id))
    .toBe(synthetic.id);
  let captureTimeout;
  let captured;
  try {
    captured = await Promise.race([
      page.evaluate(async () => window.memoriaDesktop.play.capture()),
      new Promise((_, reject) => {
        captureTimeout = setTimeout(
          () => reject(new Error('The selected-window OCR check exceeded 30 seconds.')),
          30_000,
        );
        captureTimeout.unref();
      }),
    ]);
  } finally {
    clearTimeout(captureTimeout);
  }
  expect(captured.count).toBe(1);
  expect(captured.pending[0].text).toContain('123');
  expect(captured.pending[0]).toMatchObject({ gameId: 'native-archive-game', name: 'Memoria capture fixture' });
  expect(await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getFocusedWindow()?.id)).toBe(synthetic.id);
  const inboxFile = join(appdata, 'memoria/capture/state.json');
  const durableInbox = JSON.parse(readFileSync(inboxFile, 'utf8'));
  expect(durableInbox.pending[0].id).toBe(captured.pending[0].id);
  expect(durableInbox.pending[0]).not.toHaveProperty('base64');
  await desktop.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id).destroy(), synthetic.id);
  await desktop.evaluate(({ app }) => app.emit('activate'));

  await page.getByRole('button', { name: 'Play mode', exact: true }).click();
  await page.getByRole('button', { name: 'Review capture', exact: true }).click();
  const importDialog = page.getByRole('dialog', { name: 'Import game readings' });
  await expect(importDialog.getByLabel('Text from the screenshot')).toHaveValue(/123/);
  await importDialog.getByRole('button', { name: 'Review readings', exact: true }).click();
  await importDialog.getByRole('button', { name: 'Apply reviewed readings', exact: true }).click();
  await expect.poll(latestEnergy).toBe(123);
  await expect.poll(async () => (await page.evaluate(async () => window.memoriaDesktop.play.status())).count).toBe(0);
  await importDialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(importDialog).toBeHidden();
  await expect(page.getByLabel('Archive energy current value', { exact: true })).toHaveValue('123');
  // The source was closed; disable capture without altering tray behavior.
  await page.evaluate(async () =>
    window.memoriaDesktop.play.configure({
      enabled: false,
      background: true,
      hotkey: 'CommandOrControl+Shift+M',
      sourceId: '',
      gameId: 'native-archive-game',
    }),
  );
  await page.screenshot({ path: join(root, 'dist/native-desktop.png') });
  // Quit, unlike Close window, still flushes a focused editor while tray mode is on.
  await page.getByLabel('Archive energy current value', { exact: true }).fill('124');
  await closeWindow(true);
  expect(latestEnergy()).toBe(124);
  checkExistingData();
  expect(errors).toEqual([]);
  console.log(
    JSON.stringify({
      native:
        'PASS: bundled executable, isolated renderer, responsive native resizing, existing PC data, close and quit flush, relaunch, single instance, tray hide and reopen, unsaved draft, backend recovery, phone pairing, disk sync, blocked remote navigation, authenticated play mode, selected-window OCR without focus stealing, durable capture inbox, reviewed import',
      screenshot: 'dist/native-desktop.png',
    }),
  );
} catch (error) {
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
