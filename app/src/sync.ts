import { mergeState, normalizeState } from '@memoria/shared';
import { servedByLauncher } from './launcher';
import { useApp } from './store';

/** The launcher refuses a larger document; warn before the write fails. */
const SYNC_WARNING_BYTES = 900_000;

let syncing = false;
let serverVersion: number | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | undefined;

export function resetSyncState(): void {
  serverVersion = null;
  clearTimeout(debounceTimer);
  debounceTimer = undefined;
  useApp.getState().setSyncStatus('idle');
}

/** Push local state to the launcher, receive the merged document, merge it back in. */
export async function syncNow(): Promise<void> {
  if (!servedByLauncher() || syncing) return;
  const store = useApp.getState();
  const stateBytes = new TextEncoder().encode(JSON.stringify(store.state)).byteLength;
  if (stateBytes > SYNC_WARNING_BYTES) {
    store.setSyncStatus(
      'error',
      `Local data is ${stateBytes.toLocaleString()} bytes and is nearing the 1 MB launcher limit. Export a backup and reduce large images or old data.`,
    );
    return;
  }
  syncing = true;
  store.setSyncStatus('syncing');
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch('/api/sync', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ state: useApp.getState().state, version: serverVersion }),
      });
      if (res.status === 409) {
        // Another app window wrote first. Pull its document, merge, retry.
        if (attempt >= 2) throw new Error('Sync remained conflicted after three attempts.');
        const latest = await fetch('/api/state');
        if (!latest.ok) throw new Error(`HTTP ${latest.status}`);
        const body = (await latest.json()) as { state: unknown; version?: number };
        serverVersion = typeof body.version === 'number' ? body.version : serverVersion;
        useApp.getState().replaceState(mergeState(useApp.getState().state, normalizeState(body.state)));
        continue;
      }
      if (!res.ok) {
        let message = `HTTP ${res.status}`;
        try {
          const body = (await res.json()) as { error?: unknown };
          if (typeof body.error === 'string') message = body.error;
        } catch {
          // The status remains useful when the launcher did not return JSON.
        }
        throw new Error(message);
      }
      const data = (await res.json()) as { state: unknown; version?: number };
      serverVersion = typeof data.version === 'number' ? data.version : serverVersion;
      useApp.getState().replaceState(mergeState(useApp.getState().state, normalizeState(data.state)));
      useApp.getState().setSyncStatus('ok');
      return;
    }
  } catch (e) {
    useApp.getState().setSyncStatus('error', e instanceof Error ? e.message : String(e));
  } finally {
    syncing = false;
  }
}

let initialized = false;

export function initSync(): void {
  if (!servedByLauncher() || initialized) return;
  initialized = true;

  document.addEventListener('tg-mutated', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => void syncNow(), 4000);
  });
  // The launcher pushes a ping whenever state.json changes on disk (another app
  // window saved), so a poll timer would only add redundant loopback traffic.
  const events = new EventSource('/api/events');
  events.onmessage = () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => void syncNow(), 300);
  };
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void syncNow();
  });

  void syncNow();
}
