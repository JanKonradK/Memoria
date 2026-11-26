import { compareHlc, legacyHlc, recordHlc } from './hlc';
import { HlcSchema } from './validation';
import type { ZodType } from 'zod';
import { IANAZone } from 'luxon';
import type {
  AlarmFreeWindow,
  AlarmTone,
  AppState,
  NotificationStyle,
  Resource,
  Settings,
  SettingsField,
  Snapshot,
  Syncable,
  Task,
} from './types';
import {
  ALARM_TONES,
  MAX_ALARM_FREE_WINDOWS,
  emptyState,
  isSafeGameImage,
  NOTIFICATION_KINDS,
  NOTIFICATION_STYLES,
  SETTINGS_FIELDS,
} from './types';
import { GamePitySchema } from './pity';
import { GameSavingsSchema } from './savings';
import { groupBy, objectRecord } from './internal';
import { latestSnapshots } from './energy';
import { migrateState } from './migrations';
import { inferLegacyResource, inferLegacyTask } from './tracking';
import {
  APP_STATE_COLLECTION_LIMITS,
  AppStateSchema,
  FUTURE_CLOCK_SKEW_TOLERANCE_MS,
  GameCodeSchema,
  GameLayoutItemSchema,
  ObservationProvenanceSchema,
  RemoteFeedVersionSchema,
} from './validation';

const SNAPSHOTS_KEPT_PER_RESOURCE = 200;
/**
 * How long a deletion is kept. A device or backup that comes back within this
 * window cannot bring a deleted row back, because the tombstone still beats it.
 */
export const TOMBSTONE_RETENTION_MS = 365 * 86_400_000;
/** After this a tombstone keeps only the fields every version requires (see slimTombstones). */
export const TOMBSTONE_SLIM_MS = 90 * 86_400_000;
// Completion history is not rendered today. Bounding it keeps the synced document
// under its size limit, but a future streak/history feature will need a separate durable model.
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

/**
 * Equal clocks go to the larger canonical form. Two tombstones with one clock
 * are one deletion, slimmed on one side and not yet on the other, so the
 * smaller wins first: otherwise a peer's full copy would undo the slimming on
 * every sync and the next compaction would redo it.
 */
function wins<T extends Syncable>(item: T, cur: T): boolean {
  const order = compareHlc(recordHlc(item), recordHlc(cur));
  if (order !== 0) return order > 0;
  const left = canonical(item);
  const right = canonical(cur);
  if (item.deleted && cur.deleted && left.length !== right.length) return left.length < right.length;
  return left > right;
}

