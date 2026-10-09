import { act, fireEvent, render, screen } from '@testing-library/react';
import { emptyState } from '@memoria/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeGame } from '../../shared/test/helpers';

const launcher = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('../src/native', () => ({ isNativeApp: false }));
vi.mock('../src/launcher', () => ({ servedByLauncher: () => true, launcherFetch: launcher.fetch }));
vi.mock('idb-keyval', () => ({ get: vi.fn(), set: vi.fn(), del: vi.fn(), keys: vi.fn(async () => []) }));

import {
  connectionRequest,
  initGameConnections,
  useGameConnections,
  type GameConnection,
  type ConnectionResponse,
} from '../src/game-connections';
import { GameConnections } from '../src/components/GameConnections';
import { listHoyoAccounts } from '../src/hoyo-native';
import { useApp } from '../src/store';

const protectedAccount: GameConnection = {
  gameId: 'old',
  provider: 'hsr',
  uid: '700000001',
  server: 'prod_official_eur',
  autoRefresh: false,
  lastCheckedAt: null,
};
const browserAccount: GameConnection = {
  gameId: 'g1',
  provider: 'genshin',
  uid: '700000002',
  server: 'os_euro',
  autoRefresh: false,
  lastCheckedAt: null,
  transport: 'browser',
};
const reading = {
  gameId: 'g1',
  provider: 'genshin' as const,
  uid: browserAccount.uid,
  observedAt: 100_000,
  data: { current_resin: 123 },
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  launcher.fetch.mockReset().mockResolvedValue(new Response(JSON.stringify({ connections: [protectedAccount] })));
  // Each request needs a fresh Response body.
  launcher.fetch.mockImplementation(async () => new Response(JSON.stringify({ connections: [protectedAccount] })));
  window.memoriaDesktop = {
    version: 1,
    onCloseRequested: () => () => undefined,
    completeClose: () => undefined,
    browser: {
      setup: vi.fn(async () => ({ folder: 'C:/Memoria/browser-connector' })),
      status: vi.fn(async () => ({ receivedAt: null, accounts: 0 })),
      listAccounts: vi.fn(async () => ({
        accounts: [
          {
            provider: 'genshin' as const,
            uid: browserAccount.uid,
            server: browserAccount.server,
            nickname: 'Traveler',
          },
        ],
      })),
      request: vi.fn(async () => ({ connections: [browserAccount] })),
    },
    hoyo: {
      connect: vi.fn(async () => ({ connected: true })),
      disconnect: vi.fn(async () => ({ connected: false })),
      listAccounts: vi.fn(async () => ({ accounts: [] })),
      connectAccount: vi.fn(async () => ({ connections: [protectedAccount] })),
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
  delete window.memoriaDesktop;
  vi.restoreAllMocks();
});

describe('Chrome and Edge account transport', () => {
  it('loads both connection sources and replaces only the changed source', async () => {
    await connectionRequest();
    expect(useGameConnections.getState().connections).toEqual([protectedAccount, browserAccount]);
    vi.mocked(window.memoriaDesktop!.browser!.request).mockResolvedValueOnce({
      connections: [{ ...browserAccount, autoRefresh: true }],
    });
    await connectionRequest({ action: 'configure', gameId: 'g1', autoRefresh: true });
    expect(window.memoriaDesktop!.browser!.request).toHaveBeenLastCalledWith({
      action: 'configure',
      gameId: 'g1',
      autoRefresh: true,
    });
    expect(useGameConnections.getState().connections).toEqual([
      protectedAccount,
      { ...browserAccount, autoRefresh: true },
    ]);
  });

  it('uses browser discovery and sends metadata only when connecting', async () => {
    await listHoyoAccounts({ provider: 'genshin' });
    expect(window.memoriaDesktop!.browser!.listAccounts).toHaveBeenCalledWith({ provider: 'genshin' });
    expect(window.memoriaDesktop!.hoyo!.listAccounts).not.toHaveBeenCalled();
    await connectionRequest({ action: 'connect', ...browserAccount, cookie: 'private-value', unexpected: 'discard' });
    expect(window.memoriaDesktop!.browser!.request).toHaveBeenCalledWith({
      action: 'connect',
      gameId: 'g1',
      provider: 'genshin',
      uid: browserAccount.uid,
      server: 'os_euro',
      autoRefresh: false,
    });
    expect(window.memoriaDesktop!.hoyo!.connectAccount).not.toHaveBeenCalled();
    expect(launcher.fetch).not.toHaveBeenCalled();
  });

  it('retains a failed source and keeps the other source usable', async () => {
    useGameConnections.setState({ connections: [protectedAccount, browserAccount] });
    launcher.fetch.mockRejectedValueOnce(new Error('Protected session unavailable.'));
    vi.mocked(window.memoriaDesktop!.browser!.request).mockResolvedValueOnce({
      connections: [{ ...browserAccount, autoRefresh: true }],
    });
    const result = await connectionRequest();
    expect(result.error).toContain('Protected session unavailable.');
    expect(useGameConnections.getState().connections).toEqual([
      protectedAccount,
      { ...browserAccount, autoRefresh: true },
    ]);
    vi.mocked(window.memoriaDesktop!.browser!.request).mockResolvedValueOnce({
      error: 'Open your browser.',
      connections: [],
    });
    await expect(connectionRequest({ action: 'refresh', gameId: 'g1' })).rejects.toThrow('Open your browser.');
    expect(useGameConnections.getState().connections).toHaveLength(2);
  });

  it('does not restore an account from a listing started before disconnect', async () => {
    useGameConnections.setState({ connections: [browserAccount] });
    const oldList = deferred<ConnectionResponse>();
    vi.mocked(window.memoriaDesktop!.browser!.request)
      .mockReturnValueOnce(oldList.promise)
      .mockResolvedValueOnce({ connections: [] });
    const load = connectionRequest();
    await connectionRequest({ action: 'disconnect', gameId: 'g1' });
    oldList.resolve({ connections: [browserAccount] });
    await load;
    expect(useGameConnections.getState().connections).toEqual([protectedAccount]);
  });

  it('keeps a newer listing when an older browser response arrives last', async () => {
    const oldList = deferred<ConnectionResponse>();
    vi.mocked(window.memoriaDesktop!.browser!.request)
      .mockReturnValueOnce(oldList.promise)
      .mockResolvedValueOnce({ connections: [{ ...browserAccount, uid: '700000003' }] });
    const old = connectionRequest();
    await connectionRequest();
    oldList.resolve({ connections: [browserAccount] });
    await old;
    expect(useGameConnections.getState().connections.find((item) => item.gameId === 'g1')?.uid).toBe('700000003');
    expect(useGameConnections.getState().error).toBe('');
  });

  it.each(['configure', 'disconnect'])(
    "keeps another account's newer %s when a mutation response arrives last",
    async (action) => {
      const other = { ...browserAccount, gameId: 'g2', uid: '700000003' };
      useGameConnections.setState({ connections: [protectedAccount, browserAccount, other] });
      const older = deferred<ConnectionResponse>();
      const enabled = { ...browserAccount, autoRefresh: true };
      const newer = action === 'configure' ? [enabled, { ...other, autoRefresh: true }] : [enabled];
      vi.mocked(window.memoriaDesktop!.browser!.request)
        .mockReturnValueOnce(older.promise)
        .mockResolvedValueOnce({ connections: newer });
      const first = connectionRequest({ action: 'configure', gameId: 'g1', autoRefresh: true });
      await connectionRequest({ action, gameId: 'g2', autoRefresh: true });
      older.resolve({ connections: [enabled, other] });
      await first;
      expect(useGameConnections.getState().connections).toHaveLength(newer.length + 1);
      expect(useGameConnections.getState().connections).toEqual(expect.arrayContaining([protectedAccount, ...newer]));
    },
  );

  it('imports browser readings while hidden only after account opt-in', async () => {
    const enabled = { ...browserAccount, autoRefresh: true };
    vi.mocked(window.memoriaDesktop!.browser!.request).mockImplementation(async (body) =>
      body ? { reading } : { connections: [enabled] },
    );
    const apply = vi.spyOn(useApp.getState(), 'applyGameImport');
    const dispose = initGameConnections();
    try {
      await vi.waitFor(() => expect(apply).toHaveBeenCalledOnce());
      expect(useGameConnections.getState().connections.find((item) => item.gameId === 'g1')?.lastCheckedAt).toBe(
        reading.observedAt,
      );
      expect(window.memoriaDesktop!.hoyo!.connect).not.toHaveBeenCalled();
    } finally {
      dispose();
    }
  });

  it('rejects a pending reading after disconnect or configuration changes', async () => {
    useGameConnections.setState({ connections: [browserAccount] });
    const oldReading = deferred<ConnectionResponse>();
    vi.mocked(window.memoriaDesktop!.browser!.request)
      .mockReturnValueOnce(oldReading.promise)
      .mockResolvedValueOnce({ connections: [] });
    const pending = connectionRequest({ action: 'refresh', gameId: 'g1' });
    const rejected = expect(pending).rejects.toThrow('connection changed');
    await connectionRequest({ action: 'disconnect', gameId: 'g1' });
    oldReading.resolve({ connections: [browserAccount], reading });
    await rejected;
    expect(useGameConnections.getState().connections).toEqual([]);
  });

  it('preserves the original browser observation time', async () => {
    useGameConnections.setState({ connections: [browserAccount, protectedAccount] });
    vi.mocked(window.memoriaDesktop!.browser!.request).mockResolvedValueOnce({ reading });
    const result = await connectionRequest({ action: 'refresh', gameId: 'g1' });
    expect(result.reading?.observedAt).toBe(100_000);
    expect(useGameConnections.getState().connections.find((item) => item.gameId === 'g1')?.lastCheckedAt).toBe(100_000);
    expect(useGameConnections.getState().connections.find((item) => item.gameId === 'old')?.lastCheckedAt).toBeNull();
  });

  it('blocks switching connection methods without an explicit disconnect', async () => {
    useGameConnections.setState({ connections: [{ ...browserAccount, transport: undefined }] });
    await expect(connectionRequest({ action: 'connect', ...browserAccount })).rejects.toThrow(
      'Disconnect this game account',
    );
    expect(window.memoriaDesktop!.browser!.request).not.toHaveBeenCalled();
  });

  it('shows conflicting transports and skips their automatic imports', async () => {
    const legacy = { ...browserAccount, autoRefresh: true, transport: undefined };
    launcher.fetch.mockImplementation(async () => new Response(JSON.stringify({ connections: [legacy] })));
    vi.mocked(window.memoriaDesktop!.browser!.request).mockResolvedValue({
      connections: [{ ...browserAccount, autoRefresh: true }],
    });
    const apply = vi.spyOn(useApp.getState(), 'applyGameImport');
    const dispose = initGameConnections();
    try {
      await vi.waitFor(() => expect(useGameConnections.getState().refreshing).toBe(false));
      expect(useGameConnections.getState().error).toContain('both a browser and a protected PC connection');
      expect(apply).not.toHaveBeenCalled();
      render(<GameConnections gameId="g1" onReview={vi.fn()} />);
      expect(screen.getByRole('region', { name: 'Connection conflict' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Fetch readings' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Disconnect browser account' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Disconnect protected PC account' })).toBeInTheDocument();
    } finally {
      dispose();
    }
  });

  it('defaults new connections to normal browser setup and explains both automatic options', async () => {
    launcher.fetch.mockImplementation(async () => new Response(JSON.stringify({ connections: [] })));
    vi.mocked(window.memoriaDesktop!.browser!.request).mockResolvedValue({ connections: [] });
    const review = vi.fn();
    render(<GameConnections gameId="g1" onReview={review} />);
    expect(screen.queryByRole('button', { name: 'Sign in with HoYoLAB' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('HoYoLAB session cookie')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open HoYoLAB in your browser' })).toHaveAttribute(
      'href',
      'https://www.hoyolab.com/',
    );
    expect(screen.getByText(/enable the browser connector's automatic option/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Set up browser connector' }));
    await vi.waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Connector folder opened'));
    expect(window.memoriaDesktop!.browser!.setup).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Find my accounts' }));
    await vi.waitFor(() => expect(screen.getByLabelText('In-game UID')).toHaveValue(browserAccount.uid));
    vi.mocked(window.memoriaDesktop!.browser!.request).mockResolvedValueOnce({
      connections: [browserAccount],
      reading,
    });
    await act(async () =>
      fireEvent.submit(screen.getByRole('button', { name: 'Connect and review' }).closest('form')!),
    );
    expect(window.memoriaDesktop!.browser!.request).toHaveBeenLastCalledWith({
      action: 'connect',
      gameId: 'g1',
      provider: 'genshin',
      uid: browserAccount.uid,
      server: 'os_euro',
      autoRefresh: false,
    });
    expect(review).toHaveBeenCalledOnce();
    expect(window.memoriaDesktop!.hoyo!.connect).not.toHaveBeenCalled();
  });
});
