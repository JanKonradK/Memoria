import { create } from 'zustand';
import { mapHoYoNotes } from '@memoria/shared';
import { launcherFetch, servedByLauncher } from './launcher';
import { useApp } from './store';
import { isNativeApp } from './native';
import { disconnectHoyo, fetchHoyoNotes } from './hoyo-native';

export type GameConnection = {
  gameId: string;
  provider: 'genshin' | 'hsr' | 'zzz';
  uid: string;
  server: string;
  autoRefresh: boolean;
  lastCheckedAt: number | null;
};
export type AccountReading = {
  gameId: string;
  provider: GameConnection['provider'];
  uid: string;
  observedAt: number;
  data: Record<string, unknown>;
};
type ConnectionResponse = { connections?: GameConnection[]; reading?: AccountReading; error?: string };
export const useGameConnections = create<{ connections: GameConnection[]; error: string; refreshing: boolean }>(() => ({
  connections: [],
  error: '',
  refreshing: false,
}));

export async function connectionRequest(body?: Record<string, unknown>): Promise<ConnectionResponse> {
  if (isNativeApp) return nativeConnectionRequest(body);
  const response = await launcherFetch(
    '/api/connections',
    body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {},
  );
  const result = (await response.json()) as ConnectionResponse;
  if (!response.ok) throw new Error(result.error || 'Game connections are unavailable.');
  if (result.connections) useGameConnections.setState({ connections: result.connections, error: '' });
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
  if (polling || document.hidden || !navigator.onLine || !useApp.getState().loaded) return;
  polling = true;
  useGameConnections.setState({ refreshing: true });
  try {
    await connectionRequest();
    const failures: string[] = [];
    for (const connection of useGameConnections.getState().connections) {
      const game = useApp
        .getState()
        .state.games.find((item) => item.id === connection.gameId && !item.deleted && !item.paused);
      if (!game || !connection.autoRefresh) continue;
      try {
        const result = await connectionRequest({ action: 'refresh', gameId: game.id });
        const current = useGameConnections.getState().connections.find((item) => item.gameId === game.id);
        if (
          result.reading &&
          current?.autoRefresh &&
          current.uid === connection.uid &&
          current.provider === connection.provider &&
          current.server === connection.server
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
  if (!servedByLauncher() && !isNativeApp) return () => undefined;
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
