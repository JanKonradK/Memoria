import type { AppState, Completion, Resource, Settings, SettingsField, Snapshot, Syncable, Task } from './types';
import { emptyState } from './types';
import { inferLegacyResource, inferLegacyTask } from './tracking';

const SNAPSHOTS_KEPT_PER_RESOURCE = 200;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function mergeById<T extends Syncable & { id: string }>(a: T[], b: T[]): T[] {
  const map = new Map<string, T>();
  for (const item of [...a, ...b]) {
    const cur = map.get(item.id);
    if (
      !cur ||
      item.updatedAt > cur.updatedAt ||
      (item.updatedAt === cur.updatedAt && canonical(item) > canonical(cur))
    ) {
      map.set(item.id, item);
    }
  }
  return [...map.values()];
}

function mergeSnapshots(a: Snapshot[], b: Snapshot[]): Snapshot[] {
  const map = new Map<string, Snapshot>();
  for (const s of [...a, ...b]) {
    const current = map.get(s.id);
    if (!current || canonical(s) > canonical(current)) map.set(s.id, s);
  }
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

function normalizeResource(raw: Resource): Resource {
  return inferLegacyResource({
    ...raw,
    cap: Number.isFinite(raw.cap) ? raw.cap : 0,
    regenMinutes: Number.isFinite(raw.regenMinutes) ? raw.regenMinutes : 0,
    reserveCap: Number.isFinite(raw.reserveCap) ? raw.reserveCap : 0,
    sort: Number.isFinite(raw.sort) ? raw.sort : 0,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : 0,
  });
}

function normalizeTask(raw: Task): Task {
  return inferLegacyTask({
    ...raw,
    intervalDays: Number.isFinite(raw.intervalDays) && raw.intervalDays > 0 ? raw.intervalDays : 1,
    anchorAt: typeof raw.anchorAt === 'number' ? raw.anchorAt : 0,
    sort: Number.isFinite(raw.sort) ? raw.sort : 0,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : 0,
  });
}

function normalizeCompletion(raw: Completion): Completion {
  return {
    ...raw,
    done: Boolean(raw.done),
    countDone: typeof raw.countDone === 'number' ? Math.max(0, raw.countDone) : undefined,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : 0,
  };
}

/** Row-wise last-write-wins merge of two full states. Commutative and idempotent. */
export function mergeState(a: AppState, b: AppState): AppState {
  const base = emptyState();
  return {
    schemaVersion: Math.max(a.schemaVersion ?? 1, b.schemaVersion ?? 1, base.schemaVersion),
    games: mergeById(a.games, b.games),
    resources: mergeById(a.resources, b.resources).map(normalizeResource),
    snapshots: mergeSnapshots(a.snapshots, b.snapshots),
    tasks: mergeById(a.tasks, b.tasks).map(normalizeTask),
    completions: mergeById(a.completions, b.completions).map(normalizeCompletion),
    events: mergeById(a.events, b.events),
    chips: mergeById(a.chips, b.chips),
    alertRules: mergeById(a.alertRules, b.alertRules),
    reminders: mergeById(a.reminders, b.reminders),
    settings: mergeSettings(a.settings, b.settings),
  };
}

function normalizeSettings(raw: Partial<Settings> | undefined): Settings {
  const base = emptyState().settings;
  return {
    quietStart: typeof raw?.quietStart === 'number' || raw?.quietStart === null ? raw.quietStart : base.quietStart,
    quietEnd: typeof raw?.quietEnd === 'number' || raw?.quietEnd === null ? raw.quietEnd : base.quietEnd,
    localTz: typeof raw?.localTz === 'string' ? raw.localTz : base.localTz,
    sleepHours: typeof raw?.sleepHours === 'number' ? raw.sleepHours : base.sleepHours,
    updatedAt: typeof raw?.updatedAt === 'number' ? raw.updatedAt : base.updatedAt,
    fieldUpdatedAt:
      raw?.fieldUpdatedAt && typeof raw.fieldUpdatedAt === 'object'
        ? Object.fromEntries(
            Object.entries(raw.fieldUpdatedAt).filter(
              ([, value]) => typeof value === 'number' && Number.isFinite(value),
            ),
          )
        : {},
  };
}

const SETTINGS_FIELDS: SettingsField[] = ['quietStart', 'quietEnd', 'localTz', 'sleepHours'];

function mergeSettings(left: Partial<Settings> | undefined, right: Partial<Settings> | undefined): Settings {
  const a = normalizeSettings(left);
  const b = normalizeSettings(right);
  const merged = { ...a, fieldUpdatedAt: { ...a.fieldUpdatedAt } };
  for (const field of SETTINGS_FIELDS) {
    const aTime = a.fieldUpdatedAt?.[field] ?? a.updatedAt;
    const bTime = b.fieldUpdatedAt?.[field] ?? b.updatedAt;
    const useRight = bTime > aTime || (bTime === aTime && canonical(b[field]) > canonical(a[field]));
    merged[field] = (useRight ? b[field] : a[field]) as never;
    merged.fieldUpdatedAt![field] = Math.max(aTime, bTime);
  }
  merged.updatedAt = Math.max(a.updatedAt, b.updatedAt);
  return merged;
}

/** Coerce unknown JSON into a well-formed AppState (missing collections → empty). */
export function normalizeState(raw: unknown): AppState {
  const base = emptyState();
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Partial<AppState>;
  return {
    schemaVersion: Math.max(base.schemaVersion, typeof r.schemaVersion === 'number' ? r.schemaVersion : 1),
    games: Array.isArray(r.games) ? r.games : [],
    resources: Array.isArray(r.resources) ? r.resources.map((item) => normalizeResource(item as Resource)) : [],
    snapshots: Array.isArray(r.snapshots) ? r.snapshots : [],
    tasks: Array.isArray(r.tasks) ? r.tasks.map((item) => normalizeTask(item as Task)) : [],
    completions: Array.isArray(r.completions)
      ? r.completions.map((item) => normalizeCompletion(item as Completion))
      : [],
    events: Array.isArray(r.events) ? r.events : [],
    chips: Array.isArray(r.chips) ? r.chips : [],
    alertRules: Array.isArray(r.alertRules) ? r.alertRules : [],
    reminders: Array.isArray(r.reminders) ? r.reminders : [],
    settings: normalizeSettings(r.settings),
  };
}

/** Remove old tombstones after every device has had ample time to observe them. */
export function compactState(state: AppState, before: number): AppState {
  const live = <T extends Syncable>(items: T[]) => items.filter((item) => !item.deleted || item.updatedAt >= before);
  return {
    ...state,
    games: live(state.games),
    resources: live(state.resources),
    tasks: live(state.tasks),
    completions: live(state.completions),
    events: live(state.events),
    chips: live(state.chips),
    alertRules: live(state.alertRules),
    reminders: live(state.reminders),
  };
}
