import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPlayMode, PLAY_HOTKEYS } from '../play-mode.mjs';

let directory;
let controllers;
const windowId = 'window:123:0';
const source = (id = windowId, name = 'Genshin Impact') => ({
  id,
  name,
  thumbnail: {
    isEmpty: vi.fn(() => false),
    toJPEG: vi.fn(() => Buffer.from([255, 216, 255, 5])),
  },
});
const settings = (overrides = {}) => ({
  enabled: true,
  background: true,
  hotkey: PLAY_HOTKEYS[0],
  sourceId: windowId,
  gameId: 'game-one',
  ...overrides,
});

function make(options = {}) {
  const sources = [source(), source('window:999:0', 'Memoria'), source('screen:0:0', 'Entire screen')];
  const registered = new Map();
  const globalShortcut = {
    register: vi.fn((key, handler) => {
      registered.set(key, handler);
      return true;
    }),
    unregister: vi.fn((key) => {
      registered.delete(key);
    }),
    isRegistered: vi.fn((key) => registered.has(key)),
  };
  const desktopCapturer = { getSources: vi.fn(async () => sources) };
  const recognize = vi.fn(async () => ({ text: 'Original Resin 120 / 200' }));
  const onChange = vi.fn();
  const getGames = vi.fn(async () => [{ id: 'game-one', name: 'My Genshin Account' }]);
  const getWindow = () => ({ getMediaSourceId: () => 'window:999:0' });
  const controller = createPlayMode({
    dataDir: directory,
    desktopCapturer,
    globalShortcut,
    getWindow,
    getGames,
    recognize,
    onChange,
    ...options,
  });
  controllers.push(controller);
  return { controller, globalShortcut, registered, desktopCapturer, sources, recognize, onChange, getGames };
}

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'memoria-play-mode-test-'));
  controllers = [];
});

afterEach(async () => {
  await Promise.all(controllers.map((controller) => controller.stop()));
  if (
    path.dirname(directory) !== path.resolve(tmpdir()) ||
    !path.basename(directory).startsWith('memoria-play-mode-test-')
  )
    throw new Error('Unexpected test directory.');
  await rm(directory, { recursive: true, force: true });
});

