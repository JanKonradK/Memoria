import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createGameCapture } from './game-capture.mjs';

export const PLAY_HOTKEYS = ['CommandOrControl+Shift+M', 'CommandOrControl+Shift+F8', 'CommandOrControl+Shift+F9'];
const DEFAULTS = { enabled: false, background: false, hotkey: PLAY_HOTKEYS[0], gameId: '', gameName: '' };
const GAME_ID = /^[\w-]{1,100}$/;
const fail = (message) => new Error(message);
const safeName = (value) =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= 255 &&
  ![...value].some((letter) => letter.charCodeAt(0) < 32);

function savedConfig(input) {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => !Object.hasOwn(DEFAULTS, key)) ||
    typeof input.enabled !== 'boolean' ||
    typeof input.background !== 'boolean' ||
    !PLAY_HOTKEYS.includes(input.hotkey) ||
    typeof input.gameId !== 'string' ||
    (input.gameId !== '' && !GAME_ID.test(input.gameId)) ||
    typeof input.gameName !== 'string' ||
    (input.gameName !== '' && (!safeName(input.gameName) || input.gameName.length > 200))
  )
    throw fail('Play mode settings could not be read. The saved file was kept.');
  return {
    enabled: input.enabled,
    background: input.background,
    hotkey: input.hotkey,
    gameId: input.gameId,
    gameName: input.gameName,
  };
}

