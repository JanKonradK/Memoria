import { mergeState, normalizeState } from '@technogg/shared';
import { useApp } from './store';

const CFG_KEY = 'technogg-sync-config';

export interface SyncConfig {
  url: string;
  token: string;
}

/** Desktop-launcher origins (fixed ports — see desktop/technogg.mjs). */
const LAUNCHER_ORIGIN = /^http:\/\/(127\.0\.0\.1|localhost):1781[789]$/;

export function getSyncConfig(): SyncConfig {
  try {
    const raw = JSON.parse(localStorage.getItem(CFG_KEY) ?? '{}') as Partial<SyncConfig>;
    if (raw.url) return { url: raw.url, token: raw.token ?? '' };
  } catch {
    /* fall through to defaults */
  }
  // Served by the desktop launcher: sync against it automatically, no setup.
  // It shares %APPDATA%\technogg\state.json with the TUI; the token is unused
  // locally (the server only listens on 127.0.0.1) but must be non-empty.
  if (LAUNCHER_ORIGIN.test(window.location.origin)) {
    return { url: window.location.origin, token: 'local' };
  }
  return { url: '', token: '' };
}

export function setSyncConfig(cfg: SyncConfig): void {
  localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
}

function apiBase(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

let syncing = false;

/** Push local state, receive the server-merged state, merge it back in. */
export async function syncNow(): Promise<void> {
  const { url, token } = getSyncConfig();
  if (!url || !token || syncing || !navigator.onLine) return;
  const store = useApp.getState();
  syncing = true;
  store.setSyncStatus('syncing');
  try {
    const res = await fetch(`${apiBase(url)}/api/sync`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ state: useApp.getState().state }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { state: unknown };
    const merged = mergeState(useApp.getState().state, normalizeState(data.state));
    useApp.getState().replaceState(merged);
    useApp.getState().setSyncStatus('ok');
  } catch (e) {
    useApp.getState().setSyncStatus('error', e instanceof Error ? e.message : String(e));
  } finally {
    syncing = false;
  }
}

/** Ask the worker to send a test notification through the configured channels. */
export async function sendTestPing(): Promise<string> {
  const { url, token } = getSyncConfig();
  if (!url || !token) return 'Set the sync server URL and token first.';
  try {
    const res = await fetch(`${apiBase(url)}/api/test-alert`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    });
    const body = (await res.json().catch(() => ({}))) as { sent?: string[]; error?: string };
    if (!res.ok) return body.error ?? `HTTP ${res.status}`;
    return body.sent?.length ? `Sent via: ${body.sent.join(', ')}` : 'No notification channel configured yet.';
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

let debounceTimer: ReturnType<typeof setTimeout> | undefined;

export function initSync(): void {
  document.addEventListener('tg-mutated', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => void syncNow(), 4000);
  });
  // On the desktop launcher, it pushes a ping whenever the shared state file
  // changes (TUI entries) — pull right away instead of waiting for the poll.
  if (LAUNCHER_ORIGIN.test(window.location.origin)) {
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
  void syncNow();
}
