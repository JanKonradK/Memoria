import {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  screen,
  session,
  shell,
  Tray,
  utilityProcess,
} from 'electron';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, watch, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { externalUrl, isAppUrl, launchOrigin, windowBounds } from './native-policy.mjs';
import { createPlayMode } from './play-mode.mjs';
import { createHoyoLogin } from './hoyo-login.mjs';
import { createBrowserConnections } from './browser-bridge.mjs';

const here = import.meta.dirname;
const root = resolve(here, '..');
const data = join(process.env.APPDATA ?? app.getPath('appData'), 'memoria');
mkdirSync(join(data, 'desktop-profile'), { recursive: true });
app.setName('Memoria');
app.setPath('userData', join(data, 'desktop-profile'));
app.setAppUserModelId('app.memoria.tracker');

let window;
let backend;
let origin;
let quitting = false;
let pendingClose;
let closeTimer;
let healthTimer;
let recovering = false;
let recoveryErrorShown = false;
let ready = false;
let play;
let hoyo;
let tray;
let browserConnections;
let browserWatch;
let browserUpdateTimer;
let requestedVisibility;
let visibilityTimer;
let visibilityRevision = 0;
let focusPending = false;
const boundsFile = join(data, 'desktop-window.json');
// A restarted utility process retains this window's API session. It never goes to disk.
const backendSession = randomBytes(32).toString('base64url');

function cancelWindowVisibility() {
  requestedVisibility = undefined;
  focusPending = false;
  ++visibilityRevision;
  clearTimeout(visibilityTimer);
}

function setWindowVisible(visible, focus = false) {
  if (!window || window.isDestroyed() || quitting) return;
  requestedVisibility = visible;
  if (focus) focusPending = true;
  else if (!visible) focusPending = false;
  const target = window;
  const revision = ++visibilityRevision;
  const deadline = Date.now() + 1000;
  clearTimeout(visibilityTimer);
  const apply = () => {
    if (target !== window || target.isDestroyed() || quitting || revision !== visibilityRevision) return;
    if (visible) {
      if (target.isMinimized()) target.restore();
      target.showInactive();
      if (focusPending && target.isVisible()) {
        focusPending = false;
        target.focus();
      }
    } else target.hide();
    if (target.isVisible() !== visible && Date.now() < deadline) visibilityTimer = setTimeout(apply, 50);
  };
  // Windows can finish a prior native restore after close or activate returns.
  // Keep the latest visibility request, without repeated focus changes.
  setImmediate(apply);
}

function reconcileWindowVisibility() {
  if (
    requestedVisibility !== undefined &&
    window &&
    !window.isDestroyed() &&
    !window.isMinimized() &&
    window.isVisible() !== requestedVisibility
  )
    setWindowVisible(requestedVisibility);
}

function focusWindow() {
  setWindowVisible(true, true);
}

function trustedSender(event) {
  return (
    window &&
    !window.isDestroyed() &&
    event.sender === window.webContents &&
    event.senderFrame === window.webContents.mainFrame &&
    isAppUrl(event.senderFrame.url, origin)
  );
}

