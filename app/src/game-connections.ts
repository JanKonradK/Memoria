import { create } from 'zustand';
import { mapHoYoNotes } from '@memoria/shared';
import { launcherFetch, servedByLauncher } from './launcher';
import { useApp } from './store';
import { isNativeApp } from './native';
import { disconnectHoyo, fetchHoyoNotes } from './hoyo-native';
import { isDesktopApp } from './desktop-host';

export type GameConnection = {
  gameId: string;
  provider: 'genshin' | 'hsr' | 'zzz';
  uid: string;
  server: string;
  autoRefresh: boolean;
  lastCheckedAt: number | null;
  transport?: 'browser';
};
export type AccountReading = {
  gameId: string;
  provider: GameConnection['provider'];
  uid: string;
  observedAt: number;
  data: Record<string, unknown>;
};
export type ConnectionResponse = { connections?: GameConnection[]; reading?: AccountReading; error?: string };
export const useGameConnections = create<{ connections: GameConnection[]; error: string; refreshing: boolean }>(() => ({
  connections: [],
  error: '',
  refreshing: false,
}));

type ConnectionTransport = 'legacy' | 'browser';
const sourceGenerations = new Map<ConnectionTransport, number>();
const sourceReads = new Map<ConnectionTransport, number>();
let listingGeneration = 0;
const desktopGenerations = new Map<string, number>();
const sourceOf = (connection: GameConnection): ConnectionTransport =>
  connection.transport === 'browser' ? 'browser' : 'legacy';
const conflictError = (connections: GameConnection[]) => {
  const ids = connections.map((entry) => entry.gameId);
  return new Set(ids).size < ids.length
    ? 'A game has both a browser and a protected PC connection. Open Accounts and disconnect one before importing.'
    : '';
};
function recordConnectionResponse(
  result: ConnectionResponse,
  transport?: ConnectionTransport,
  gameId?: string,
): ConnectionResponse {
  if (result.error) throw new Error(result.error);
  if (result.connections) {
    const received = result.connections.map((entry) =>
      transport === 'browser' ? { ...entry, transport: 'browser' as const } : entry,
    );
    useGameConnections.setState(({ connections }) => {
      const next = transport
        ? [
            ...connections.filter(
              (entry) => sourceOf(entry) !== transport || (gameId !== undefined && entry.gameId !== gameId),
            ),
            ...received.filter((entry) => gameId === undefined || entry.gameId === gameId),
          ]
        : received;
      if (transport) next.sort((a, b) => Number(a.transport === 'browser') - Number(b.transport === 'browser'));
      return { connections: next, error: conflictError(next) };
    });
  } else if (result.reading) {
    const reading = result.reading;
    useGameConnections.setState(({ connections }) => ({
      connections: connections.map((entry) =>
        entry.gameId === reading.gameId &&
        entry.provider === reading.provider &&
        entry.uid === reading.uid &&
        (!transport || sourceOf(entry) === transport)
          ? { ...entry, lastCheckedAt: reading.observedAt }
          : entry,
      ),
    }));
  }
  return result;
}