function mergeById<T extends Syncable & { id: string }>(a: T[], b: T[]): T[] {
  const map = new Map<string, T>();
  for (const side of [a, b]) {
    for (const item of side) {
      const cur = map.get(item.id);
      if (!cur || wins(item, cur)) map.set(item.id, item);
    }
  }
  return [...map.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function mergeSnapshots(a: Snapshot[], b: Snapshot[]): Snapshot[] {
  const map = new Map<string, Snapshot>();
  for (const side of [a, b]) {
    for (const s of side) {
      const current = map.get(s.id);
      if (
        !current ||
        compareHlc(recordHlc(s), recordHlc(current)) > 0 ||
        (compareHlc(recordHlc(s), recordHlc(current)) === 0 && canonical(s) > canonical(current))
      )
        map.set(s.id, s);
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

/** Code-unit order: the same on every engine, unlike localeCompare. */
function byCodeUnit(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * A reading log over `limit`, thinned instead of refused. 100+ resources at the
 * 200-per-resource retention pass the document limit with nothing wrong.
 *
 * Each resource keeps its newest reading and the reading its projection starts
 * from (latestSnapshots), estimate or not. After those, every resource loses its
 * oldest readings first, one rank at a time; a tie at the cut goes by resource
 * id alone. The result depends only on the set of rows, so a merge stays
 * commutative, and a stale peer offering back readings thinned here changes
 * nothing: each one ranks no better than the reading that was kept over it.
 */
export function thinSnapshots(
  snapshots: Snapshot[],
  limit: number = APP_STATE_COLLECTION_LIMITS.snapshots,
): Snapshot[] {
  if (snapshots.length <= limit) return snapshots;
  const anchors = new Set(latestSnapshots(snapshots).values());
  const ranked: { snapshot: Snapshot; rank: number }[] = [];
  for (const list of groupBy(snapshots, (s) => s.resourceId).values()) {
    list.sort((x, y) => y.takenAt - x.takenAt || byCodeUnit(y.id, x.id));
    list.forEach((snapshot, index) =>
      ranked.push({ snapshot, rank: index === 0 || anchors.has(snapshot) ? -1 : index }),
    );
  }
  ranked.sort(
    (x, y) =>
      x.rank - y.rank ||
      byCodeUnit(x.snapshot.resourceId, y.snapshot.resourceId) ||
      byCodeUnit(x.snapshot.id, y.snapshot.id),
  );
  const kept = new Set(ranked.slice(0, limit).map((item) => item.snapshot));
  return snapshots.filter((snapshot) => kept.has(snapshot));
}

/** The same state with its reading log thinned to the limit; the same object when it already fits. */
export function thinStateSnapshots(state: AppState): AppState {
  const snapshots = thinSnapshots(state.snapshots);
  return snapshots === state.snapshots ? state : { ...state, snapshots };
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
  const hlc = HlcSchema.safeParse(record.hlc);
  const updatedAt =
    hlc.success && finiteNumber(record.updatedAt)
      ? Math.max(0, Math.round(record.updatedAt))
      : observedClock(record.updatedAt);
  return updatedAt === null
    ? null
    : {
        ...record,
        updatedAt,
        hlc: hlc.success ? hlc.data : legacyHlc(updatedAt),
        deviceId: hlc.success ? hlc.data.device : 'Unknown device',
      };
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
  questMarks: AppStateSchema.shape.questMarks.unwrap().element,
  customQuests: AppStateSchema.shape.customQuests.unwrap().element,
  notes: AppStateSchema.shape.notes.unwrap().element,
} as const;

function parseRow<T>(schema: ZodType, candidate: unknown): T | null {
  const parsed = schema.safeParse(candidate);
  return parsed.success ? (parsed.data as T) : null;
}

/** Valid entries of an optional list, first occurrence of each id, capped at `max`. */
function salvageById<T extends { id: string }>(list: unknown[], schema: ZodType<T>, max: number): T[] {
  const seen = new Set<string>();
  const kept: T[] = [];
  for (const item of list) {
    if (kept.length >= max) break;
    const parsed = schema.safeParse(item);
    if (!parsed.success || seen.has(parsed.data.id)) continue;
    seen.add(parsed.data.id);
    kept.push(parsed.data);
  }
  return kept;
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
    // A zone luxon cannot load would make every reset calculation throw, on every load.
    tz: isZone(record.tz) ? record.tz : 'UTC',
  };
  if ('image' in game && !isSafeGameImage(game.image)) delete game.image;
  // A damaged optional list entry must not discard the game and its tracking data.
  if (Array.isArray(game.cardLayout)) game.cardLayout = salvageById(game.cardLayout, GameLayoutItemSchema, 2000);
  else delete game.cardLayout;
  if (Array.isArray(game.codes)) game.codes = salvageById(game.codes, GameCodeSchema, 200);
  else delete game.codes;
  // A damaged savings plan is dropped on its own; the game and its tracking survive.
  if ('savings' in game) {
    const savings = GameSavingsSchema.safeParse(game.savings);
    if (savings.success) game.savings = savings.data;
    else delete game.savings;
  }
  if ('pity' in game) {
    const pity = GamePitySchema.safeParse(game.pity);
    if (pity.success) game.pity = pity.data;
    else delete game.pity;
  }
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
  const hasHlc = HlcSchema.safeParse(record.hlc).success;
  const takenAt = hasHlc ? scheduledClock(record.takenAt) : observedClock(record.takenAt);
  if (takenAt === null) return null;
  const candidate: Record<string, unknown> = {
    ...record,
    value: Math.max(0, record.value),
    takenAt,
    hlc: hasHlc ? record.hlc : legacyHlc(takenAt),
    deviceId: hasHlc ? (record.hlc as { device: string }).device : 'Unknown device',
  };
  reviseOptional(candidate, 'reserve', clampToZero);
  if (!ObservationProvenanceSchema.safeParse(candidate.provenance).success) delete candidate.provenance;
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
  if (!ObservationProvenanceSchema.safeParse(candidate.provenance).success) delete candidate.provenance;
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

function normalizeQuestMark(raw: unknown): AppState['questMarks'][number] | null {
  const record = syncableRecord(raw);
  return record ? parseRow(ROWS.questMarks, record) : null;
}

function normalizeCustomQuest(raw: unknown): AppState['customQuests'][number] | null {
  const record = syncableRecord(raw);
  return record ? parseRow(ROWS.customQuests, record) : null;
}

function normalizeNote(raw: unknown): AppState['notes'][number] | null {
  const record = syncableRecord(raw);
  return record ? parseRow(ROWS.notes, record) : null;
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

export class StateCapacityError extends Error {
  constructor(collection: keyof typeof APP_STATE_COLLECTION_LIMITS) {
    super(
      `Sync paused: combined ${collection} exceed the ${APP_STATE_COLLECTION_LIMITS[collection]} item limit. Your data was kept. Export a backup from each device.`,
    );
    this.name = 'StateCapacityError';
  }
}

/** Check before a storage or merge boundary can truncate valid user rows. */
export function assertStateCapacity(state: AppState): void {
  for (const collection of Object.keys(APP_STATE_COLLECTION_LIMITS) as (keyof typeof APP_STATE_COLLECTION_LIMITS)[]) {
    if (state[collection].length > APP_STATE_COLLECTION_LIMITS[collection]) throw new StateCapacityError(collection);
  }
}

/** Row-wise last-write-wins merge of two full states. Commutative and idempotent. */
export function mergeState(a: AppState, b: AppState): AppState {
  // Readings have a retention rule of their own, so a log over the limit is
  // thinned by it. Every other collection still fails before it can be truncated.
  const fittedA = thinStateSnapshots(a);
  const fittedB = thinStateSnapshots(b);
  assertStateCapacity(fittedA);
  assertStateCapacity(fittedB);
  const left = normalizeState(fittedA);
  const right = normalizeState(fittedB);
  const merged: AppState = {
    schemaVersion: Math.max(left.schemaVersion, right.schemaVersion),
    games: mergeById(left.games, right.games),
    resources: mergeById(left.resources, right.resources),
    snapshots: thinSnapshots(mergeSnapshots(left.snapshots, right.snapshots)),
    tasks: mergeById(left.tasks, right.tasks),
    completions: mergeById(left.completions, right.completions),
    events: mergeById(left.events, right.events),
    chips: mergeById(left.chips, right.chips),
    alertRules: mergeById(left.alertRules, right.alertRules),
    reminders: mergeById(left.reminders, right.reminders),
    questMarks: mergeById(left.questMarks, right.questMarks),
    customQuests: mergeById(left.customQuests, right.customQuests),
    notes: mergeById(left.notes, right.notes),
    settings: mergeSettings(left.settings, right.settings),
  };
  // Normalization salvages oversized imports by truncating collections. A sync
  // merge must instead retain both devices' valid data or fail before writing.
  // Snapshot retention and thinning have already run above.
  assertStateCapacity(merged);
  return normalizeState(merged);
}

const CATCH_UP_KEYS_PER_GAME = 200;

function isZone(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 100 && IANAZone.isValidZone(value);
}

/** Keep well-formed entries only; a malformed one is dropped rather than failing every setting. */
function normalizeCatchUpSeen(raw: unknown): Record<string, string[]> | undefined {
  const record = objectRecord(raw);
  if (!record) return undefined;
  // A Map, so a key such as "constructor" or "__proto__" is only ever data.
  const out = new Map<string, string[]>();
  for (const [game, keys] of Object.entries(record)) {
    if (game.length < 1 || game.length > 40 || game === '__proto__' || !Array.isArray(keys)) continue;
    const valid = [
      ...new Set(keys.filter((key): key is string => typeof key === 'string' && key.length > 0 && key.length <= 80)),
    ]
      .sort()
      .slice(-CATCH_UP_KEYS_PER_GAME);
    if (valid.length > 0) out.set(game, valid);
  }
  return out.size > 0 ? Object.fromEntries(out) : undefined;
}

/** Union per game: reading something on one device never unreads it on another. */
function mergeCatchUpSeen(
  a: Record<string, string[]> | undefined,
  b: Record<string, string[]> | undefined,
): Record<string, string[]> | undefined {
  if (!a && !b) return undefined;
  const merged = new Map<string, string[]>();
  for (const side of [a, b]) {
    for (const [game, keys] of Object.entries(side ?? {})) merged.set(game, [...(merged.get(game) ?? []), ...keys]);
  }
  return normalizeCatchUpSeen(Object.fromEntries(merged));
}

/** The hidden default every document carried before quiet hours had a control. */
const LEGACY_QUIET = { start: 60, end: 480 };

function normalizeQuietHours(
  record: Record<string, unknown>,
): Pick<Settings, 'quietStart' | 'quietEnd' | 'quietHoursChosen'> {
  const read = (value: unknown) => (value == null ? null : clampInt(value, 0, 1439, 0));
  const chosen = record.quietHoursChosen === true;
  let quietStart = read(record.quietStart);
  let quietEnd = read(record.quietEnd);
  if (quietStart == null || quietEnd == null) quietStart = quietEnd = null;
  // A reminder an hour before a 03:00 reset was silently dropped by that
  // default. Nobody chose it, so it becomes "no quiet hours".
  else if (!chosen && quietStart === LEGACY_QUIET.start && quietEnd === LEGACY_QUIET.end) quietStart = quietEnd = null;
  return { quietStart, quietEnd, ...(chosen ? { quietHoursChosen: true } : {}) };
}

/** An unknown style or tone is dropped alone, so it cannot reset every other setting. */
function normalizeNotificationStyles(
  record: Record<string, unknown>,
): Pick<Settings, 'notificationStyles' | 'alarmTone' | 'alarmFreeWindows'> {
  const out: Pick<Settings, 'notificationStyles' | 'alarmTone' | 'alarmFreeWindows'> = {};
  const styles = objectRecord(record.notificationStyles);
  if (styles) {
    const kept = Object.fromEntries(
      NOTIFICATION_KINDS.flatMap((kind) =>
        NOTIFICATION_STYLES.includes(styles[kind] as NotificationStyle) ? [[kind, styles[kind]]] : [],
      ),
    );
    if (Object.keys(kept).length) out.notificationStyles = kept;
  }
  if (ALARM_TONES.includes(record.alarmTone as AlarmTone)) out.alarmTone = record.alarmTone as AlarmTone;
  const windows = normalizeAlarmFreeWindows(record.alarmFreeWindows);
  if (windows) out.alarmFreeWindows = windows;
  return out;
}

/** Well-formed no-alarm windows only; a broken one is dropped alone. */
function normalizeAlarmFreeWindows(raw: unknown): AlarmFreeWindow[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const minute = (value: unknown) =>
    Number.isInteger(value) && (value as number) >= 0 && (value as number) < 1440 ? (value as number) : null;
  const kept: AlarmFreeWindow[] = [];
  for (const item of raw) {
    const row = objectRecord(item);
    if (!row || typeof row.id !== 'string' || row.id.length < 1 || row.id.length > 40) continue;
    const start = minute(row.start);
    const end = minute(row.end);
    const days = Array.isArray(row.days)
      ? [...new Set(row.days.filter((day): day is number => Number.isInteger(day) && day >= 1 && day <= 7))].sort()
      : [];
    if (start == null || end == null || start === end || days.length === 0) continue;
    if (kept.some((window) => window.id === row.id)) continue;
    kept.push({ id: row.id, label: typeof row.label === 'string' ? row.label.slice(0, 40) : '', start, end, days });
  }
  return kept.slice(0, MAX_ALARM_FREE_WINDOWS);
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
  const metadata = syncableRecord(record);
  const updatedAt = metadata?.updatedAt as number | undefined;
  const candidate = {
    hlc: metadata?.hlc ?? legacyHlc(0),
    deviceId: metadata?.deviceId ?? 'Unknown device',
    fieldHlc: record.fieldHlc,
    ...normalizeQuietHours(record),
    localTz: isZone(record.localTz) ? record.localTz : base.localTz,
    sleepHours: finiteNumber(record.sleepHours) ? Math.min(24, Math.max(1, record.sleepHours)) : base.sleepHours,
    ...(Number.isInteger(record.digestAt) && (record.digestAt as number) >= 0 && (record.digestAt as number) < 1440
      ? { digestAt: record.digestAt as number }
      : {}),
    // Malformed becomes absent rather than rejected: an unreadable stamp means
    // "never refreshed", which costs one redundant refresh. Letting it through
    // would fail the parse below and reset every other setting to defaults.
    seedImportedVersion:
      typeof record.seedImportedVersion === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(record.seedImportedVersion)
        ? record.seedImportedVersion
        : undefined,
    remoteFeedVersion: RemoteFeedVersionSchema.safeParse(record.remoteFeedVersion).success
      ? RemoteFeedVersionSchema.parse(record.remoteFeedVersion)
      : undefined,
    catchUpSeen: normalizeCatchUpSeen(record.catchUpSeen),
    ...normalizeNotificationStyles(record),
    updatedAt: updatedAt ?? base.updatedAt,
    fieldUpdatedAt: safeFieldClocks,
  };
  const parsed = AppStateSchema.shape.settings.safeParse(candidate);
  return parsed.success ? (parsed.data as Settings) : base;
}

/** Capture legacy fallback clocks before a writer advances the overall settings clock. */
export function settingsFieldClocks(settings: Settings): Record<SettingsField, number> {
  return Object.fromEntries(
    SETTINGS_FIELDS.map((field) => [field, settings.fieldUpdatedAt?.[field] ?? settings.updatedAt]),
  ) as Record<SettingsField, number>;
}

function mergeSettings(left: Partial<Settings> | undefined, right: Partial<Settings> | undefined): Settings {
  const a = normalizeSettings(left);
  const b = normalizeSettings(right);
  const aClocks = settingsFieldClocks(a);
  const bClocks = settingsFieldClocks(b);
  const winner =
    compareHlc(recordHlc(a), recordHlc(b)) > 0 ||
    (compareHlc(recordHlc(a), recordHlc(b)) === 0 && canonical(a) > canonical(b))
      ? a
      : b;
  const merged = { ...winner, fieldUpdatedAt: { ...a.fieldUpdatedAt }, fieldHlc: { ...a.fieldHlc } };
  for (const field of SETTINGS_FIELDS) {
    const aTime = aClocks[field];
    const bTime = bClocks[field];
    const ac = a.fieldHlc?.[field] ?? legacyHlc(aTime);
    const bc = b.fieldHlc?.[field] ?? legacyHlc(bTime);
    const order = compareHlc(bc, ac);
    const useRight = order > 0 || (order === 0 && canonical(b[field]) > canonical(a[field]));
    merged.fieldHlc[field] = useRight ? bc : ac;
    merged[field] = (useRight ? b[field] : a[field]) as never;
    merged.fieldUpdatedAt![field] = Math.max(aTime, bTime);
  }
  merged.updatedAt = Math.max(a.updatedAt, b.updatedAt);
  const remoteVersions = [a.remoteFeedVersion, b.remoteFeedVersion].filter((version) => version != null);
  remoteVersions.sort(
    (left, right) =>
      right.seedUpdated.localeCompare(left.seedUpdated) ||
      Date.parse(right.generatedAt) - Date.parse(left.generatedAt) ||
      right.receivedAt - left.receivedAt ||
      right.revision.localeCompare(left.revision),
  );
  if (remoteVersions[0]) merged.remoteFeedVersion = remoteVersions[0];
  const catchUpSeen = mergeCatchUpSeen(a.catchUpSeen, b.catchUpSeen);
  if (catchUpSeen) merged.catchUpSeen = catchUpSeen;
  else delete merged.catchUpSeen;
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
    questMarks: salvageRows(r.questMarks, APP_STATE_COLLECTION_LIMITS.questMarks, normalizeQuestMark),
    customQuests: salvageRows(r.customQuests, APP_STATE_COLLECTION_LIMITS.customQuests, normalizeCustomQuest),
    notes: salvageRows(r.notes, APP_STATE_COLLECTION_LIMITS.notes, normalizeNote),
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
  const completions = state.completions.filter((completion) => completion.updatedAt >= before);
  return completions.length === state.completions.length ? state : { ...state, completions };
}

type SlimmedCollection =
  'games' | 'resources' | 'tasks' | 'completions' | 'events' | 'reminders' | 'customQuests' | 'notes';

/**
 * What an old tombstone sheds, per collection: optional fields it drops, and
 * required text it empties. Required fields stay, so a slimmed row still parses
 * on every version that reads this document, v0.6 included.
 *
 * An event keeps `sourceKey` and `seedHash`. The feed import finds a deleted
 * bundled event by its source key, and without it would add that event back.
 */
const TOMBSTONE_PAYLOAD: Record<
  SlimmedCollection,
  { drop: readonly string[]; empty: readonly string[]; normalize: (raw: unknown) => unknown }
> = {
  games: {
    drop: [
      'image',
      'notes',
      'cardLayout',
      'savings',
      'pity',
      'codes',
      'processNames',
      'titleFont',
      'accountLabel',
      'server',
    ],
    empty: [],
    normalize: normalizeGame,
  },
  resources: { drop: ['reserveLabel'], empty: [], normalize: normalizeResource },
  tasks: {
    drop: ['timelineMatch', 'timerEndsAt', 'timerStepMinutes', 'timerDurationMinutes'],
    empty: [],
    normalize: normalizeTask,
  },
  completions: { drop: ['provenance'], empty: [], normalize: normalizeCompletion },
  events: { drop: ['reward'], empty: ['notes'], normalize: normalizeEvent },
  reminders: { drop: [], empty: ['message'], normalize: normalizeReminder },
  customQuests: { drop: ['series', 'characters', 'parts', 'notes'], empty: [], normalize: normalizeCustomQuest },
  notes: { drop: [], empty: ['body', 'title'], normalize: normalizeNote },
};

/** The row without its payload, or the same row when there is nothing to shed. */
function slimRow<T extends Syncable>(row: T, collection: SlimmedCollection): T {
  const { drop, empty, normalize } = TOMBSTONE_PAYLOAD[collection];
  const record = row as unknown as Record<string, unknown>;
  const dropped = drop.filter((key) => key in record);
  const emptied = empty.filter((key) => typeof record[key] === 'string' && record[key] !== '');
  if (!dropped.length && !emptied.length) return row;
  const strip = (keys: readonly string[]) =>
    Object.fromEntries(
      Object.entries(record)
        .filter(([key]) => !keys.includes(key))
        .map(([key, value]) => [key, emptied.includes(key) ? '' : value]),
    );
  // A field the row normalizer infers (a timer's length, a reserve's label)
  // would come straight back on the next load and be stripped again on every
  // compaction. Such a field keeps its value, so a slimmed row is a fixed point.
  const inferred = objectRecord(normalize(strip(dropped)));
  if (!inferred) return row;
  const shed = dropped.filter((key) => !(key in inferred));
  if (!shed.length && !emptied.length) return row;
  return strip(shed) as unknown as T;
}

/**
 * Tombstones last updated before `slimBefore`, cut down to what deletion needs.
 *
 * Only the content goes: id, deleted, updatedAt, hlc, and deviceId are kept,
 * so the tombstone still beats any older live copy, and live rows and newer
 * tombstones are returned as they are. The same object comes back when nothing
 * changed, and slimming a slimmed row changes nothing.
 */
export function slimTombstones(state: AppState, slimBefore: number): AppState {
  let changed = false;
  const slim = <T extends Syncable>(items: T[], collection: SlimmedCollection): T[] => {
    let touched = false;
    const next = items.map((item) => {
      if (!item.deleted || item.updatedAt >= slimBefore) return item;
      const slimmed = slimRow(item, collection);
      if (slimmed !== item) touched = true;
      return slimmed;
    });
    if (!touched) return items;
    changed = true;
    return next;
  };
  const next: AppState = {
    ...state,
    games: slim(state.games, 'games'),
    resources: slim(state.resources, 'resources'),
    tasks: slim(state.tasks, 'tasks'),
    completions: slim(state.completions, 'completions'),
    events: slim(state.events, 'events'),
    reminders: slim(state.reminders, 'reminders'),
    customQuests: slim(state.customQuests, 'customQuests'),
    notes: slim(state.notes, 'notes'),
  };
  return changed ? next : state;
}

/**
 * Remove tombstones after every device has had ample time to observe them,
 * slim the ones past TOMBSTONE_SLIM_MS, and prune completion history.
 *
 * Both later cutoffs are measured from `tombstonesBefore` as "now minus the
 * tombstone retention", so passing `now - TOMBSTONE_RETENTION_MS` prunes
 * completions at `now - COMPLETION_RETENTION_MS` and slims at
 * `now - TOMBSTONE_SLIM_MS`. The same object comes back when nothing changed.
 */
export function compactState(
  state: AppState,
  tombstonesBefore: number,
  completionsBefore = tombstonesBefore + TOMBSTONE_RETENTION_MS - COMPLETION_RETENTION_MS,
  slimBefore = tombstonesBefore + TOMBSTONE_RETENTION_MS - TOMBSTONE_SLIM_MS,
): AppState {
  let changed = false;
  const live = <T extends Syncable>(items: T[]) => {
    const kept = items.filter((item) => !item.deleted || item.updatedAt >= tombstonesBefore);
    if (kept.length === items.length) return items;
    changed = true;
    return kept;
  };
  const compacted: AppState = {
    ...state,
    games: live(state.games),
    resources: live(state.resources),
    tasks: live(state.tasks),
    completions: live(state.completions),
    events: live(state.events),
    chips: live(state.chips),
    alertRules: live(state.alertRules),
    reminders: live(state.reminders),
    questMarks: live(state.questMarks),
    customQuests: live(state.customQuests),
    notes: live(state.notes),
  };
  return pruneCompletions(slimTombstones(changed ? compacted : state, slimBefore), completionsBefore);
}
