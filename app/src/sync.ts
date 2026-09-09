import { mergeState, normalizeState } from '@memoria/shared';
import { launcherFetch, servedByLauncher } from './launcher';
import { useApp } from './store';

/** The launcher refuses a larger document; warn before the write fails. */
const SYNC_WARNING_BYTES = 900_000;

let syncing = false;
let serverVersion: number | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | undefined;

/** Conflict recovery and successful writes accept the same launcher envelope. */
async function mergeResponse(response: Response): Promise<void> {
  const data = (await response.json()) as { state: unknown; version?: number };
  serverVersion = typeof data.version === 'number' ? data.version : serverVersion;
  useApp.getState().replaceState(mergeState(useApp.getState().state, normalizeState(data.state)));
}

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
      const res = await launcherFetch('/api/sync', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ state: useApp.getState().state, version: serverVersion }),
        signal: AbortSignal.timeout(30_000),
      });
      if (res.status === 409) {
        // Another app window wrote first. Pull its document, merge, retry.
        if (attempt >= 2) throw new Error('Sync remained conflicted after three attempts.');
        const latest = await launcherFetch('/api/state', { signal: AbortSignal.timeout(30_000) });
        if (!latest.ok) throw new Error(`HTTP ${latest.status}`);
        await mergeResponse(latest);
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
      await mergeResponse(res);
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

/** Fetch can send an authorization header; native EventSource cannot. */
function watchLauncherEvents(onChange: () => void): void {
  let stopped = false;
  let controller: AbortController | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let retryDelay = 2000;
  const connect = async () => {
    if (stopped || controller) return;
    controller = new AbortController();
    const signal = controller.signal;
    try {
      const response = await launcherFetch('/api/events', { signal });
      if (!response.ok || !response.body) throw new Error('Event stream unavailable.');
      retryDelay = 2000;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let pending = '';
      try {
        while (!signal.aborted) {
          const { value, done } = await reader.read();
          if (done) break;
          pending += decoder.decode(value, { stream: true });
          let end;
          while ((end = pending.indexOf('\n\n')) >= 0) {
            const event = pending.slice(0, end);
            pending = pending.slice(end + 2);
            if (/^data:/m.test(event)) onChange();
          }
          if (pending.length > 64_000) throw new Error('Invalid event stream.');
        }
      } finally {
        await reader.cancel().catch(() => undefined);
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'LauncherAuthorizationError') {
        stopped = true;
        useApp.getState().setSyncStatus('error', error.message);
      }
      // A launcher restart closes the stream. Reconnect without blocking edits.
    } finally {
      controller = undefined;
      if (!stopped) {
        retryTimer = setTimeout(() => void connect(), retryDelay);
        retryDelay = Math.min(30_000, retryDelay * 2);
      }
    }
  };
  window.addEventListener('pagehide', () => {
    stopped = true;
    clearTimeout(retryTimer);
    controller?.abort();
  });
  window.addEventListener('pageshow', () => {
    stopped = false;
    if (!controller) void connect();
  });
  void connect();
}

export function initSync(): void {
  if (!servedByLauncher() || initialized) return;
  initialized = true;

  document.addEventListener('tg-mutated', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => void syncNow(), 4000);
  });
  // The launcher pushes a ping whenever state.json changes on disk (another app
  // window saved), so a poll timer would only add redundant loopback traffic.
  watchLauncherEvents(() => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => void syncNow(), 300);
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void syncNow();
  });

  void syncNow();
}