export async function connectionRequest(body?: Record<string, unknown>): Promise<ConnectionResponse> {
  if (isNativeApp) return nativeConnectionRequest(body);
  const browser = isDesktopApp() ? window.memoriaDesktop?.browser : undefined;
  if (browser && !body) {
    const listing = ++listingGeneration;
    // Each source replaces only its own entries. A failed source keeps its last
    // known connections while the other source remains available.
    const load = async (transport: ConnectionTransport) => {
      const generation = sourceGenerations.get(transport) ?? 0;
      const read = (sourceReads.get(transport) ?? 0) + 1;
      sourceReads.set(transport, read);
      const result =
        transport === 'browser' ? await browser.request() : await legacyConnectionRequest(undefined, false);
      if (generation === (sourceGenerations.get(transport) ?? 0) && read === sourceReads.get(transport))
        recordConnectionResponse(result, transport);
      else if (result.error) throw new Error(result.error);
      return result;
    };
    const results = await Promise.allSettled([load('legacy'), load('browser')]);
    if (listing !== listingGeneration) {
      const current = useGameConnections.getState();
      return { connections: current.connections, ...(current.error ? { error: current.error } : {}) };
    }
    const errors = results.flatMap((result) =>
      result.status === 'rejected'
        ? [result.reason instanceof Error ? result.reason.message : 'Connections could not load.']
        : [],
    );
    const error = [...errors, conflictError(useGameConnections.getState().connections)].filter(Boolean).join(' ');
    useGameConnections.setState({ error });
    if (results.every((result) => result.status === 'rejected')) throw new Error(error);
    return { connections: useGameConnections.getState().connections, ...(error ? { error } : {}) };
  }
  const matches = useGameConnections.getState().connections.filter((entry) => entry.gameId === body?.gameId);
  const explicitTransport =
    body?.transport === 'browser' ? 'browser' : body?.transport === 'legacy' ? 'legacy' : undefined;
  if (matches.length > 1 && !explicitTransport) throw new Error(conflictError(matches));
  const existing = explicitTransport ? matches.find((entry) => sourceOf(entry) === explicitTransport) : matches[0];
  const browserRequest = explicitTransport ? explicitTransport === 'browser' : existing?.transport === 'browser';
  if (body?.action === 'connect' && matches.some((entry) => browserRequest !== (entry.transport === 'browser')))
    throw new Error('Disconnect this game account before changing its connection method.');
  const transport: ConnectionTransport = browserRequest ? 'browser' : 'legacy';
  const id = typeof body?.gameId === 'string' ? body.gameId : '';
  if (id && body?.action !== 'refresh') {
    desktopGenerations.set(id, (desktopGenerations.get(id) ?? 0) + 1);
    sourceGenerations.set(transport, (sourceGenerations.get(transport) ?? 0) + 1);
  }
  const generation = desktopGenerations.get(id) ?? 0;
  let result: ConnectionResponse;
  if (browserRequest) {
    if (!browser) throw new Error('Update the Windows app to use the browser connector.');
    const safeBody =
      body &&
      Object.fromEntries(
        Object.entries(body).filter(([key]) =>
          ['action', 'gameId', 'provider', 'uid', 'server', 'autoRefresh'].includes(key),
        ),
      );
    result = await browser.request(safeBody);
  } else result = await legacyConnectionRequest(body, false);
  if (id && generation !== (desktopGenerations.get(id) ?? 0))
    throw new Error('The account connection changed. Fetch readings again.');
  return recordConnectionResponse(result, isDesktopApp() ? transport : undefined, id || undefined);
}

async function legacyConnectionRequest(body?: Record<string, unknown>, record = true): Promise<ConnectionResponse> {
  const transport = isDesktopApp() ? 'legacy' : undefined;
  if (body?.action === 'connect' && isDesktopApp() && window.memoriaDesktop?.hoyo) {
    const result = await window.memoriaDesktop.hoyo.connectAccount({
      gameId: String(body.gameId),
      provider: body.provider as GameConnection['provider'],
      uid: String(body.uid),
      server: String(body.server),
      autoRefresh: body.autoRefresh === true,
    });
    return record ? recordConnectionResponse(result, transport) : result;
  }
  const response = await launcherFetch(
    '/api/connections',
    body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {},
  );
  const result = (await response.json()) as ConnectionResponse;
  if (!response.ok || result.error) throw new Error(result.error || 'Game connections are unavailable.');
  if (record) recordConnectionResponse(result, transport);
  if (
    body?.action === 'disconnect' &&
    result.connections?.length === 0 &&
    isDesktopApp() &&
    window.memoriaDesktop?.hoyo
  )
    await disconnectHoyo();
  return result;
}