describe('native play mode controller', () => {
  it('starts disabled without registering or capturing anything', async () => {
    const { controller, globalShortcut, desktopCapturer } = make();
    expect(await controller.start()).toMatchObject({
      enabled: false,
      background: false,
      hotkey: PLAY_HOTKEYS[0],
      registered: false,
      busy: false,
      count: 0,
      pending: [],
      sourceId: '',
      sourceName: '',
      gameId: '',
    });
    expect(globalShortcut.register).not.toHaveBeenCalled();
    expect(desktopCapturer.getSources).not.toHaveBeenCalled();
  });

  it('lists only native windows without returning screenshots or its own app', async () => {
    const { controller, desktopCapturer } = make();
    expect(await controller.sources()).toEqual([{ id: windowId, name: 'Genshin Impact' }]);
    expect(desktopCapturer.getSources).toHaveBeenCalledWith({
      types: ['window'],
      thumbnailSize: { width: 0, height: 0 },
      fetchWindowIcons: false,
    });
  });

  it('persists canonical game settings but never persists a selected window', async () => {
    const { controller, globalShortcut } = make();
    const status = await controller.configure(settings());
    expect(status).toMatchObject({
      enabled: true,
      background: true,
      registered: true,
      sourceId: windowId,
      gameName: 'My Genshin Account',
    });
    expect(globalShortcut.register).toHaveBeenCalledWith(PLAY_HOTKEYS[0], expect.any(Function));
    const persisted = JSON.parse(await readFile(path.join(directory, 'play-mode.json'), 'utf8'));
    expect(persisted).toEqual({
      enabled: true,
      background: true,
      hotkey: PLAY_HOTKEYS[0],
      gameId: 'game-one',
      gameName: 'My Genshin Account',
    });
    await controller.stop();
    const restored = make();
    expect(await restored.controller.start()).toMatchObject({
      enabled: true,
      registered: true,
      sourceId: '',
      sourceName: '',
      gameId: 'game-one',
    });
    await expect(restored.controller.capture()).rejects.toThrow('Choose a game window');
    expect(restored.desktopCapturer.getSources).not.toHaveBeenCalled();
  });

  it.each([
    { hotkey: 'Alt+F4' },
    { enabled: 'yes' },
    { background: 'yes' },
    { sourceId: 'screen:0:0' },
    { sourceId: 'window:999:0' },
    { sourceId: '' },
    { gameId: 'deleted-game' },
    { gameId: '../account' },
    { cookie: 'not accepted' },
  ])('rejects unauthorized settings/source/game before saving: %j', async (overrides) => {
    const { controller, globalShortcut, recognize } = make();
    await expect(controller.configure(settings(overrides))).rejects.toThrow();
    expect(await readdir(directory)).toEqual([]);
    expect(globalShortcut.register).not.toHaveBeenCalled();
    expect(recognize).not.toHaveBeenCalled();
  });

  it('captures the selected game on the shortcut without focusing or opening a window', async () => {
    const focus = vi.fn();
    const { controller, registered, desktopCapturer, sources, recognize, onChange } = make({
      getWindow: () => ({ getMediaSourceId: () => 'window:999:0', focus }),
    });
    await controller.configure(settings());
    registered.get(PLAY_HOTKEYS[0])();
    await vi.waitFor(() => expect(controller.status().count).toBe(1));
    expect(desktopCapturer.getSources).toHaveBeenLastCalledWith({
      types: ['window'],
      thumbnailSize: { width: 2560, height: 1440 },
      fetchWindowIcons: false,
    });
    expect(sources[0].thumbnail.toJPEG).toHaveBeenCalledWith(90);
    expect(recognize).toHaveBeenCalledWith({
      mimeType: 'image/jpeg',
      base64: Buffer.from([255, 216, 255, 5]).toString('base64'),
    });
    expect(controller.status().pending[0]).toMatchObject({
      gameId: 'game-one',
      gameName: 'My Genshin Account',
      name: 'Genshin Impact',
      text: 'Original Resin 120 / 200',
    });
    expect(controller.status().pending[0].capturedAt).toBeLessThanOrEqual(Date.now());
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ busy: true }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ busy: false, count: 1 }));
    expect(focus).not.toHaveBeenCalled();
  });

  it('does not substitute a different window with the same title when the selected window closes', async () => {
    const { controller, sources, recognize } = make();
    await controller.configure(settings());
    sources.splice(0, 1, source('window:456:0'));
    await expect(controller.capture()).rejects.toThrow('selected game window is closed');
    expect(controller.status().sourceId).toBe('');
    expect(recognize).not.toHaveBeenCalled();
  });

  it('rejects an empty capture with a useful window-mode error', async () => {
    const { controller, sources, recognize } = make();
    await controller.configure(settings());
    sources[0].thumbnail.isEmpty.mockReturnValue(true);
    await expect(controller.capture()).rejects.toThrow('borderless window mode');
    expect(recognize).not.toHaveBeenCalled();
  });

  it('checks game availability again before capturing', async () => {
    const { controller, getGames, recognize } = make();
    await controller.configure(settings());
    getGames.mockResolvedValue([{ id: 'game-one', name: 'My Genshin Account', deleted: true }]);
    await expect(controller.capture()).rejects.toThrow('available game account');
    expect(recognize).not.toHaveBeenCalled();
  });

  it('reports a shortcut conflict truthfully and unregisters only its own previous shortcut', async () => {
    const { controller, globalShortcut } = make();
    await controller.configure(settings());
    globalShortcut.register.mockReturnValueOnce(false);
    expect(await controller.configure(settings({ hotkey: PLAY_HOTKEYS[1] }))).toMatchObject({
      enabled: true,
      registered: false,
      hotkey: PLAY_HOTKEYS[1],
      error: expect.stringContaining('in use by another app'),
    });
    expect(globalShortcut.unregister).toHaveBeenCalledWith(PLAY_HOTKEYS[0]);
    expect(JSON.parse(await readFile(path.join(directory, 'play-mode.json'), 'utf8')).hotkey).toBe(PLAY_HOTKEYS[1]);
    expect(await controller.configure(settings({ hotkey: PLAY_HOTKEYS[2] }))).toMatchObject({
      registered: true,
      hotkey: PLAY_HOTKEYS[2],
    });
    expect(controller.status().error).toBeUndefined();
  });

  it('disables capture and removes the hotkey while retaining the durable inbox', async () => {
    const { controller, globalShortcut } = make();
    await controller.configure(settings());
    const entry = await controller.capture();
    expect(await controller.configure(settings({ enabled: false, sourceId: '' }))).toMatchObject({
      enabled: false,
      registered: false,
      count: 1,
    });
    expect(globalShortcut.unregister).toHaveBeenCalledWith(PLAY_HOTKEYS[0]);
    await expect(controller.capture()).rejects.toThrow('Enable play mode');
    expect(await controller.remove(entry.id)).toMatchObject({ count: 0, pending: [] });
  });

  it('rejects repeat hotkeys and settings changes during OCR, then drains the capture on stop', async () => {
    let finish;
    const recognize = vi.fn(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { controller, globalShortcut } = make({ recognize });
    await controller.configure(settings());
    const capture = controller.capture();
    await vi.waitFor(() => expect(recognize).toHaveBeenCalledOnce());
    await expect(controller.capture()).rejects.toThrow('previous capture');
    await expect(controller.configure(settings({ enabled: false }))).rejects.toThrow('current capture');
    let stopped = false;
    const drain = controller.stop().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);
    expect(globalShortcut.unregister).toHaveBeenCalledWith(PLAY_HOTKEYS[0]);
    finish({ text: 'Original Resin 120 / 200' });
    await capture;
    await drain;
    expect(controller.status()).toMatchObject({ count: 1, busy: false, registered: false });
  });

  it('keeps malformed settings instead of replacing them with defaults', async () => {
    const filename = path.join(directory, 'play-mode.json');
    await writeFile(filename, '{broken');
    const { controller } = make();
    await expect(controller.start()).resolves.toMatchObject({
      enabled: false,
      registered: false,
      error: expect.stringContaining('saved file was kept'),
    });
    await expect(controller.configure(settings())).rejects.toThrow('saved file was kept');
    expect(await readFile(filename, 'utf8')).toBe('{broken');
  });

  it('keeps Memoria usable when the saved screenshot inbox cannot be opened', async () => {
    await mkdir(path.join(directory, 'capture'));
    const filename = path.join(directory, 'capture/state.json');
    await writeFile(filename, '{broken');
    const { controller, globalShortcut } = make();
    await expect(controller.start()).resolves.toMatchObject({
      enabled: false,
      registered: false,
      error: expect.stringContaining('inbox could not be read'),
    });
    expect(globalShortcut.register).not.toHaveBeenCalled();
    await expect(controller.configure(settings())).rejects.toThrow('saved file was kept');
    expect(await readFile(filename, 'utf8')).toBe('{broken');
  });
});
