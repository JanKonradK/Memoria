import { emptyState } from '@memoria/shared';
import { createElement } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeGame } from '../../shared/test/helpers';

const native = vi.hoisted(() => ({ fetch: vi.fn(), disconnect: vi.fn() }));
vi.mock('../src/native', () => ({ isNativeApp: true }));
vi.mock('../src/hoyo-native', () => ({
  fetchHoyoNotes: native.fetch,
  disconnectHoyo: native.disconnect,
  connectHoyo: vi.fn(),
}));
vi.mock('../src/launcher', () => ({ servedByLauncher: () => false, launcherFetch: vi.fn() }));
vi.mock('idb-keyval', () => ({ get: vi.fn(), set: vi.fn(), del: vi.fn(), keys: vi.fn(async () => []) }));

import {
  connectionRequest,
  initGameConnections,
  useGameConnections,
  type GameConnection,
} from '../src/game-connections';
import { useApp } from '../src/store';
import type { HoyoNativeReading } from '../src/hoyo-native';
import { GameConnections } from '../src/components/GameConnections';

const KEY = 'memoria-game-connections';
function account(over: Partial<GameConnection> = {}): GameConnection {
  return {
    gameId: 'g1',
    provider: 'genshin',
    uid: '700000001',
    server: 'os_euro',
    autoRefresh: true,
    lastCheckedAt: null,
    ...over,
  };
}
function reading(uid = '700000001'): HoyoNativeReading {
  return { provider: 'genshin', uid, observedAt: Date.now(), data: { current_resin: 123 } };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  native.fetch.mockReset();
  native.disconnect.mockReset().mockResolvedValue(undefined);
  useGameConnections.setState({ connections: [], error: '', refreshing: false });
  const state = emptyState();
  state.games = [makeGame({ presetKey: 'genshin' })];
  useApp.setState({ state, loaded: true });
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('native game account connection races', () => {
  it('does not deliver review data to an account view after it unmounts', async () => {
    localStorage.setItem(KEY, JSON.stringify([account()]));
    const pending = deferred<HoyoNativeReading>();
    native.fetch.mockReturnValueOnce(pending.promise);
    const onReview = vi.fn();
    const view = render(createElement(GameConnections, { gameId: 'g1', onReview }));
    fireEvent.click(screen.getByRole('button', { name: 'Fetch readings' }));
    view.unmount();
    await act(async () => {
      pending.resolve(reading());
    });
    expect(onReview).not.toHaveBeenCalled();
  });
  it('does not restore an account disconnected while a refresh is in flight', async () => {
    localStorage.setItem(KEY, JSON.stringify([account()]));
    await connectionRequest();
    const pending = deferred<HoyoNativeReading>();
    native.fetch.mockReturnValueOnce(pending.promise);
    const refresh = connectionRequest({ action: 'refresh', gameId: 'g1' });
    const rejected = expect(refresh).rejects.toThrow('connection changed');
    await connectionRequest({ action: 'disconnect', gameId: 'g1' });
    pending.resolve(reading());
    await rejected;
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual([]);
    expect(useGameConnections.getState().connections).toEqual([]);
    expect(native.disconnect).toHaveBeenCalledTimes(1);
  });

  it('lets the newest connect attempt win even when the older request finishes last', async () => {
    const first = deferred<HoyoNativeReading>();
    const second = deferred<HoyoNativeReading>();
    native.fetch.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const oldRequest = connectionRequest({ action: 'connect', ...account() });
    const rejected = expect(oldRequest).rejects.toThrow('connection changed');
    const newRequest = connectionRequest({ action: 'connect', ...account({ uid: '700000002' }) });
    second.resolve(reading('700000002'));
    await newRequest;
    first.resolve(reading());
    await rejected;
    expect(useGameConnections.getState().connections).toHaveLength(1);
    expect(useGameConnections.getState().connections[0]?.uid).toBe('700000002');
    expect(JSON.parse(localStorage.getItem(KEY)!)[0].uid).toBe('700000002');
  });

  it('keeps a changed auto-refresh preference when an existing fetch completes', async () => {
    localStorage.setItem(KEY, JSON.stringify([account()]));
    const pending = deferred<HoyoNativeReading>();
    native.fetch.mockReturnValueOnce(pending.promise);
    const refresh = connectionRequest({ action: 'refresh', gameId: 'g1' });
    await connectionRequest({ action: 'configure', gameId: 'g1', autoRefresh: false });
    pending.resolve(reading());
    await refresh;
    expect(useGameConnections.getState().connections[0]?.autoRefresh).toBe(false);
    expect(JSON.parse(localStorage.getItem(KEY)!)[0].autoRefresh).toBe(false);
  });

  it('does not delete the shared native login while another account remains connected', async () => {
    localStorage.setItem(KEY, JSON.stringify([account(), account({ gameId: 'g2', uid: '700000002' })]));
    await connectionRequest({ action: 'disconnect', gameId: 'g1' });
    expect(native.disconnect).not.toHaveBeenCalled();
    expect(useGameConnections.getState().connections.map((item) => item.gameId)).toEqual(['g2']);
  });

  it('keeps existing metadata when a replacement fails or local storage is full', async () => {
    const original = account();
    localStorage.setItem(KEY, JSON.stringify([original]));
    await connectionRequest();
    native.fetch.mockRejectedValueOnce(new Error('Session expired'));
    await expect(connectionRequest({ action: 'connect', ...account({ uid: '700000002' }) })).rejects.toThrow(
      'Session expired',
    );
    expect(useGameConnections.getState().connections).toEqual([original]);
    native.fetch.mockResolvedValueOnce(reading('700000002'));
    vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
      throw new DOMException('Full', 'QuotaExceededError');
    });
    await expect(connectionRequest({ action: 'connect', ...account({ uid: '700000002' }) })).rejects.toThrow('Full');
    expect(useGameConnections.getState().connections).toEqual([original]);
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual([original]);
  });

  it('does not poll corrupt auto-refresh flags', async () => {
    localStorage.setItem(KEY, JSON.stringify([{ ...account(), autoRefresh: 'true' }]));
    const dispose = initGameConnections();
    try {
      await vi.waitFor(() => expect(useGameConnections.getState().error).toContain('could not be read'));
      expect(native.fetch).not.toHaveBeenCalled();
      expect(useGameConnections.getState().refreshing).toBe(false);
    } finally {
      dispose();
    }
  });

  it('does not import a polling response if auto-refresh was disabled during the fetch', async () => {
    localStorage.setItem(KEY, JSON.stringify([account()]));
    const pending = deferred<HoyoNativeReading>();
    native.fetch.mockReturnValueOnce(pending.promise);
    const apply = vi.spyOn(useApp.getState(), 'applyGameImport');
    const dispose = initGameConnections();
    try {
      await vi.waitFor(() => expect(native.fetch).toHaveBeenCalledTimes(1));
      await connectionRequest({ action: 'configure', gameId: 'g1', autoRefresh: false });
      pending.resolve(reading());
      await vi.waitFor(() => expect(useGameConnections.getState().refreshing).toBe(false));
      expect(apply).not.toHaveBeenCalled();
    } finally {
      dispose();
    }
  });

  it('does not poll paused games or accounts without opt-in', async () => {
    localStorage.setItem(KEY, JSON.stringify([account({ autoRefresh: false })]));
    let dispose = initGameConnections();
    await vi.waitFor(() => expect(useGameConnections.getState().refreshing).toBe(false));
    dispose();
    localStorage.setItem(KEY, JSON.stringify([account()]));
    useApp.setState({
      state: { ...useApp.getState().state, games: [makeGame({ presetKey: 'genshin', paused: true })] },
    });
    dispose = initGameConnections();
    try {
      await vi.waitFor(() => expect(useGameConnections.getState().refreshing).toBe(false));
      expect(native.fetch).not.toHaveBeenCalled();
    } finally {
      dispose();
    }
  });
});
