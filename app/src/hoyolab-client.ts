import { create } from 'zustand';
import type { AnnEvent, HoyoKind, HoyoRole, ProxyRequest } from '@technogg/shared';
import {
  HOYO_KINDS,
  annRequest,
  mergeState,
  parseAnnList,
  parseRoles,
  refreshNotes,
  rolesRequest,
  unwrapHoyo,
} from '@technogg/shared';
import { useApp } from './store';
import { getSyncConfig } from './sync';

/**
 * Browser side of the HoYoLAB auto-import. HoYoLAB blocks cross-origin calls,
 * so requests are relayed through a backend. Both candidates are tried in
 * order — the configured sync worker (/api/hoyolab), then whatever serves the
 * app (desktop launcher or vite dev server, /hoyolab-proxy) — because either
 * one can be stale or absent independently.
 */
async function relayVia(label: string, endpoint: string, headers: Record<string, string>, req: ProxyRequest): Promise<unknown> {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(req),
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    // Old backend without the relay route answers with the SPA's HTML.
    throw new Error(
      `${label}: relay not available — ${label === 'sync worker' ? 'redeploy the worker (npm run deploy)' : 'restart the TechnoGG desktop app'}`,
    );
  }
  if (!res.ok) throw new Error(`${label}: ${(json as { error?: string }).error ?? `HTTP ${res.status}`}`);
  return json;
}

async function sendProxied(req: ProxyRequest): Promise<unknown> {
  const { url, token } = getSyncConfig();
  const attempts: Array<() => Promise<unknown>> = [];
  if (url.trim() && token) {
    attempts.push(() =>
      relayVia('sync worker', `${url.trim().replace(/\/+$/, '')}/api/hoyolab`, { authorization: `Bearer ${token}` }, req),
    );
  }
  attempts.push(() => relayVia('local relay', '/hoyolab-proxy', {}, req));
  const errors: string[] = [];
  for (const attempt of attempts) {
    try {
      return await attempt();
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  throw new Error(errors.join(' · '));
}

interface HoyoStore {
  refreshing: boolean;
  lastRefreshAt: number | null;
  lastError: string;
}

export const useHoyo = create<HoyoStore>(() => ({
  refreshing: false,
  lastRefreshAt: null,
  lastError: '',
}));

function hoyoConfigured(): boolean {
  const s = useApp.getState().state.settings;
  return Boolean(s.hoyolabCookie.trim()) && s.hoyolabLinks.length > 0;
}

/** Fetch notes for all linked games and fold them into the store. */
export async function refreshHoyolab(): Promise<void> {
  if (!hoyoConfigured() || useHoyo.getState().refreshing) return;
  useHoyo.setState({ refreshing: true });
  try {
    const now = Date.now();
    const { state: refreshed, errors } = await refreshNotes(useApp.getState().state, now, sendProxied);
    // Row-wise merge instead of replace: the user may have edited mid-flight.
    useApp.getState().mutate((s) => mergeState(s, refreshed));
    useHoyo.setState({ refreshing: false, lastRefreshAt: now, lastError: errors.join(' · ') });
  } catch (e) {
    useHoyo.setState({ refreshing: false, lastError: e instanceof Error ? e.message : String(e) });
  }
}

const STALE_MS = 4 * 60_000;

function refreshIfStale(): void {
  const last = useHoyo.getState().lastRefreshAt;
  if (last == null || Date.now() - last > STALE_MS) void refreshHoyolab();
}

/** Kick off periodic auto-refresh (call once after the store is loaded). */
export function initHoyolab(): void {
  setTimeout(refreshIfStale, 1500);
  setInterval(refreshIfStale, 5 * 60_000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshIfStale();
  });
}

/** Ask HoYoLAB which game accounts this cookie owns, per game. */
export async function detectHoyoAccounts(cookie: string): Promise<Partial<Record<HoyoKind, HoyoRole>>> {
  const now = Date.now();
  const out: Partial<Record<HoyoKind, HoyoRole>> = {};
  const results = await Promise.allSettled(
    HOYO_KINDS.map(async (kind) => {
      const json = await sendProxied(rolesRequest(kind, cookie, now));
      return { kind, roles: parseRoles(unwrapHoyo(json)) };
    }),
  );
  const errors: string[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled') {
      if (r.value.roles[0]) out[r.value.kind] = r.value.roles[0];
    } else {
      errors.push(r.reason instanceof Error ? r.reason.message : String(r.reason));
    }
  }
  // Surface a login problem only when every game failed (some just aren't played).
  if (Object.keys(out).length === 0 && errors.length > 0) throw new Error(errors[0]);
  return out;
}

/** Public announcement list (events/banners) for one linked game. */
export async function fetchHoyoAnnouncements(kind: HoyoKind, region: string): Promise<AnnEvent[]> {
  const json = await sendProxied(annRequest(kind, region));
  return parseAnnList(kind, unwrapHoyo(json));
}
