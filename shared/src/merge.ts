import type { ZodType } from 'zod';
import type { AppState, Resource, Settings, SettingsField, Snapshot, Syncable, Task } from './types';
import { emptyState, MAX_GAME_IMAGE_LENGTH } from './types';
import { groupBy, objectRecord } from './internal';
import { migrateState } from './migrations';
import { inferLegacyResource, inferLegacyTask } from './tracking';
import { APP_STATE_COLLECTION_LIMITS, AppStateSchema, FUTURE_CLOCK_SKEW_TOLERANCE_MS } from './validation';

const SNAPSHOTS_KEPT_PER_RESOURCE = 200;
export const TOMBSTONE_RETENTION_MS = 90 * 86_400_000;
// Completion history is not rendered today. Bounding it protects the 1 MB sync
// document, but a future streak/history feature will need a separate durable model.
export const COMPLETION_RETENTION_MS = 120 * 86_400_000;

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
  for (const side of [a, b]) {
    for (const item of side) {
      const cur = map.get(item.id);
      if (
        !cur ||
        item.updatedAt > cur.updatedAt ||
        (item.updatedAt === cur.updatedAt && canonical(item) > canonical(cur))
      ) {
        map.set(item.id, item);
      }
    }
  }
  return [...map.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function mergeSnapshots(a: Snapshot[], b: Snapshot[]): Snapshot[] {
  const map = new Map<string, Snapshot>();
  for (const side of [a, b]) {
    for (const s of side) {
      const current = map.get(s.id);
      if (!current || canonical(s) > canonical(current)) map.set(s.id, s);
    }
  }
  const out: Snapshot[] = [];
  for (const list of groupBy(map.values(), (s) => s.resourceId).values()) {
    list.sort((x, y) => y.takenAt - x.takenAt || y.id.localeCompare(x.id));
    out.push(...list.slice(0, SNAPSHOTS_KEPT_PER_RESOURCE));
  }
  return out.sort(
    (left, right) =>
      left.resourceId.localeCompare(right.resourceId) ||
      right.takenAt - left.takenAt ||
      left.id.localeCompare(right.id),
  );
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * A "when did this happen" clock, or null when it is implausibly ahead of ours.
 *
 * Dropping the record is right HERE, unlike in the schema. This runs on both
 * sides before the merge compares them, and a device never trips its own bound —
 * its Date.now() is skewed by the same amount — so the only row this discards is
 * a poisoned REMOTE one that would otherwise beat sane local data on
 * last-write-wins. Losing that row is the point; keeping it is the bug.
 */
function observedClock(value: unknown): number | null {
  if (!finiteNumber(value)) return 0;
  const clock = Math.max(0, Math.round(value));
  return clock > Date.now() + FUTURE_CLOCK_SKEW_TOLERANCE_MS ? null : clock;
}

function syncableRecord(raw: unknown): Record<string, unknown> | null {
  const record = objectRecord(raw);
  if (!record) return null;
  const updatedAt = observedClock(record.updatedAt);
  return updatedAt === null ? null : { ...record, updatedAt };
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback;
  return Math.min(max, Math.max(min, n));
}

function nonnegative(value: unknown, fallback: number): number {
  return finiteNumber(value) ? Math.max(0, value) : fallback;
}

/** A whole, non-negative point in time — future-dated on purpose, so it has no upper bound. */
function scheduledClock(value: number): number {
  return Math.max(0, Math.round(value));
}

/** Leaves a non-numeric value alone so the row schema, not this pass, decides its fate. */
function scheduledTimestamp(value: unknown): unknown {
  return finiteNumber(value) ? scheduledClock(value) : value;
}

/**
 * Rewrite an optional numeric field in place, deleting it when the value is not
 * a usable number. Absent stays absent — every one of these fields means
 * "infer the default", so dropping a broken one is repair, not data loss.
 */
function reviseOptional(
  candidate: Record<string, unknown>,
  key: string,
  revise: (value: number) => number | null,
): void {
  if (!(key in candidate)) return;
  const value = candidate[key];
  const next = finiteNumber(value) ? revise(value) : null;
  if (next === null) delete candidate[key];
  else candidate[key] = next;
}

const positiveOnly = (value: number): number | null => (value > 0 ? value : null);
const clampToZero = (value: number): number => Math.max(0, value);
const clampCountTarget = (value: number): number => Math.min(365, Math.max(1, value));

/** The per-row schema of each collection — the last word on every normalizer below. */
const ROWS = {
  games: AppStateSchema.shape.games.element,
  resources: AppStateSchema.shape.resources.element,
  snapshots: AppStateSchema.shape.snapshots.element,
  tasks: AppStateSchema.shape.tasks.element,
  completions: AppStateSchema.shape.completions.element,
  events: AppStateSchema.shape.events.element,
  chips: AppStateSchema.shape.chips.element,
  alertRules: AppStateSchema.shape.alertRules.element,
  reminders: AppStateSchema.shape.reminders.element,
} as const;

function parseRow<T>(schema: ZodType, candidate: unknown): T | null {
  const parsed = schema.safeParse(candidate);
  return parsed.success ? (parsed.data as T) : null;
}

/**
 * Reset numbers are safe to clamp because their nearest legal value preserves
 * the user's intent. Other malformed fields drop only this game; accepting them
 * would merely defer the same failure to a less defensive consumer.
 */
function normalizeGame(raw: unknown): AppState['games'][number] | null {
  const record = syncableRecord(raw);
  if (!record) return null;
  const game: Record<string, unknown> = {
    ...record,
    dailyResetHour: clampInt(record.dailyResetHour, 0, 23, 4),
    weeklyResetDay: clampInt(record.weeklyResetDay, 1, 7, 1),
    monthlyResetDay: clampInt(record.monthlyResetDay, 1, 28, 1),
    sort: finiteNumber(record.sort) ? record.sort : 0,
  };
  if (typeof game.image === 'string' && game.image.length > MAX_GAME_IMAGE_LENGTH) delete game.image;
  return parseRow(ROWS.games, game);
}

function normalizeResource(raw: unknown): Resource | null {
  const record = syncableRecord(raw);
  if (!record) return null;
  const candidate: Record<string, unknown> = {
    ...record,
    cap: nonnegative(record.cap, 0),
    regenMinutes: nonnegative(record.regenMinutes, 0),
    reserveCap: nonnegative(record.reserveCap, 0),
    sort: finiteNumber(record.sort) ? record.sort : 0,
  };
  reviseOptional(candidate, 'reserveRegenMinutes', positiveOnly);
  const parsed = parseRow<Resource>(ROWS.resources, candidate);
  // Re-validate: the legacy inference writes fields the raw row never carried.
  return parsed && parseRow<Resource>(ROWS.resources, inferLegacyResource(parsed));
}

function normalizeSnapshot(raw: unknown): Snapshot | null {
  const record = objectRecord(raw);
  if (!record || !finiteNumber(record.takenAt) || !finiteNumber(record.value)) return null;
  const takenAt = observedClock(record.takenAt);
  if (takenAt === null) return null;
  const candidate: Record<string, unknown> = { ...record, value: Math.max(0, record.value), takenAt };
  reviseOptional(candidate, 'reserve', clampToZero);
  return parseRow(ROWS.snapshots, candidate);
}

function normalizeTask(raw: unknown): Task | null {
  const record = syncableRecord(raw);
  if (!record) return null;
  const candidate: Record<string, unknown> = {
    ...record,
    intervalDays: finiteNumber(record.intervalDays) && record.intervalDays > 0 ? record.intervalDays : 1,
    anchorAt: finiteNumber(record.anchorAt) ? scheduledClock(record.anchorAt) : 0,
    sort: finiteNumber(record.sort) ? record.sort : 0,
  };
  reviseOptional(candidate, 'timerDurationMinutes', positiveOnly);
  reviseOptional(candidate, 'timerStepMinutes', positiveOnly);
  // An explicit null is the idle state, not a broken clock — leave it alone.
  if (candidate.timerEndsAt !== null) reviseOptional(candidate, 'timerEndsAt', scheduledClock);
  reviseOptional(candidate, 'countTarget', clampCountTarget);
  const parsed = parseRow<Task>(ROWS.tasks, candidate);
  if (!parsed) return null;
  const inferred = inferLegacyTask(parsed);
  // Inference can read a target out of the name, and names are user text.
  if (finiteNumber(inferred.countTarget)) inferred.countTarget = clampCountTarget(inferred.countTarget);
  return parseRow(ROWS.tasks, inferred);
}

function normalizeCompletion(raw: unknown): AppState['completions'][number] | null {
  const record = syncableRecord(raw);
  if (!record) return null;
  const candidate: Record<string, unknown> = {
    ...record,
    done: typeof record.done === 'boolean' ? record.done : false,
  };
  reviseOptional(candidate, 'countDone', clampToZero);
  return parseRow(ROWS.completions, candidate);
}

function normalizeEvent(raw: unknown): AppState['events'][number] | null {
  const record = syncableRecord(raw);
  if (!record) return null;
  return parseRow(ROWS.events, {
    ...record,
    start: scheduledTimestamp(record.start),
    end: scheduledTimestamp(record.end),
  });
}

function normalizeChip(raw: unknown): AppState['chips'][number] | null {
  const record = syncableRecord(raw);
  if (!record) return null;
  return parseRow(ROWS.chips, { ...record, sort: finiteNumber(record.sort) ? record.sort : 0 });
}

function normalizeAlertRule(raw: unknown): AppState['alertRules'][number] | null {
  const record = syncableRecord(raw);
  if (!record) return null;
  return parseRow(ROWS.alertRules, {
    ...record,
    thresholdMinutes: finiteNumber(record.thresholdMinutes)
      ? Math.max(0, record.thresholdMinutes)
      : record.thresholdMinutes,
  });
}

function normalizeReminder(raw: unknown): AppState['reminders'][number] | null {
  const record = syncableRecord(raw);
  if (!record) return null;
  return parseRow(ROWS.reminders, { ...record, at: scheduledTimestamp(record.at) });
}

function salvageRows<T>(raw: unknown, limit: number, normalize: (row: unknown) => T | null): T[] {
  if (!Array.isArray(raw)) return [];
  const rows: T[] = [];
  for (const item of raw) {
    const row = normalize(item);
    if (row) rows.push(row);
    if (rows.length === limit) break;
  }
  return rows;
}

/** Row-wise last-write-wins merge of two full states. Commutative and idempotent. */
export function mergeState(a: AppState, b: AppState): AppState {
  const left = normalizeState(a);
  const right = normalizeState(b);
  return normalizeState({
    schemaVersion: Math.max(left.schemaVersion, right.schemaVersion),
    games: mergeById(left.games, right.games),
    resources: mergeById(left.resources, right.resources),
    snapshots: mergeSnapshots(left.snapshots, right.snapshots),
    tasks: mergeById(left.tasks, right.tasks),
    completions: mergeById(left.completions, right.completions),
    events: mergeById(left.events, right.events),
    chips: mergeById(left.chips, right.chips),
    alertRules: mergeById(left.alertRules, right.alertRules),
    reminders: mergeById(left.reminders, right.reminders),
    settings: mergeSettings(left.settings, right.settings),
  });
}

function normalizeSettings(raw: unknown): Settings {
  const base = emptyState().settings;
  const record = objectRecord(raw) ?? {};
  const fieldUpdatedAt = objectRecord(record.fieldUpdatedAt);
  const safeFieldClocks = fieldUpdatedAt
    ? Object.fromEntries(
        Object.entries(fieldUpdatedAt).flatMap(([field, value]) => {
          const clock = observedClock(value);
          return clock === null ? [] : [[field, clock]];
        }),
      )
    : {};
  const updatedAt = observedClock(record.updatedAt);
  const candidate = {
    quietStart: record.quietStart === null ? null : clampInt(record.quietStart, 0, 1439, base.quietStart ?? 0),
    quietEnd: record.quietEnd === null ? null : clampInt(record.quietEnd, 0, 1439, base.quietEnd ?? 0),
    localTz:
      typeof record.localTz === 'string' && record.localTz.length > 0 && record.localTz.length <= 100
        ? record.localTz
        : base.localTz,
    sleepHours: finiteNumber(record.sleepHours) ? Math.min(24, Math.max(1, record.sleepHours)) : base.sleepHours,
    // Malformed becomes absent rather than rejected: an unreadable stamp means
    // "never refreshed", which costs one redundant refresh. Letting it through
    // would fail the parse below and reset every other setting to defaults.
    seedImportedVersion:
      typeof record.seedImportedVersion === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(record.seedImportedVersion)
        ? record.seedImportedVersion
        : undefined,
    updatedAt: updatedAt ?? base.updatedAt,
    fieldUpdatedAt: safeFieldClocks,
  };
  const parsed = AppStateSchema.shape.settings.safeParse(candidate);
  return parsed.success ? (parsed.data as Settings) : base;
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

/**
 * Salvage each collection independently so one corrupt row cannot erase the
 * user's other rows, while every returned value has passed its zod row schema.
 */
export function normalizeState(raw: unknown): AppState {
  const base = emptyState();
  const migrated = migrateState(raw);
  if (!migrated || typeof migrated !== 'object') return base;
  const r = migrated as Record<string, unknown>;
  return {
    schemaVersion: base.schemaVersion,
    games: salvageRows(r.games, APP_STATE_COLLECTION_LIMITS.games, normalizeGame),
    resources: salvageRows(r.resources, APP_STATE_COLLECTION_LIMITS.resources, normalizeResource),
    snapshots: salvageRows(r.snapshots, APP_STATE_COLLECTION_LIMITS.snapshots, normalizeSnapshot),
    tasks: salvageRows(r.tasks, APP_STATE_COLLECTION_LIMITS.tasks, normalizeTask),
    completions: salvageRows(r.completions, APP_STATE_COLLECTION_LIMITS.completions, normalizeCompletion),
    events: salvageRows(r.events, APP_STATE_COLLECTION_LIMITS.events, normalizeEvent),
    chips: salvageRows(r.chips, APP_STATE_COLLECTION_LIMITS.chips, normalizeChip),
    alertRules: salvageRows(r.alertRules, APP_STATE_COLLECTION_LIMITS.alertRules, normalizeAlertRule),
    reminders: salvageRows(r.reminders, APP_STATE_COLLECTION_LIMITS.reminders, normalizeReminder),
    settings: normalizeSettings(r.settings),
  };
}

/**
 * Drop completion history older than the retention boundary. These rows have no
 * tombstones, so callers must merge every device's rows before applying this.
 * No current view renders historical completions; bounding document growth here
 * deliberately means a future streak/history feature cannot recover older rows.
 */
export function pruneCompletions(state: AppState, before: number): AppState {
  return {
    ...state,
    completions: state.completions.filter((completion) => completion.updatedAt >= before),
  };
}

/** Remove old tombstones after every device has had ample time to observe them. */
export function compactState(
  state: AppState,
  tombstonesBefore: number,
  completionsBefore = tombstonesBefore + TOMBSTONE_RETENTION_MS - COMPLETION_RETENTION_MS,
): AppState {
  const live = <T extends Syncable>(items: T[]) =>
    items.filter((item) => !item.deleted || item.updatedAt >= tombstonesBefore);
  const compacted = {
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
  return pruneCompletions(compacted, completionsBefore);
}
