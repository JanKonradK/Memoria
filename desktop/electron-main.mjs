import { app, BrowserWindow, dialog, ipcMain, Menu, screen, shell, utilityProcess } from 'electron';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { externalUrl, isAppUrl, launchOrigin, windowBounds } from './native-policy.mjs';
import { createGameLaunch, LAUNCH_EXTENSIONS } from './game-launch.mjs';
import { fetchLatestRelease, paths, readReleaseRecord, stagedVersion, stageRelease } from './update.mjs';

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
let launch;
let requestedVisibility;
let visibilityTimer;
let visibilityRevision = 0;
let focusPending = false;
let latestRelease;
let downloading;
let installOnQuit = false;
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

for (const [channel, action] of Object.entries({
  'memoria:launch-list': () => launch.list(),
  'memoria:launch-choose': (gameId) => launch.choose(gameId),
  'memoria:launch-clear': (gameId) => launch.clear(gameId),
  'memoria:launch-start': (gameId) => launch.start(gameId),
})) {
  ipcMain.handle(channel, (event, argument) => {
    if (!trustedSender(event) || !launch || quitting) throw new Error('This action is only available in Memoria.');
    return action(argument);
  });
}

// Updates: the renderer asks, the main process talks to GitHub (the window's
// content policy only allows its own origin) and installs after the window has
// saved and closed, by running the new build's own installer.
const updateActions = {
  'memoria:update-check': async () => {
    const record = readReleaseRecord(root);
    latestRelease = await fetchLatestRelease(record?.version ?? null);
    return {
      installed: record?.version ?? null,
      release: latestRelease,
      staged: stagedVersion(root),
    };
  },
  'memoria:update-download': () => {
    if (!latestRelease) throw new Error('Check for updates first.');
    const release = latestRelease;
    let lastSent = 0;
    downloading ??= stageRelease(root, release, (received, total) => {
      const now = Date.now();
      if (now - lastSent < 200 || !window || window.isDestroyed()) return;
      lastSent = now;
      window.webContents.send('memoria:update-progress', { received, total });
    }).finally(() => {
      downloading = undefined;
    });
    return downloading;
  },
  'memoria:update-install': () => {
    if (!stagedVersion(root)) throw new Error('Download the update first.');
    installOnQuit = true;
    requestClose();
    return true;
  },
};
for (const [channel, action] of Object.entries(updateActions)) {
  ipcMain.handle(channel, (event) => {
    if (!trustedSender(event) || quitting) throw new Error('This action is only available in Memoria.');
    return action();
  });
}

/**
 * Waits for this process tree to exit, installs the staged build over this
 * install with its own installer, then reopens Memoria — the new build, or the
 * old one if the install failed and rolled back.
 */
function runStagedInstaller() {
  const installer = join(paths.PENDING_DIR, 'desktop', 'Install-Shortcut.ps1');
  const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
  const script = [
    "$ErrorActionPreference = 'Continue'",
    `$log = ${quote(join(paths.UPDATE_DIR, 'install.log'))}`,
    `Wait-Process -Id ${process.pid} -Timeout 60 -ErrorAction SilentlyContinue`,
    '$installed = $false',
    'foreach ($attempt in 1..20) {',
    `  & ${quote(installer)} -InstallRoot ${quote(root)} -NoShortcuts *> $log`,
    '  if ($?) { $installed = $true; break }',
    '  Start-Sleep -Milliseconds 500',
    '}',
    `if ($installed) { Remove-Item -LiteralPath ${quote(paths.PENDING_DIR)} -Recurse -Force -ErrorAction SilentlyContinue; Remove-Item -LiteralPath ${quote(paths.PENDING_MANIFEST)} -Force -ErrorAction SilentlyContinue }`,
    'Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue',
    `Start-Process -FilePath ${quote(join(root, 'Memoria.exe'))} -WorkingDirectory ${quote(root)}`,
  ].join('\n');
  const scriptFile = join(paths.UPDATE_DIR, 'install-update.ps1');
  // A byte-order mark keeps Windows PowerShell from misreading non-ASCII paths.
  writeFileSync(scriptFile, `\uFEFF${script}\n`, 'utf8');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  // PowerShell started straight from a detached child of this window exits
  // without running anything, so `start` launches it on its own instead.
  spawn(
    process.env.ComSpec || 'cmd.exe',
    [
      '/d',
      '/s',
      '/c',
      `"start "" /b powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${scriptFile}""`,
    ],
    { detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true, env },
  ).unref();
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
    installOnQuit = false;
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
    window?.destroy();
    app.quit();
    return;
  }
  // A refused close also cancels the install it was asked for.
  installOnQuit = false;
  if (typeof result.error === 'string' && result.error) {
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
  contents.on('before-input-event', (event, input) => {
    // The main keyboard and number pad report different keys for zoom in.
    if (
      input.type === 'keyDown' &&
      (input.control || input.meta) &&
      !input.alt &&
      (input.key === '+' || input.key === '=')
    ) {
      event.preventDefault();
      contents.setZoomLevel(contents.getZoomLevel() + 0.5);
    }
  });
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
            label: 'Check for updates',
            click: () => {
              focusWindow();
              window?.webContents.send('memoria:show-updates');
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
  launch = createGameLaunch({
    dataDir: data,
    // The only source of a launch path: a file the player picks in a native dialog.
    pick: async () => {
      const result = await dialog.showOpenDialog(window, {
        title: 'Choose the game or its launcher',
        buttonLabel: 'Use this',
        properties: ['openFile'],
        filters: [{ name: 'Programs and shortcuts', extensions: LAUNCH_EXTENSIONS }],
      });
      return result.canceled ? undefined : result.filePaths[0];
    },
    open: (path) => shell.openPath(path),
  });
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
    if (installOnQuit) {
      installOnQuit = false;
      runStagedInstaller();
    }
    quitting = true;
    cancelWindowVisibility();
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
