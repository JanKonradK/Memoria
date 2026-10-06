import { app, BrowserWindow, dialog, ipcMain, Menu, screen, shell, utilityProcess } from 'electron';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { externalUrl, isAppUrl, launchOrigin, windowBounds } from './native-policy.mjs';

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
const boundsFile = join(data, 'desktop-window.json');
// A restarted utility process retains this window's API session. It never goes to disk.
const backendSession = randomBytes(32).toString('base64url');

function focusWindow() {
  if (!window || window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
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

function requestClose() {
  if (!window || window.isDestroyed() || pendingClose) return;
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
    window.destroy();
    app.quit();
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
    minWidth: 800,
    minHeight: 600,
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
    },
  });
  const contents = window.webContents;
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
    requestClose();
  });
  window.on('closed', () => {
    window = undefined;
  });
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { label: 'File', submenu: [{ label: 'Close Memoria', accelerator: 'Alt+F4', click: requestClose }] },
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
    clearTimeout(closeTimer);
    clearInterval(healthTimer);
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
