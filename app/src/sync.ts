import { mergeState, normalizeState } from '@void/shared';
import { authHeaders, isHostedSession } from './auth-session';
import { getActiveIdentity, getIdentityRevision, useApp } from './store';
import { ANONYMOUS_IDENTITY, DESKTOP_LAUNCHER_ORIGIN, migrateLegacyStorageKeyForIdentity } from './storage-identity';

const CFG_KEY = 'void-sync-config';
const LEGACY_CFG_KEY = 'technogg-sync-config';
const SYNC_WARNING_BYTES = 900_000;

export interface SyncConfig {
  url: string;
  token: string;
}

function syncConfigKey(): string | null {
  const identity = getActiveIdentity();
  return identity ? migrateLegacyStorageKeyForIdentity(CFG_KEY, identity, LEGACY_CFG_KEY) : null;
}

export function getSyncConfig(): SyncConfig {
  const key = syncConfigKey();
  if (!key) return { url: '', token: '' };
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? '{}') as Partial<SyncConfig>;
    if (raw.url) return { url: raw.url, token: raw.token ?? '' };
  } catch {
    /* fall through to defaults */
  }
  // Served by the desktop launcher: sync against it automatically, no setup.
  // It's backed by %APPDATA%\void\state.json; the token is unused
  // locally (the server only listens on 127.0.0.1) but must be non-empty.
  if (DESKTOP_LAUNCHER_ORIGIN.test(window.location.origin)) {
    return { url: window.location.origin, token: 'local' };
  }
  return { url: '', token: '' };
}

export function setSyncConfig(cfg: SyncConfig): void {
  const key = syncConfigKey();
  if (key) localStorage.setItem(key, JSON.stringify(cfg));
}

function apiBase(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

const syncingRevisions = new Set<number>();
let serverVersion: number | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | undefined;

function identityIsCurrent(identity: string, revision: number): boolean {
  return getActiveIdentity() === identity && getIdentityRevision() === revision;
}

export function resetSyncState(): void {
  serverVersion = null;
  clearTimeout(debounceTimer);
  debounceTimer = undefined;
  useApp.getState().setSyncStatus('idle');
}

async function apiConnection(): Promise<{ base: string; headers: Record<string, string> } | null> {
  if (isHostedSession()) return { base: '', headers: await authHeaders() };
  const { url, token } = getSyncConfig();
  if (!url || !token) return null;
  return { base: apiBase(url), headers: { authorization: `Bearer ${token}` } };
}

/** Push local state, receive the server-merged state, merge it back in. */
export async function syncNow(): Promise<void> {
  const identity = getActiveIdentity();
  const revision = getIdentityRevision();
  if (!identity || identity === ANONYMOUS_IDENTITY) return;
  const connection = await apiConnection();
  if (!identityIsCurrent(identity, revision) || !connection || syncingRevisions.has(revision) || !navigator.onLine)
    return;
  const store = useApp.getState();
  const state = store.state;
  const stateBytes = new TextEncoder().encode(JSON.stringify(state)).byteLength;
  if (stateBytes > SYNC_WARNING_BYTES) {
    store.setSyncStatus(
      'error',
      `Local data is ${stateBytes.toLocaleString()} bytes and is nearing the 1 MB sync limit. Export a backup and reduce large images or old data.`,
    );
    return;
  }
  syncingRevisions.add(revision);
  store.setSyncStatus('syncing');
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (!identityIsCurrent(identity, revision)) return;
      const res = await fetch(`${connection.base}/api/sync`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...connection.headers },
        body: JSON.stringify({ state: useApp.getState().state, version: serverVersion }),
      });
      if (!identityIsCurrent(identity, revision)) return;
      if (res.status === 409) {
        const conflict = (await res.json().catch(() => ({}))) as { error?: string };
        if (conflict.error === 'client_outdated') {
          useApp.getState().setSyncStatus('error', 'This device is running an older version -- reload to update');
          return;
        }
        if (attempt >= 2) throw new Error('Sync remained conflicted after three attempts.');
        const latest = await fetch(`${connection.base}/api/state`, { headers: connection.headers });
        if (!identityIsCurrent(identity, revision)) return;
        if (!latest.ok) throw new Error(`HTTP ${latest.status}`);
        const body = (await latest.json()) as { state: unknown; version?: number };
        if (!identityIsCurrent(identity, revision)) return;
        serverVersion = typeof body.version === 'number' ? body.version : serverVersion;
        useApp.getState().replaceState(mergeState(useApp.getState().state, normalizeState(body.state)));
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { state: unknown; version?: number };
      if (!identityIsCurrent(identity, revision)) return;
      serverVersion = typeof data.version === 'number' ? data.version : serverVersion;
      const merged = mergeState(useApp.getState().state, normalizeState(data.state));
      useApp.getState().replaceState(merged);
      useApp.getState().setSyncStatus('ok');
      return;
    }
  } catch (e) {
    if (identityIsCurrent(identity, revision)) {
      useApp.getState().setSyncStatus('error', e instanceof Error ? e.message : String(e));
    }
  } finally {
    syncingRevisions.delete(revision);
  }
}

let initialized = false;

export function initSync(): void {
  if (!initialized) {
    initialized = true;
    document.addEventListener('tg-mutated', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => void syncNow(), 4000);
    });
    // On the desktop launcher, it pushes a ping whenever the shared state file
    // changes on disk — pull right away instead of waiting for the poll.
    if (DESKTOP_LAUNCHER_ORIGIN.test(window.location.origin)) {
      const events = new EventSource('/api/events');
      events.onmessage = () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => void syncNow(), 300);
      };
    }
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) void syncNow();
    });
    window.addEventListener('online', () => void syncNow());
    setInterval(() => void syncNow(), 5 * 60_000);
  }
  void syncNow();
}
