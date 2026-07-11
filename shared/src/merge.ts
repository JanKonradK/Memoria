import type { AppState, Snapshot, Syncable } from './types';
import { emptyState } from './types';

/** Generous retention so wasted-regen stats can look back weeks (rows are tiny). */
const SNAPSHOTS_KEPT_PER_RESOURCE = 200;

function mergeById<T extends Syncable & { id: string }>(a: T[], b: T[]): T[] {
  const map = new Map<string, T>();
  for (const item of [...a, ...b]) {
    const cur = map.get(item.id);
    if (!cur || item.updatedAt > cur.updatedAt) map.set(item.id, item);
  }
  return [...map.values()];
}

function mergeSnapshots(a: Snapshot[], b: Snapshot[]): Snapshot[] {
  const map = new Map<string, Snapshot>();
  for (const s of [...a, ...b]) map.set(s.id, s);
  // Keep only the most recent N per resource so the doc stays small forever.
  const byResource = new Map<string, Snapshot[]>();
  for (const s of map.values()) {
    const list = byResource.get(s.resourceId) ?? [];
    list.push(s);
    byResource.set(s.resourceId, list);
  }
  const out: Snapshot[] = [];
  for (const list of byResource.values()) {
    list.sort((x, y) => y.takenAt - x.takenAt || y.id.localeCompare(x.id));
    out.push(...list.slice(0, SNAPSHOTS_KEPT_PER_RESOURCE));
  }
  return out;
}

/** Row-wise last-write-wins merge of two full states. Commutative and idempotent. */
export function mergeState(a: AppState, b: AppState): AppState {
  const base = emptyState();
  return {
    games: mergeById(a.games, b.games),
    resources: mergeById(a.resources, b.resources),
    snapshots: mergeSnapshots(a.snapshots, b.snapshots),
    tasks: mergeById(a.tasks, b.tasks),
    completions: mergeById(a.completions, b.completions),
    events: mergeById(a.events, b.events),
    chips: mergeById(a.chips, b.chips),
    alertRules: mergeById(a.alertRules, b.alertRules),
    reminders: mergeById(a.reminders, b.reminders),
    focus: mergeById(a.focus, b.focus),
    teams: mergeById(a.teams, b.teams),
    purchases: mergeById(a.purchases, b.purchases),
    wallets: mergeById(a.wallets, b.wallets),
    statuses: mergeById(a.statuses, b.statuses),
    settings:
      (a.settings?.updatedAt ?? 0) >= (b.settings?.updatedAt ?? 0)
        ? (a.settings ?? base.settings)
        : b.settings,
  };
}

/** Coerce unknown JSON into a well-formed AppState (missing collections → empty). */
export function normalizeState(raw: unknown): AppState {
  const base = emptyState();
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Partial<AppState>;
  return {
    games: Array.isArray(r.games) ? r.games : [],
    resources: Array.isArray(r.resources) ? r.resources : [],
    snapshots: Array.isArray(r.snapshots) ? r.snapshots : [],
    tasks: Array.isArray(r.tasks) ? r.tasks : [],
    completions: Array.isArray(r.completions) ? r.completions : [],
    events: Array.isArray(r.events) ? r.events : [],
    chips: Array.isArray(r.chips) ? r.chips : [],
    alertRules: Array.isArray(r.alertRules) ? r.alertRules : [],
    reminders: Array.isArray(r.reminders) ? r.reminders : [],
    focus: Array.isArray(r.focus) ? r.focus : [],
    teams: Array.isArray(r.teams) ? r.teams : [],
    purchases: Array.isArray(r.purchases) ? r.purchases : [],
    wallets: Array.isArray(r.wallets) ? r.wallets : [],
    statuses: Array.isArray(r.statuses) ? r.statuses : [],
    settings: r.settings && typeof r.settings === 'object' ? { ...base.settings, ...r.settings } : base.settings,
  };
}
