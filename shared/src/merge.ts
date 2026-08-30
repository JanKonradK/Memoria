import type { AppState, Resource, Settings, SettingsField, Snapshot, Syncable, Task } from './types';
import { emptyState, MAX_GAME_IMAGE_LENGTH } from './types';
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
  return [...map.values()].sort((left, right) => left.id.localeCompare(right.id));
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
  return out.sort(
    (left, right) =>
      left.resourceId.localeCompare(right.resourceId) ||
      right.takenAt - left.takenAt ||
      left.id.localeCompare(right.id),
  );
}

function objectRecord(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
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

function scheduledTimestamp(value: unknown): unknown {
  return finiteNumber(value) ? Math.max(0, Math.round(value)) : value;
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
  const parsed = AppStateSchema.shape.games.element.safeParse(game);
  return parsed.success ? (parsed.data as AppState['games'][number]) : null;
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
  if ('reserveRegenMinutes' in candidate && !finiteNumber(candidate.reserveRegenMinutes)) {
    delete candidate.reserveRegenMinutes;
  } else if (finiteNumber(candidate.reserveRegenMinutes) && candidate.reserveRegenMinutes <= 0) {
    delete candidate.reserveRegenMinutes;
  }
  const parsed = AppStateSchema.shape.resources.element.safeParse(candidate);
  if (!parsed.success) return null;
  const inferred = inferLegacyResource(parsed.data as Resource);
  const validated = AppStateSchema.shape.resources.element.safeParse(inferred);
  return validated.success ? (validated.data as Resource) : null;
}

function normalizeSnapshot(raw: unknown): Snapshot | null {
  const record = objectRecord(raw);
  if (!record || !finiteNumber(record.takenAt) || !finiteNumber(record.value)) return null;
  const takenAt = observedClock(record.takenAt);
  if (takenAt === null) return null;
  const candidate = {
    ...record,
    value: Math.max(0, record.value),
    takenAt,
  };
  if ('reserve' in candidate) {
    if (finiteNumber(candidate.reserve)) candidate.reserve = Math.max(0, candidate.reserve);
    else delete candidate.reserve;
  }
  const parsed = AppStateSchema.shape.snapshots.element.safeParse(candidate);
  return parsed.success ? (parsed.data as Snapshot) : null;
}

function normalizeTask(raw: unknown): Task | null {
  const record = syncableRecord(raw);
  if (!record) return null;
  const candidate = {
    ...record,
    intervalDays: finiteNumber(record.intervalDays) && record.intervalDays > 0 ? record.intervalDays : 1,
    anchorAt: finiteNumber(record.anchorAt) ? scheduledTimestamp(record.anchorAt) : 0,
    sort: finiteNumber(record.sort) ? record.sort : 0,
  };
  if ('timerDurationMinutes' in candidate) {
    if (!finiteNumber(candidate.timerDurationMinutes) || candidate.timerDurationMinutes <= 0)
      delete candidate.timerDurationMinutes;
  }
  if ('timerStepMinutes' in candidate) {
    if (!finiteNumber(candidate.timerStepMinutes) || candidate.timerStepMinutes <= 0) delete candidate.timerStepMinutes;
  }
  if ('timerEndsAt' in candidate && candidate.timerEndsAt !== null) {
    if (finiteNumber(candidate.timerEndsAt)) candidate.timerEndsAt = scheduledTimestamp(candidate.timerEndsAt);
    else delete candidate.timerEndsAt;
  }
  if ('countTarget' in candidate) {
    if (finiteNumber(candidate.countTarget)) candidate.countTarget = Math.min(365, Math.max(1, candidate.countTarget));
    else delete candidate.countTarget;
  }
  const parsed = AppStateSchema.shape.tasks.element.safeParse(candidate);
  if (!parsed.success) return null;
  const inferred = inferLegacyTask(parsed.data as Task);
  if (finiteNumber(inferred.countTarget)) inferred.countTarget = Math.min(365, Math.max(1, inferred.countTarget));
  const validated = AppStateSchema.shape.tasks.element.safeParse(inferred);
  return validated.success ? (validated.data as Task) : null;
}

function normalizeCompletion(raw: unknown): AppState['completions'][number] | null {
  const record = syncableRecord(raw);
  if (!record) return null;
  const candidate = {
    ...record,
    done: typeof record.done === 'boolean' ? record.done : false,
  };
  if ('countDone' in candidate) {
    if (finiteNumber(candidate.countDone)) candidate.countDone = Math.max(0, candidate.countDone);
    else delete candidate.countDone;
  }
  const parsed = AppStateSchema.shape.completions.element.safeParse(candidate);
  return parsed.success ? (parsed.data as AppState['completions'][number]) : null;
}

function normalizeEvent(raw: unknown): AppState['events'][number] | null {
  const record = syncableRecord(raw);
  if (!record) return null;
  const candidate = {
    ...record,
    start: scheduledTimestamp(record.start),
    end: scheduledTimestamp(record.end),
  };
  const parsed = AppStateSchema.shape.events.element.safeParse(candidate);
  return parsed.success ? (parsed.data as AppState['events'][number]) : null;
}

function normalizeChip(raw: unknown): AppState['chips'][number] | null {
  const record = syncableRecord(raw);
  if (!record) return null;
  const candidate = {
    ...record,
    sort: finiteNumber(record.sort) ? record.sort : 0,
  };
  const parsed = AppStateSchema.shape.chips.element.safeParse(candidate);
  return parsed.success ? (parsed.data as AppState['chips'][number]) : null;
}

function normalizeAlertRule(raw: unknown): AppState['alertRules'][number] | null {
  const record = syncableRecord(raw);
  if (!record) return null;
  const candidate = {
    ...record,
    thresholdMinutes: finiteNumber(record.thresholdMinutes)
      ? Math.max(0, record.thresholdMinutes)
      : record.thresholdMinutes,
  };
  const parsed = AppStateSchema.shape.alertRules.element.safeParse(candidate);
  return parsed.success ? (parsed.data as AppState['alertRules'][number]) : null;
}

function normalizeReminder(raw: unknown): AppState['reminders'][number] | null {
  const record = syncableRecord(raw);
  if (!record) return null;
  const candidate = { ...record, at: scheduledTimestamp(record.at) };
  const parsed = AppStateSchema.shape.reminders.element.safeParse(candidate);
  return parsed.success ? (parsed.data as AppState['reminders'][number]) : null;
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
