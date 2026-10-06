import { fetchGameAccounts, filterHoyoCookies, validateConnection } from './game-connections.mjs';
import { windowBounds } from './native-policy.mjs';

const LOGIN_URL = 'https://www.hoyolab.com/';

export function allowedHoyoLoginUrl(value) {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      (!url.port || url.port === '443') &&
      ['hoyolab.com', 'hoyoverse.com'].some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))
    );
  } catch {
    return false;
  }
}

/** This helper is main-process only. The official page never receives a preload or app IPC. */
export function createHoyoLogin({
  BrowserWindow,
  session,
  Menu,
  dialog,
  screen,
  getParent,
  connectAccount,
  fetcher = fetch,
}) {
  const isolated = session.fromPartition('persist:memoria-hoyolab', { cache: false });
  isolated.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  isolated.setPermissionCheckHandler(() => false);
  isolated.on('will-download', (event) => event.preventDefault());
  let loginWindow;
  let pendingLogin;
  let closed = false;
  let generation = 0;

  async function cookies() {
    if (closed) throw new Error('The account window is closed. Reopen Memoria.');
    const saved = await isolated.cookies.get({ url: LOGIN_URL });
    try {
      return filterHoyoCookies(saved.map(({ name, value }) => `${name}=${value}`).join('; '));
    } catch {
      throw new Error('Sign in to HoYoLAB on this PC first.');
    }
  }

  return {
    connect() {
      if (closed) return Promise.reject(new Error('Reopen Memoria to sign in.'));
      if (pendingLogin) {
        loginWindow?.show();
        loginWindow?.focus();
        return pendingLogin;
      }
      generation += 1;
      let resolveLogin;
      let rejectLogin;
      pendingLogin = new Promise((resolve, reject) => {
        resolveLogin = resolve;
        rejectLogin = reject;
      });
      const result = pendingLogin;
      let completed = false;
      let finishing = false;
      try {
        const parent = getParent();
        const area = screen?.getDisplayMatching(parent?.getBounds() ?? { x: 0, y: 0, width: 1040, height: 800 })
          .workArea ?? { x: 0, y: 0, width: 1040, height: 800 };
        const bounds = windowBounds(
          { x: area.x + (area.width - 1040) / 2, y: area.y + (area.height - 800) / 2, width: 1040, height: 800 },
          [{ workArea: area }],
        );
        loginWindow = new BrowserWindow({
          parent,
          ...bounds,
          minWidth: Math.min(480, bounds.width),
          minHeight: Math.min(360, bounds.height),
          title: 'HoYoLAB sign-in — www.hoyolab.com',
          autoHideMenuBar: false,
          webPreferences: {
            session: isolated,
            contextIsolation: true,
            sandbox: true,
            nodeIntegration: false,
            webSecurity: true,
            webviewTag: false,
            spellcheck: false,
          },
        });
        const current = loginWindow;
        const contents = current.webContents;
        const showError = (message) => {
          if (!current.isDestroyed())
            void dialog.showMessageBox(current, {
              type: 'warning',
              title: 'HoYoLAB sign-in',
              message,
              buttons: ['OK'],
            });
        };
        const done = async () => {
          if (finishing || current.isDestroyed()) return;
          finishing = true;
          try {
            await cookies();
            await isolated.cookies.flushStore();
            if (current.isDestroyed()) return;
            completed = true;
            resolveLogin({ connected: true });
            current.destroy();
          } catch {
            showError('Finish signing in to HoYoLAB, then select Done. Your session stays on this PC.');
          } finally {
            finishing = false;
          }
        };
        current.setMenu(
          Menu.buildFromTemplate([
            { label: 'Done', accelerator: 'CommandOrControl+Enter', click: () => void done() },
            { label: 'Cancel', accelerator: 'Escape', click: () => current.close() },
          ]),
        );
        const protectNavigation = (event, url) => {
          if (!allowedHoyoLoginUrl(url)) event.preventDefault();
        };
        contents.on('will-navigate', protectNavigation);
        contents.on('will-redirect', protectNavigation);
        contents.on('will-attach-webview', (event) => event.preventDefault());
        contents.setWindowOpenHandler(({ url }) => {
          if (allowedHoyoLoginUrl(url))
            void current.loadURL(url).catch(() => showError('HoYoLAB could not open. Try again.'));
          return { action: 'deny' };
        });
        contents.on('page-title-updated', (event) => event.preventDefault());
        contents.on('did-navigate', (_event, url) => {
          if (allowedHoyoLoginUrl(url)) current.setTitle(`HoYoLAB sign-in — ${new URL(url).hostname}`);
        });
        current.on('closed', () => {
          loginWindow = undefined;
          pendingLogin = undefined;
          if (!completed) rejectLogin(new Error('HoYoLAB sign-in cancelled.'));
        });
        // Retain the bundled Chromium version; omit the app token that sites may reject.
        const userAgent = contents.getUserAgent().replace(/\s(?:Electron|Memoria)\/[^\s]+/g, '');
        void current
          .loadURL(LOGIN_URL, { userAgent })
          .catch(() => showError('HoYoLAB could not open. Check your internet connection, then try again.'));
      } catch {
        loginWindow?.destroy();
        loginWindow = undefined;
        pendingLogin = undefined;
        rejectLogin(new Error('The HoYoLAB sign-in page could not open.'));
      }
      return result;
    },
    async listAccounts({ provider } = {}) {
      const started = generation;
      const result = await fetchGameAccounts({ provider, cookie: await cookies() }, fetcher);
      if (generation !== started) throw new Error('The HoYoLAB sign-in changed. Find accounts again.');
      return result;
    },
    async connectAccount(input) {
      const started = generation;
      // Validation reconstructs a bounded payload and drops all unexpected fields.
      const entry = validateConnection({ ...input, cookie: await cookies() });
      if (generation !== started) throw new Error('The HoYoLAB sign-in changed. Connect the account again.');
      return connectAccount({ ...entry, action: 'connect' });
    },
    async disconnect() {
      generation += 1;
      loginWindow?.destroy();
      try {
        await isolated.clearStorageData();
        await isolated.cookies.flushStore();
      } catch {
        throw new Error(
          'The account was disconnected, but its local sign-in could not be cleared. Try signing out again.',
        );
      }
      return { connected: false };
    },
    dispose() {
      closed = true;
      loginWindow?.destroy();
    },
  };
}
