import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { emptyState } from '@memoria/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeGame } from '../../shared/test/helpers';

const launcher = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('../src/native', () => ({ isNativeApp: false }));
vi.mock('../src/launcher', () => ({ servedByLauncher: () => true, launcherFetch: launcher.fetch }));
vi.mock('idb-keyval', () => ({ get: vi.fn(), set: vi.fn(), del: vi.fn(), keys: vi.fn(async () => []) }));

import { connectionRequest, initGameConnections, useGameConnections } from '../src/game-connections';
import { GameConnections } from '../src/components/GameConnections';
import { connectHoyo, listHoyoAccounts } from '../src/hoyo-native';
import { useApp } from '../src/store';

const account = {
  gameId: 'g1',
  provider: 'genshin' as const,
  uid: '700000001',
  server: 'os_euro',
  autoRefresh: true,
  lastCheckedAt: null,
};
const reading = {
  gameId: 'g1',
  provider: 'genshin',
  uid: '700000001',
  observedAt: 100_000,
  data: { current_resin: 123 },
};

beforeEach(() => {
  vi.restoreAllMocks();
  launcher.fetch
    .mockReset()
    .mockImplementation(
      async (_url: string, init?: RequestInit) =>
        new Response(JSON.stringify(init?.method === 'POST' ? { reading } : { connections: [account] })),
    );
  window.memoriaDesktop = {
    version: 1,
    onCloseRequested: () => () => undefined,
    completeClose: () => undefined,
    hoyo: {
      connect: vi.fn(async () => ({ connected: true })),
      disconnect: vi.fn(async () => ({ connected: false })),
      listAccounts: vi.fn(async () => ({ accounts: [] })),
      connectAccount: vi.fn(async () => ({ connections: [account] })),
    },
  };
  useGameConnections.setState({ connections: [], error: '', refreshing: false });
  const state = emptyState();
  state.games = [makeGame({ presetKey: 'genshin' })];
  useApp.setState({ state, loaded: true });
  Object.defineProperty(document, 'hidden', { configurable: true, value: true });
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});
afterEach(() => {
  cleanup();
  delete window.memoriaDesktop;
  vi.restoreAllMocks();
});

describe('desktop account background readings', () => {
  it('uses the native sign-in and account discovery bridge', async () => {
    await connectHoyo();
    await listHoyoAccounts({ provider: 'hsr' });
    expect(window.memoriaDesktop?.hoyo?.connect).toHaveBeenCalledOnce();
    expect(window.memoriaDesktop?.hoyo?.listAccounts).toHaveBeenCalledWith({ provider: 'hsr' });
  });

  it('clears the isolated session only after the last PC account disconnects', async () => {
    launcher.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ connections: [account] })));
    await connectionRequest({ action: 'disconnect', gameId: 'other' });
    expect(window.memoriaDesktop?.hoyo?.disconnect).not.toHaveBeenCalled();
    launcher.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ connections: [] })));
    await connectionRequest({ action: 'disconnect', gameId: account.gameId });
    expect(window.memoriaDesktop?.hoyo?.disconnect).toHaveBeenCalledOnce();
  });

  it('connects with account metadata only and never asks the renderer for a cookie', async () => {
    await connectionRequest({ action: 'connect', ...account, cookie: 'must-not-cross-bridge' });
    expect(window.memoriaDesktop?.hoyo?.connectAccount).toHaveBeenCalledWith({
      gameId: 'g1',
      provider: 'genshin',
      uid: account.uid,
      server: 'os_euro',
      autoRefresh: true,
    });
    expect(launcher.fetch).not.toHaveBeenCalled();
    expect(useGameConnections.getState().connections).toEqual([account]);
    useGameConnections.setState({ connections: [] });
    launcher.fetch.mockResolvedValue(new Response(JSON.stringify({ connections: [] })));
    render(<GameConnections gameId="g1" onReview={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Sign in with HoYoLAB' })).toBeInTheDocument();
    expect(screen.queryByLabelText('HoYoLAB session cookie')).not.toBeInTheDocument();
  });

  it('imports opted-in readings while the desktop window is hidden', async () => {
    const apply = vi.spyOn(useApp.getState(), 'applyGameImport');
    const dispose = initGameConnections();
    try {
      await vi.waitFor(() => expect(apply).toHaveBeenCalledOnce());
      expect(useGameConnections.getState().connections[0].lastCheckedAt).toBe(reading.observedAt);
      expect(useGameConnections.getState().refreshing).toBe(false);
    } finally {
      dispose();
    }
  });

  it('renews the current PC account after an explicit sign-in', async () => {
    useGameConnections.setState({ connections: [account] });
    render(<GameConnections gameId="g1" onReview={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with HoYoLAB' }));
    await vi.waitFor(() => expect(window.memoriaDesktop?.hoyo?.connectAccount).toHaveBeenCalledOnce());
    expect(window.memoriaDesktop?.hoyo?.connectAccount).toHaveBeenCalledWith({
      gameId: account.gameId,
      provider: account.provider,
      uid: account.uid,
      server: account.server,
      autoRefresh: true,
    });
  });

  it('discards a pending automatic reading if the game is paused', async () => {
    let resolve!: (response: Response) => void;
    launcher.fetch.mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === 'POST'
        ? new Promise<Response>((done) => {
            resolve = done;
          })
        : new Response(JSON.stringify({ connections: [account] })),
    );
    const apply = vi.spyOn(useApp.getState(), 'applyGameImport');
    const dispose = initGameConnections();
    try {
      await vi.waitFor(() => expect(launcher.fetch).toHaveBeenCalledTimes(2));
      useApp.setState({
        state: { ...useApp.getState().state, games: [makeGame({ presetKey: 'genshin', paused: true })] },
      });
      resolve(new Response(JSON.stringify({ reading })));
      await vi.waitFor(() => expect(useGameConnections.getState().refreshing).toBe(false));
      expect(apply).not.toHaveBeenCalled();
    } finally {
      dispose();
    }
  });

  it('keeps background reads off in a hidden browser tab', async () => {
    delete window.memoriaDesktop;
    const dispose = initGameConnections();
    await Promise.resolve();
    dispose();
    expect(launcher.fetch).not.toHaveBeenCalled();
  });

  it.each(['offline', 'paused', 'no opt-in'] as const)('does not poll when %s', async (condition) => {
    if (condition === 'offline') Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    if (condition === 'paused')
      useApp.setState({
        state: { ...useApp.getState().state, games: [makeGame({ presetKey: 'genshin', paused: true })] },
      });
    if (condition === 'no opt-in')
      launcher.fetch.mockResolvedValue(
        new Response(JSON.stringify({ connections: [{ ...account, autoRefresh: false }] })),
      );
    const apply = vi.spyOn(useApp.getState(), 'applyGameImport');
    const dispose = initGameConnections();
    try {
      await vi.waitFor(() => expect(useGameConnections.getState().refreshing).toBe(false));
      expect(apply).not.toHaveBeenCalled();
      expect(launcher.fetch.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
    } finally {
      dispose();
    }
  });
});
