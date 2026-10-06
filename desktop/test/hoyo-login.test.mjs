import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { allowedHoyoLoginUrl, createHoyoLogin } from '../hoyo-login.mjs';

function setup(screen) {
  const windows = [];
  class Window extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.webContents = Object.assign(new EventEmitter(), {
        getUserAgent: () => 'Chrome/148 Electron/42 Memoria/3',
        setWindowOpenHandler: (handler) => {
          this.openHandler = handler;
        },
      });
      windows.push(this);
    }
    setMenu(value) {
      this.menu = value;
    }
    setTitle(value) {
      this.title = value;
    }
    loadURL = vi.fn(async () => undefined);
    show() {}
    focus() {}
    isDestroyed() {
      return this.destroyed === true;
    }
    destroy() {
      this.destroyed = true;
      this.emit('closed');
    }
    close() {
      this.destroy();
    }
  }
  const isolated = Object.assign(new EventEmitter(), {
    cookies: {
      get: vi.fn(async () => [
        { name: 'ltuid_v2', value: '123' },
        { name: 'ltoken_v2', value: 'private-session' },
        { name: 'analytics', value: 'unrelated' },
      ]),
      flushStore: vi.fn(async () => undefined),
    },
    setPermissionRequestHandler: vi.fn(),
    setPermissionCheckHandler: vi.fn(),
    clearStorageData: vi.fn(async () => undefined),
  });
  const connectAccount = vi.fn(async () => ({ connections: [] }));
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ retcode: 0, data: { list: [] } })));
  const dialog = { showMessageBox: vi.fn(async () => undefined) };
  const helper = createHoyoLogin({
    BrowserWindow: Window,
    session: { fromPartition: vi.fn(() => isolated) },
    Menu: { buildFromTemplate: (template) => template },
    dialog,
    screen,
    getParent: () => undefined,
    connectAccount,
    fetcher,
  });
  return { helper, windows, isolated, connectAccount, fetcher, dialog };
}

describe('isolated desktop HoYoLAB sign-in', () => {
  it('fits the sign-in window inside a small display work area', async () => {
    const { helper, windows } = setup({
      getDisplayMatching: () => ({ workArea: { x: -520, y: 10, width: 520, height: 400 } }),
    });
    const result = helper.connect();
    const rejected = expect(result).rejects.toThrow('cancelled');
    expect(windows[0].options).toMatchObject({
      x: -520,
      y: 10,
      width: 520,
      height: 400,
      minWidth: 480,
      minHeight: 360,
    });
    helper.dispose();
    await rejected;
  });

  it('restricts login destinations to official HTTPS hosts', () => {
    expect(allowedHoyoLoginUrl('https://www.hoyolab.com/')).toBe(true);
    expect(allowedHoyoLoginUrl('https://account.hoyoverse.com/')).toBe(true);
    for (const url of [
      'http://hoyolab.com',
      'https://hoyolab.com.evil.test',
      'https://hoyolab.com:444',
      'https://user@hoyolab.com',
      'file:///tmp/login',
    ])
      expect(allowedHoyoLoginUrl(url)).toBe(false);
  });

  it('opens a sandboxed window without preload and returns only connection status', async () => {
    const { helper, windows } = setup();
    const result = helper.connect();
    const login = windows[0];
    expect(login.options.webPreferences).toMatchObject({
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    });
    expect(login.options.webPreferences).not.toHaveProperty('preload');
    expect(login.loadURL).toHaveBeenCalledWith('https://www.hoyolab.com/', { userAgent: 'Chrome/148' });
    const event = { preventDefault: vi.fn() };
    login.webContents.emit('will-navigate', event, 'https://untrusted.test');
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(login.openHandler({ url: 'file:///secret' })).toEqual({ action: 'deny' });
    login.menu[0].click();
    await expect(result).resolves.toEqual({ connected: true });
    expect(login.isDestroyed()).toBe(true);
  });

  it('keeps an incomplete sign-in open and allows a safe cancellation', async () => {
    const { helper, isolated, windows, dialog } = setup();
    isolated.cookies.get.mockResolvedValue([]);
    const result = helper.connect();
    const rejected = expect(result).rejects.toThrow('cancelled');
    windows[0].menu[0].click();
    await vi.waitFor(() => expect(dialog.showMessageBox).toHaveBeenCalledOnce());
    expect(windows[0].isDestroyed()).toBe(false);
    windows[0].menu[1].click();
    await rejected;
  });

  it('passes a filtered cookie only to the native connection callback', async () => {
    const { helper, connectAccount } = setup();
    const result = await helper.connectAccount({
      gameId: 'g1',
      provider: 'genshin',
      uid: '700000001',
      server: 'os_euro',
      autoRefresh: true,
      cookie: 'renderer supplied secret',
      unexpected: 'ignored',
    });
    expect(connectAccount).toHaveBeenCalledWith({
      action: 'connect',
      gameId: 'g1',
      provider: 'genshin',
      uid: '700000001',
      server: 'os_euro',
      autoRefresh: true,
      cookie: 'ltuid_v2=123; ltoken_v2=private-session',
    });
    expect(JSON.stringify(result)).not.toContain('private-session');
    await expect(
      helper.connectAccount({ gameId: 'g1', provider: 'untrusted', uid: '700000001', server: 'os_euro' }),
    ).rejects.toThrow('supported');
    expect(connectAccount).toHaveBeenCalledOnce();
  });

  it('shares a pending login and cancels it when the host exits', async () => {
    const { helper, windows } = setup();
    const first = helper.connect();
    expect(helper.connect()).toBe(first);
    expect(windows).toHaveLength(1);
    const rejected = expect(first).rejects.toThrow('cancelled');
    helper.dispose();
    await rejected;
    await expect(helper.listAccounts({ provider: 'genshin' })).rejects.toThrow('closed');
  });

  it('clears only the isolated sign-in session when the final account is disconnected', async () => {
    const { helper, isolated } = setup();
    await expect(helper.disconnect()).resolves.toEqual({ connected: false });
    expect(isolated.clearStorageData).toHaveBeenCalledOnce();
    expect(isolated.cookies.flushStore).toHaveBeenCalledOnce();
  });

  it('does not reconnect from a stale cookie read after sign-out', async () => {
    const { helper, isolated, connectAccount } = setup();
    let resolve;
    isolated.cookies.get.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const result = helper.connectAccount({ gameId: 'g1', provider: 'genshin', uid: '700000001', server: 'os_euro' });
    const rejected = expect(result).rejects.toThrow('sign-in changed');
    await helper.disconnect();
    resolve([
      { name: 'ltuid', value: '123' },
      { name: 'ltoken', value: 'stale-session' },
    ]);
    await rejected;
    expect(connectAccount).not.toHaveBeenCalled();
  });
});