const NATIVE_CONNECTIONS = 'memoria-game-connections';
const nativeGenerations = new Map<string, number>();
function nativeConnections(): GameConnection[] {
  const saved: unknown = JSON.parse(localStorage.getItem(NATIVE_CONNECTIONS) || '[]');
  if (
    !Array.isArray(saved) ||
    saved.length > 30 ||
    saved.some(
      (item) =>
        !item ||
        typeof item.gameId !== 'string' ||
        !['genshin', 'hsr', 'zzz'].includes(item.provider) ||
        typeof item.uid !== 'string' ||
        !/^\d{8,12}$/.test(item.uid) ||
        typeof item.server !== 'string' ||
        typeof item.autoRefresh !== 'boolean' ||
        (item.lastCheckedAt !== null &&
          (typeof item.lastCheckedAt !== 'number' || !Number.isFinite(item.lastCheckedAt))),
    )
  )
    throw new Error('Saved account settings could not be read. Your game data is unchanged.');
  return saved as GameConnection[];
}
async function nativeConnectionRequest(body?: Record<string, unknown>): Promise<ConnectionResponse> {
  const list = nativeConnections();
  if (!body) {
    useGameConnections.setState({ connections: list });
    return { connections: list };
  }
  const existing = list.find((item) => item.gameId === body.gameId);
  if (body.action === 'disconnect') {
    const id = String(body.gameId);
    nativeGenerations.set(id, (nativeGenerations.get(id) ?? 0) + 1);
    const next = list.filter((item) => item.gameId !== body.gameId);
    localStorage.setItem(NATIVE_CONNECTIONS, JSON.stringify(next));
    useGameConnections.setState({ connections: next });
    if (!next.length) await disconnectHoyo();
    return { connections: next };
  }
  if (body.action === 'configure' && existing) {
    const next = list.map((item) =>
      item.gameId === existing.gameId ? { ...item, autoRefresh: body.autoRefresh === true } : item,
    );
    localStorage.setItem(NATIVE_CONNECTIONS, JSON.stringify(next));
    useGameConnections.setState({ connections: next });
    return { connections: next };
  }
  const account =
    body.action === 'connect'
      ? {
          gameId: String(body.gameId),
          provider: body.provider as GameConnection['provider'],
          uid: String(body.uid),
          server: String(body.server),
          autoRefresh: body.autoRefresh === true,
          lastCheckedAt: null,
        }
      : existing;
  if (!account || !['connect', 'refresh'].includes(String(body.action)))
    throw new Error('Connect this game account first.');
  if (body.action === 'connect' && !existing && list.length >= 30)
    throw new Error('Disconnect an account before adding another.');
  if (body.action === 'connect')
    nativeGenerations.set(account.gameId, (nativeGenerations.get(account.gameId) ?? 0) + 1);
  const generation = nativeGenerations.get(account.gameId) ?? 0;
  const fetched = await fetchHoyoNotes({ provider: account.provider, uid: account.uid, server: account.server });
  if (generation !== (nativeGenerations.get(account.gameId) ?? 0))
    throw new Error('The account connection changed. Fetch readings again.');
  const reading: AccountReading = { ...fetched, gameId: account.gameId };
  const latest = nativeConnections();
  const current = latest.find((item) => item.gameId === account.gameId);
  if (!current && latest.length >= 30) throw new Error('Disconnect an account before adding another.');
  if (
    body.action === 'refresh' &&
    (!current ||
      current.uid !== account.uid ||
      current.server !== account.server ||
      current.provider !== account.provider)
  )
    throw new Error('The account connection changed. Fetch readings again.');
  const next = [
    ...latest.filter((item) => item.gameId !== account.gameId),
    { ...(body.action === 'refresh' ? current! : account), lastCheckedAt: reading.observedAt },
  ];
  localStorage.setItem(NATIVE_CONNECTIONS, JSON.stringify(next));
  useGameConnections.setState({ connections: next, error: '' });
  return { connections: next, reading };
}

let polling = false;
async function refreshConnectedGames() {
  if (polling || (document.hidden && !isDesktopApp()) || !navigator.onLine || !useApp.getState().loaded) return;
  polling = true;
  useGameConnections.setState({ refreshing: true });
  try {
    const listed = await connectionRequest();
    const failures: string[] = listed.error ? [listed.error] : [];
    for (const connection of useGameConnections.getState().connections) {
      if (useGameConnections.getState().connections.filter((entry) => entry.gameId === connection.gameId).length > 1)
        continue;
      const game = useApp
        .getState()
        .state.games.find((item) => item.id === connection.gameId && !item.deleted && !item.paused);
      if (!game || !connection.autoRefresh) continue;
      try {
        const result = await connectionRequest({ action: 'refresh', gameId: game.id });
        const current = useGameConnections.getState().connections.find((item) => item.gameId === game.id);
        const currentGame = useApp.getState().state.games.find((item) => item.id === game.id);
        if (
          result.reading &&
          currentGame &&
          !currentGame.paused &&
          !currentGame.deleted &&
          current?.autoRefresh &&
          current.uid === connection.uid &&
          current.provider === connection.provider &&
          current.server === connection.server &&
          sourceOf(current) === sourceOf(connection)
        )
          useApp.getState().applyGameImport(mapHoYoNotes(useApp.getState().state, game.id, result.reading));
      } catch (cause) {
        failures.push(`${game.name}: ${cause instanceof Error ? cause.message : 'Refresh failed.'}`);
      }
    }
    useGameConnections.setState({ error: failures.join(' ') });
  } catch (error) {
    useGameConnections.setState({ error: error instanceof Error ? error.message : 'Account refresh failed.' });
  } finally {
    polling = false;
    useGameConnections.setState({ refreshing: false });
  }
}

/** Automatic refresh is opt-in per account in the Windows and Android apps. */
export function initGameConnections(): () => void {
  if (!servedByLauncher() && !isNativeApp && !isDesktopApp()) return () => undefined;
  void refreshConnectedGames();
  const timer = window.setInterval(() => void refreshConnectedGames(), 5 * 60_000);
  const refresh = () => void refreshConnectedGames();
  document.addEventListener('memoria:refresh-accounts', refresh);
  document.addEventListener('visibilitychange', refresh);
  window.addEventListener('online', refresh);
  return () => {
    window.clearInterval(timer);
    document.removeEventListener('memoria:refresh-accounts', refresh);
    document.removeEventListener('visibilitychange', refresh);
    window.removeEventListener('online', refresh);
  };
}