/** The session token stays in this app; account cookies never enter its renderer. */
async function nativeApi(path, body) {
  if (!window || window.isDestroyed() || !isAppUrl(window.webContents.getURL(), origin))
    throw new Error('Wait for Memoria to open.');
  const token = await window.webContents.executeJavaScript("sessionStorage.getItem('memoria-launcher-token')");
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token))
    throw new Error('The local data service is reconnecting. Try again.');
  const response = await fetch(`${origin}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Origin: origin,
      'sec-fetch-site': 'same-origin',
      'content-type': 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    redirect: 'error',
    signal: AbortSignal.timeout(30000),
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(
      typeof result?.error === 'string' ? result.error : 'The local data service could not complete this action.',
    );
  return result;
}

function openPlay() {
  focusWindow();
  if (ready) window.webContents.send('memoria:play-open');
}

async function setupBrowserConnector() {
  await new Promise((resolveSetup, reject) => {
    const installer = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        join(here, 'Register-Browser-Connector.ps1'),
      ],
      { windowsHide: true, stdio: 'ignore' },
    );
    installer.once('error', () =>
      reject(
        new Error(
          'Windows could not set up the browser connector. Install the latest Memoria Windows package and try again.',
        ),
      ),
    );
    installer.once('exit', (code) =>
      code === 0
        ? resolveSetup()
        : reject(
            new Error(
              'The browser connector could not be registered. Install the latest Memoria Windows package and try again.',
            ),
          ),
    );
  });
  const folder = join(root, 'browser-extension');
  const error = await shell.openPath(folder);
  if (error)
    throw new Error(
      'The connector is registered, but Windows could not open its folder. Open the browser-extension folder inside your Memoria installation.',
    );
  return { folder };
}

function watchBrowserReadings() {
  try {
    browserWatch = watch(data, { persistent: false }, (_event, filename) => {
      if (String(filename) !== 'browser-readings.json' || quitting) return;
      clearTimeout(browserUpdateTimer);
      browserUpdateTimer = setTimeout(() => {
        if (window && !window.isDestroyed() && isAppUrl(window.webContents.getURL(), origin)) {
          window.webContents.send('memoria:browser-readings');
        }
      }, 100);
    });
    // Five-minute polling remains available if the OS stops file notifications.
    browserWatch.on('error', () => browserWatch?.close());
  } catch {
    /* The next scheduled account check reads the same saved snapshot. */
  }
}

function updatePlay() {
  if (!play || quitting) return;
  const status = play.status();
  if (window && !window.isDestroyed()) {
    window.webContents.setBackgroundThrottling(false);
    if (isAppUrl(window.webContents.getURL(), origin)) window.webContents.send('memoria:play-changed');
  }
  if (!tray) return;
  tray.setToolTip(
    status.error
      ? `Memoria — ${status.error}`.slice(0, 127)
      : `Memoria — ${status.count} captures to review${status.busy ? ' · Reading…' : ''}`,
  );
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open Memoria', click: focusWindow },
      { label: status.count ? `Review ${status.count} captures` : 'Play mode', click: openPlay },
      {
        label: 'Capture selected game window',
        enabled: status.enabled && !status.busy && Boolean(status.sourceId),
        click: () => void play.capture().catch(updatePlay),
      },
      { type: 'separator' },
      { label: 'Quit Memoria', click: requestClose },
    ]),
  );
}

for (const [channel, action] of Object.entries({
  'memoria:play-status': () => play.status(),
  'memoria:play-sources': () => play.sources(),
  'memoria:play-configure': async (config) => {
    const result = await play.configure(config);
    if (!result.background) focusWindow();
    updatePlay();
    return result;
  },
  'memoria:play-capture': async () => {
    await play.capture();
    return play.status();
  },
  'memoria:play-remove': async (id) => {
    await play.remove(id);
    return play.status();
  },
  'memoria:hoyo-connect': () => hoyo.connect(),
  'memoria:hoyo-disconnect': () => hoyo.disconnect(),
  'memoria:hoyo-accounts': (options) => hoyo.listAccounts(options),
  'memoria:hoyo-link': (options) => hoyo.connectAccount(options),
  'memoria:browser-setup': () => setupBrowserConnector(),
  'memoria:browser-status': () => browserConnections.status(),
  'memoria:browser-accounts': (options) => browserConnections.listAccounts(options),
  'memoria:browser-request': (body) => browserConnections.request(body),
})) {
  ipcMain.handle(channel, (event, argument) => {
    if (!trustedSender(event) || !play || !hoyo || !browserConnections || quitting)
      throw new Error('This action is only available in Memoria.');
    return action(argument);
  });
}

function saveBounds() {
  if (!window || window.isDestroyed()) return;
  try {
    writeFileSync(boundsFile, JSON.stringify({ ...window.getNormalBounds(), maximized: window.isMaximized() }));
  } catch {
    /* Window placement is optional; app data has its own save boundary. */
  }
}

async function openExternal(value) {
  const url = externalUrl(value);
  if (!url) return;
  try {
    await shell.openExternal(url);
  } catch {
    dialog.showErrorBox('Memoria', 'Windows could not open this link.');
  }
}

function allowPhoneSync() {
  const setup = spawn(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(here, 'Enable-Phone-Sync.ps1')],
    {
      windowsHide: true,
      stdio: 'ignore',
    },
  );
  setup.on('error', () => dialog.showErrorBox('Memoria phone sync', 'Windows could not open the network setup.'));
  setup.on('exit', (code) => {
    if (!window || window.isDestroyed()) return;
    void dialog.showMessageBox(window, {
      type: code === 0 ? 'info' : 'warning',
      title: 'Memoria phone sync',
      message:
        code === 0
          ? 'Windows now allows your phone to connect to Memoria on this local network.'
          : 'Windows did not allow the network change. Approve the administrator prompt to enable phone sync.',
      buttons: ['OK'],
    });
  });
}

function requestClose() {
  if (!window || window.isDestroyed() || pendingClose) return;
  focusWindow();
  if (!ready) {
    quitting = true;
    window.destroy();
    app.quit();
    return;
  }
  pendingClose = randomUUID();
  window.webContents.send('memoria:close-request', pendingClose);
  closeTimer = setTimeout(() => {
    pendingClose = undefined;
    if (window && !window.isDestroyed()) {
      void dialog.showMessageBox(window, {
        type: 'warning',
        title: 'Memoria is still saving',
        message: 'Memoria could not confirm that your changes were saved.',
        detail: 'Keep the app open. Check the connection, then try closing it again.',
        buttons: ['Keep open'],
      });
    }
  }, 30000);
}

ipcMain.on('memoria:renderer-ready', (event) => {
  if (
    window &&
    event.sender === window.webContents &&
    event.senderFrame === window.webContents.mainFrame &&
    isAppUrl(event.senderFrame.url, origin)
  )
    ready = true;
});

ipcMain.on('memoria:close-result', (event, requestId, result) => {
  if (
    !window ||
    event.sender !== window.webContents ||
    event.senderFrame !== window.webContents.mainFrame ||
    !isAppUrl(event.senderFrame.url, origin) ||
    !pendingClose ||
    requestId !== pendingClose ||
    typeof result?.allow !== 'boolean'
  )
    return;
  clearTimeout(closeTimer);
  pendingClose = undefined;
  if (result.allow) {
    saveBounds();
    quitting = true;
    // The renderer has checked drafts and awaited both storage layers.
    void Promise.resolve(play?.stop()).finally(() => {
      window?.destroy();
      app.quit();
    });
  } else if (typeof result.error === 'string' && result.error) {
    void dialog.showMessageBox(window, {
      type: 'warning',
      title: 'Keep Memoria open',
      message: result.error.slice(0, 500),
      buttons: ['OK'],
    });
  }
});

function startBackend() {
  return new Promise((resolveReady, reject) => {
    const worker = utilityProcess.fork(join(here, 'memoria.mjs'), [], {
      cwd: root,
      stdio: 'pipe',
      serviceName: 'Memoria local data and phone sync',
      env: {
        ...process.env,
        MEMORIA_NO_BROWSER: '1',
        MEMORIA_DESKTOP_HOST: '1',
        MEMORIA_DESKTOP_SESSION: backendSession,
      },
    });
    backend = worker;
    let settled = false;
    let ownsServer = false;
    let failure = '';
    // Launch tickets stay on the private process channel, never in app logs.
    worker.stdout?.resume();
    worker.stderr?.on('data', (chunk) => {
      failure = (failure + chunk).slice(-2000);
    });
    const timeout = setTimeout(() => {
      settled = true;
      worker.kill();
      reject(new Error('The local data service did not start within 30 seconds.'));
    }, 30000);
    worker.on('message', (message) => {
      if (settled || message?.type !== 'memoria-ready') return;
      const verified = launchOrigin(message.url);
      if (!verified) return;
      settled = true;
      clearTimeout(timeout);
      if (origin && origin !== verified) {
        worker.kill();
        reject(
          new Error(
            'The original Memoria port is now in use. Close the other program, then restart Memoria. Your saved data is unchanged.',
          ),
        );
        return;
      }
      ownsServer = message.ownsServer === true;
      origin = verified;
      resolveReady(message.url);
    });
    worker.on('exit', () => {
      clearTimeout(timeout);
      if (!settled) {
        settled = true;
        reject(new Error(failure || 'The local data service stopped before Memoria opened.'));
      } else if (ownsServer && !quitting) void recoverBackend();
    });
  });
}

async function recoverBackend() {
  if (quitting || recovering || !window || window.isDestroyed()) return;
  recovering = true;
  try {
    const url = await startBackend();
    // Consume a fresh, authenticated one-use ticket without navigating away from
    // live editor drafts. This also works when reusing a browser-era server.
    const response = await fetch(url, { signal: AbortSignal.timeout(10000), redirect: 'error' });
    const html = response.ok ? await response.text() : '';
    const token = html.match(/const token = "([A-Za-z0-9_-]{43})";/)?.[1];
    if (!token) throw new Error('The local service could not restore this app session.');
    if (window && !window.isDestroyed() && isAppUrl(window.webContents.getURL(), origin)) {
      window.webContents.send('memoria:launcher-session', { origin, token });
    }
    recoveryErrorShown = false;
  } catch (error) {
    if (!recoveryErrorShown && window && !window.isDestroyed()) {
      recoveryErrorShown = true;
      void dialog.showMessageBox(window, {
        type: 'warning',
        title: 'Memoria sync stopped',
        message: 'Memoria will retry the local data service.',
        detail: error.message,
        buttons: ['Keep open'],
      });
    }
  } finally {
    recovering = false;
  }
}

function watchBackend() {
  healthTimer = setInterval(() => {
    if (quitting || recovering) return;
    const nonce = randomBytes(32).toString('base64url');
    void fetch(`${origin}/.memoria/hello?nonce=${nonce}`, { signal: AbortSignal.timeout(2500) })
      .then((response) => {
        if (!response.ok || response.headers.get('x-memoria') !== '1') void recoverBackend();
      })
      .catch(() => {
        void recoverBackend();
      });
  }, 5000);
}

async function createWindow() {
  const url = await startBackend();
  let saved;
  try {
    saved = JSON.parse(readFileSync(boundsFile, 'utf8'));
  } catch {
    /* First launch. */
  }
  window = new BrowserWindow({
    ...windowBounds(saved, screen.getAllDisplays()),
    minWidth: Math.min(360, screen.getPrimaryDisplay().workArea.width),
    minHeight: Math.min(480, screen.getPrimaryDisplay().workArea.height),
    title: 'Memoria',
    icon: join(here, 'memoria.ico'),
    backgroundColor: '#101015',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(here, 'electron-preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      webviewTag: false,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });
  const contents = window.webContents;
  window.on('focus', reconcileWindowVisibility);
  window.on('blur', reconcileWindowVisibility);
  window.on('minimize', cancelWindowVisibility);
  await contents.session.clearStorageData({ storages: ['serviceworkers', 'cachestorage'] });
  const fileGrants = new Set();
  const grantKey = (details) => `${details.fileAccessType}:${details.filePath}`;
  contents.session.setPermissionRequestHandler((sender, permission, callback, details) => {
    if (sender === contents && isAppUrl(details.requestingUrl, origin) && permission === 'clipboard-sanitized-write') {
      callback(true);
      return;
    }
    if (
      sender !== contents ||
      !isAppUrl(details.requestingUrl, origin) ||
      permission !== 'fileSystem' ||
      typeof details.filePath !== 'string'
    ) {
      callback(false);
      return;
    }
    void dialog
      .showMessageBox(window, {
        type: 'question',
        title: 'Allow folder sync?',
        message: `Allow Memoria to ${details.fileAccessType === 'writable' ? 'read and write' : 'read'} this location?`,
        detail: details.filePath,
        buttons: ['Cancel', 'Allow'],
        defaultId: 0,
        cancelId: 0,
      })
      .then(({ response }) => {
        if (response === 1) fileGrants.add(grantKey(details));
        callback(response === 1);
      })
      .catch(() => callback(false));
  });
  contents.session.setPermissionCheckHandler(
    (sender, permission, requestingOrigin, details) =>
      sender === contents &&
      isAppUrl(requestingOrigin, origin) &&
      (permission === 'clipboard-sanitized-write' ||
        (permission === 'fileSystem' && fileGrants.has(grantKey(details)))),
  );
  contents.on('will-attach-webview', (event) => event.preventDefault());
  const protectNavigation = (event, target) => {
    if (!isAppUrl(target, origin)) event.preventDefault();
  };
  contents.on('will-navigate', protectNavigation);
  contents.on('will-redirect', protectNavigation);
  contents.setWindowOpenHandler(({ url: target }) => {
    void openExternal(target);
    return { action: 'deny' };
  });
  contents.on('will-prevent-unload', (event) => {
    const choice = dialog.showMessageBoxSync(window, {
      type: 'question',
      title: 'Leave this screen?',
      message: 'Reload Memoria and discard unsaved changes?',
      buttons: ['Keep editing', 'Reload'],
      defaultId: 0,
      cancelId: 0,
    });
    if (choice === 1) event.preventDefault();
  });
  contents.on('render-process-gone', () => {
    ready = false;
    clearTimeout(closeTimer);
    pendingClose = undefined;
    void dialog
      .showMessageBox(window, {
        type: 'error',
        title: 'Memoria',
        message: 'The app window stopped. Reload your saved data?',
        buttons: ['Reload', 'Close'],
        defaultId: 0,
        cancelId: 1,
      })
      .then(({ response }) => {
        if (response === 0) contents.reload();
        else requestClose();
      });
  });
  contents.on('did-start-navigation', (_event, _url, inPlace, isMainFrame) => {
    if (isMainFrame && !inPlace) ready = false;
  });
  window.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    if (ready && tray && play?.status().background && !pendingClose) {
      saveBounds();
      setWindowVisible(false);
      return;
    }
    requestClose();
  });
  window.on('closed', () => {
    cancelWindowVisibility();
    window = undefined;
  });
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'File',
        submenu: [
          { label: 'Play mode', click: openPlay },
          { label: 'Close window', accelerator: 'Alt+F4', click: () => window.close() },
          { label: 'Quit Memoria', accelerator: 'CommandOrControl+Q', click: requestClose },
        ],
      },
      {
        label: 'Edit',
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'selectAll' },
        ],
      },
      {
        label: 'View',
        submenu: [{ role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }],
      },
      {
        label: 'Help',
        submenu: [
          { label: 'Allow phone sync through Windows', click: allowPhoneSync },
          {
            label: 'Download updates',
            click: () => {
              void openExternal('https://github.com/JanKonradK/Memoria/releases/latest');
            },
          },
          {
            label: 'About Memoria',
            click: () => {
              void dialog.showMessageBox(window, {
                title: 'Memoria',
                message: 'Memoria for Windows',
                detail:
                  'Your games, saved on this PC.\nIncludes its own desktop runtime.\nPhone sync is available while Memoria is open.',
                buttons: ['OK'],
              });
            },
          },
        ],
      },
    ]),
  );
  await window.loadURL(url);
  play = createPlayMode({
    dataDir: data,
    desktopCapturer,
    globalShortcut,
    getWindow: () => window,
    getGames: async () => (await nativeApi('/api/state')).state.games.filter((game) => !game.deleted),
    onChange: updatePlay,
  });
  hoyo = createHoyoLogin({
    BrowserWindow,
    session,
    Menu,
    dialog,
    screen,
    getParent: () => window,
    connectAccount: (body) => nativeApi('/api/connections', body),
  });
  browserConnections = createBrowserConnections({
    directory: data,
    getGames: async () => (await nativeApi('/api/state')).state.games.filter((game) => !game.deleted),
  });
  watchBrowserReadings();
  await play.start();
  tray = new Tray(join(here, 'memoria.ico'));
  tray.on('double-click', focusWindow);
  updatePlay();
  const fitDisplay = () => {
    if (!window || window.isDestroyed() || window.isMaximized() || window.isFullScreen()) return;
    const display = screen.getDisplayMatching(window.getBounds());
    window.setMinimumSize(Math.min(360, display.workArea.width), Math.min(480, display.workArea.height));
    window.setBounds(windowBounds(window.getBounds(), screen.getAllDisplays()));
  };
  screen.on('display-removed', fitDisplay);
  screen.on('display-metrics-changed', fitDisplay);
  watchBackend();
  if (saved?.maximized) window.maximize();
  window.show();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', focusWindow);
  app.on('activate', focusWindow);
  app.on('before-quit', (event) => {
    if (window && !window.isDestroyed() && !quitting) {
      event.preventDefault();
      requestClose();
    }
  });
  app.on('will-quit', () => {
    quitting = true;
    cancelWindowVisibility();
    clearTimeout(closeTimer);
    clearInterval(healthTimer);
    clearTimeout(browserUpdateTimer);
    browserWatch?.close();
    globalShortcut.unregisterAll();
    hoyo?.dispose();
    tray?.destroy();
    backend?.kill();
  });
  app.on('window-all-closed', () => app.quit());
  void app
    .whenReady()
    .then(createWindow)
    .catch((error) => {
      dialog.showErrorBox('Memoria could not start', error.message);
      quitting = true;
      app.quit();
    });
}