/** Native host controller. A shortcut captures only a window explicitly selected this session. */
export function createPlayMode({
  dataDir,
  desktopCapturer,
  globalShortcut,
  getWindow = () => undefined,
  getGames = async () => [],
  onChange = () => {},
  recognize,
  now = Date.now,
} = {}) {
  if (typeof dataDir !== 'string' || !path.isAbsolute(dataDir)) throw fail('A local data directory is required.');
  const configFile = path.join(dataDir, 'play-mode.json');
  let config = { ...DEFAULTS };
  let selected;
  let registeredKey;
  let busy = false;
  let changing = false;
  let error;
  let loaded = false;
  let stopped = false;
  let operation = Promise.resolve();
  let activeCapture;
  const inbox = createGameCapture({ dataDir, ...(recognize ? { recognize } : {}), now });
  const status = () => ({
    ...config,
    sourceId: selected?.id || '',
    sourceName: selected?.name || '',
    registered: !!registeredKey && globalShortcut.isRegistered(registeredKey),
    busy,
    count: inbox.status().count,
    pending: inbox.pending(),
    ...(error ? { error } : {}),
  });
  function changed() {
    try {
      onChange(status());
    } catch {
      /* The host can recover on its next status request. */
    }
  }
  const serial = (fn) => {
    const result = operation.then(fn, fn);
    operation = result.catch(() => {});
    return result;
  };

  async function persist(next) {
    const temporary = path.join(dataDir, `play-mode-${randomUUID()}.tmp`);
    try {
      await mkdir(dataDir, { recursive: true, mode: 0o700 });
      await writeFile(temporary, JSON.stringify(next), { flag: 'wx', mode: 0o600 });
      await rename(temporary, configFile);
      config = next;
    } catch {
      throw fail('Play mode settings could not be saved. Check free disk space and try again.');
    } finally {
      await unlink(temporary).catch(() => {});
    }
  }

  async function load() {
    if (loaded) return;
    try {
      const stat = await lstat(configFile);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16_000) throw fail('settings');
      config = savedConfig(JSON.parse(await readFile(configFile, 'utf8')));
    } catch (cause) {
      if (cause.code !== 'ENOENT') throw fail('Play mode settings could not be read. The saved file was kept.');
    }
    await inbox.start();
    loaded = true;
  }

  function unregister() {
    if (registeredKey) globalShortcut.unregister(registeredKey);
    registeredKey = undefined;
  }

  function register() {
    unregister();
    if (!config.enabled || stopped) return;
    try {
      const registered = globalShortcut.register(config.hotkey, () => {
        void capture().catch(() => {});
      });
      if (registered) registeredKey = config.hotkey;
      else error = 'This shortcut is in use by another app. Choose a different shortcut.';
    } catch {
      error = 'Windows could not register this shortcut. Choose a different shortcut.';
    }
  }

  async function listSources(thumbnailSize = { width: 0, height: 0 }) {
    const ownId = getWindow()?.getMediaSourceId?.();
    const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize, fetchWindowIcons: false });
    return sources.filter(
      (source) =>
        typeof source.id === 'string' &&
        source.id.startsWith('window:') &&
        source.id !== ownId &&
        safeName(source.name) &&
        source.name !== 'Memoria',
    );
  }

  async function resolveGame(id) {
    if (!id) return { gameId: '', gameName: '' };
    if (typeof id !== 'string' || !GAME_ID.test(id)) throw fail('Choose a game account from Memoria.');
    const game = (await getGames()).find((item) => item.id === id && !item.deleted);
    if (!game || !safeName(game.name) || game.name.length > 200)
      throw fail('Choose an available game account from Memoria.');
    return { gameId: game.id, gameName: game.name };
  }

  async function captureWork() {
    if (stopped || !config.enabled) throw fail('Enable play mode before capturing a game window.');
    if (changing) throw fail('Play mode settings are being saved. Try the shortcut again in a moment.');
    if (busy) throw fail('The previous capture is still being read. Try the shortcut again in a moment.');
    if (!selected) {
      error = 'Choose a game window in Play mode before using the capture shortcut.';
      changed();
      throw fail(error);
    }
    busy = true;
    error = undefined;
    changed();
    const sourceId = selected.id;
    const gameId = config.gameId;
    try {
      const game = await resolveGame(gameId);
      const sources = await listSources({ width: 2560, height: 1440 });
      const capturedAt = now();
      const source = sources.find((item) => item.id === sourceId);
      if (!source) {
        selected = undefined;
        throw fail('The selected game window is closed. Choose its new window in Play mode.');
      }
      if (!source.thumbnail || source.thumbnail.isEmpty())
        throw fail('The game window could not be captured. Restore it or use borderless window mode, then try again.');
      const bytes = source.thumbnail.toJPEG(90);
      const result = await inbox.enqueue({
        base64: bytes.toString('base64'),
        mimeType: 'image/jpeg',
        ...(game.gameId ? game : {}),
        sourceName: source.name,
        capturedAt,
      });
      // This is a fresh title for the same selected native source, not a title-based match.
      if (selected?.id === sourceId) selected = { id: source.id, name: source.name };
      return result;
    } catch (cause) {
      error = cause.message || 'The game window could not be captured.';
      throw cause;
    } finally {
      busy = false;
      changed();
    }
  }

  function capture() {
    const alreadyBusy = busy;
    const current = captureWork();
    if (!alreadyBusy) activeCapture = current;
    void current
      .finally(() => {
        if (activeCapture === current) activeCapture = undefined;
      })
      .catch(() => {});
    return current;
  }

  return {
    start: () =>
      serial(async () => {
        try {
          await load();
          await inbox.start();
          stopped = false;
          error = undefined;
          register();
        } catch (cause) {
          // Play mode is optional. Keep the rest of Memoria available and leave
          // the unreadable file untouched for recovery instead of replacing it.
          config = { ...DEFAULTS };
          selected = undefined;
          loaded = false;
          unregister();
          error = cause.message || 'Play mode could not open its saved settings.';
        }
        changed();
        return status();
      }),
    status,
    sources: async () => (await listSources()).map(({ id, name }) => ({ id, name })),
    configure: (input) =>
      serial(async () => {
        changing = true;
        try {
          if (
            !input ||
            typeof input !== 'object' ||
            Array.isArray(input) ||
            Object.keys(input).some(
              (key) => !['enabled', 'background', 'hotkey', 'sourceId', 'gameId'].includes(key),
            ) ||
            typeof input.enabled !== 'boolean' ||
            typeof input.background !== 'boolean' ||
            !PLAY_HOTKEYS.includes(input.hotkey) ||
            (input.sourceId !== undefined && typeof input.sourceId !== 'string')
          )
            throw fail('Choose valid play mode settings and a supported shortcut.');
          if (busy) throw fail('Wait for the current capture to finish before changing play mode.');
          await load();
          const game = await resolveGame(input.gameId || '');
          let source;
          if (input.sourceId) {
            source = (await listSources()).find((item) => item.id === input.sourceId);
            if (!source) throw fail('Choose a game window from the current window list.');
          }
          if (input.enabled && !source) throw fail('Choose a game window before enabling play mode.');
          const next = { enabled: input.enabled, background: input.background, hotkey: input.hotkey, ...game };
          await persist(next);
          selected = source ? { id: source.id, name: source.name } : undefined;
          error = undefined;
          register();
          changed();
          return status();
        } finally {
          changing = false;
        }
      }),
    capture,
    remove: async (id) => {
      await inbox.remove(id);
      error = undefined;
      changed();
      return status();
    },
    stop: async () => {
      stopped = true;
      unregister();
      await operation;
      stopped = true;
      unregister();
      await activeCapture?.catch(() => {});
      await inbox.stop();
      selected = undefined;
    },
  };
}
