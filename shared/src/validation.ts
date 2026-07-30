import { z } from 'zod';
import type { AppState } from './types';
import { CURRENT_SCHEMA_VERSION, MAX_GAME_IMAGE_LENGTH } from './types';

const id = z.string().min(1).max(160);
const shortText = z.string().max(500);
const longText = z.string().max(20_000);
/**
 * A point in time with no constraint on direction. Correct for fields that are
 * SUPPOSED to be in the future — event windows, reminder due dates, a running
 * timer's end — so this must stay unbounded above.
 */
const timestamp = z.number().int().nonnegative();

/**
 * Five minutes absorbs ordinary device/NTP skew and a slow round trip without
 * letting a bad wall clock suppress real edits or freeze energy for hours.
 */
export const FUTURE_CLOCK_SKEW_TOLERANCE_MS = 5 * 60_000;

/**
 * CLAMP, do not reject.
 *
 * Rejecting looks safer and is worse. `mutate` stamps every edit with the local
 * clock, so a device running more than the tolerance fast stamps everything
 * ahead of SERVER time — and a refine here would make the Worker reject that
 * user's entire document on every sync attempt, forever, with no recovery path
 * short of fixing their OS clock. That trades "one row wins merges it should not"
 * for "this account cannot sync at all".
 *
 * A poisoned LWW clock is reset to zero rather than "now": clamping it to the
 * upper tolerance would still let it beat sane rows. Snapshot time can safely
 * become now because it orders readings rather than resolving edits.
 */
const syncClock = timestamp.transform((value) => (value > Date.now() + FUTURE_CLOCK_SKEW_TOLERANCE_MS ? 0 : value));
const snapshotClock = timestamp.transform((value) =>
  value > Date.now() + FUTURE_CLOCK_SKEW_TOLERANCE_MS ? Date.now() : value,
);

const finite = z.number().finite();
const syncable = {
  updatedAt: syncClock,
  deleted: z.boolean().optional(),
};

const game = z.object({
  ...syncable,
  id,
  name: shortText,
  short: z.string().max(20),
  color: z.string().max(32),
  color2: z.string().max(32).optional(),
  icon: z.string().max(64),
  image: z.string().max(MAX_GAME_IMAGE_LENGTH).optional(),
  platform: z.enum(['pc', 'mobile', 'both']),
  tz: z.string().max(100),
  dailyResetHour: z.number().int().min(0).max(23),
  weeklyResetDay: z.number().int().min(1).max(7),
  monthlyResetDay: z.number().int().min(1).max(28),
  paused: z.boolean(),
  sort: finite,
  notes: longText.optional(),
  processNames: z.array(z.string().max(160)).max(20).optional(),
  hideProgressRing: z.boolean().optional(),
  hideEventStrip: z.boolean().optional(),
  titleFont: z.string().max(120).optional(),
});

const resource = z.object({
  ...syncable,
  id,
  gameId: id,
  name: shortText,
  icon: z.string().max(64).optional(),
  cap: finite.nonnegative(),
  regenMinutes: finite.nonnegative(),
  reserveCap: finite.nonnegative(),
  reserveRegenMinutes: finite.positive().optional(),
  sort: finite,
  kind: z.enum(['regen', 'weekly', 'counter']).optional(),
  reserveLabel: z.string().max(80).optional(),
});

const snapshot = z.object({
  id,
  resourceId: id,
  value: finite.nonnegative(),
  takenAt: snapshotClock,
  reserve: finite.nonnegative().optional(),
});

const task = z.object({
  ...syncable,
  id,
  gameId: id,
  name: shortText,
  cadence: z.enum(['daily', 'weekly', 'monthly', 'custom']),
  intervalDays: finite.positive(),
  anchorAt: timestamp,
  sort: finite,
  mode: z.enum(['check', 'timer', 'count']).optional(),
  timerDurationMinutes: finite.positive().optional(),
  timerEndsAt: timestamp.nullable().optional(),
  countTarget: finite.positive().max(365).optional(),
  timelineLinked: z.boolean().optional(),
  timelineMatch: z.string().max(120).optional(),
  core: z.boolean().optional(),
});

const completion = z.object({
  ...syncable,
  id,
  taskId: id,
  periodKey: z.string().max(80),
  done: z.boolean(),
  countDone: finite.nonnegative().optional(),
});

const event = z.object({
  ...syncable,
  id,
  gameId: id,
  name: shortText,
  type: z.enum(['banner', 'event', 'cycle', 'maintenance', 'custom']),
  start: timestamp,
  end: timestamp,
  dailyTouch: z.boolean(),
  notify: z.boolean(),
  done: z.boolean().optional(),
  notes: longText,
  sourceKey: z.string().max(300).optional(),
});

const chip = z.object({
  ...syncable,
  id,
  gameId: id,
  label: shortText,
  delta: finite,
  sort: finite,
});

const alertRule = z.object({
  ...syncable,
  id,
  gameId: id.nullable(),
  type: z.enum(['energy_cap', 'daily_undone', 'weekly_undone', 'monthly_undone', 'event_end']),
  thresholdMinutes: finite.nonnegative(),
  enabled: z.boolean(),
});

const reminder = z.object({
  ...syncable,
  id,
  gameId: id.nullable(),
  message: longText,
  at: timestamp,
});

const settings = z.object({
  ...syncable,
  quietStart: z.number().int().min(0).max(1439).nullable(),
  quietEnd: z.number().int().min(0).max(1439).nullable(),
  localTz: z.string().min(1).max(100),
  sleepHours: finite.min(1).max(24),
  fieldUpdatedAt: z.record(z.string(), syncClock).optional(),
});

export const APP_STATE_COLLECTION_LIMITS = {
  games: 100,
  resources: 1_000,
  snapshots: 20_000,
  tasks: 2_000,
  completions: 50_000,
  events: 10_000,
  chips: 1_000,
  alertRules: 2_000,
  reminders: 5_000,
} as const;

export const AppStateSchema = z.object({
  schemaVersion: z.number().int().min(1).max(CURRENT_SCHEMA_VERSION).default(CURRENT_SCHEMA_VERSION),
  games: z.array(game).max(APP_STATE_COLLECTION_LIMITS.games),
  resources: z.array(resource).max(APP_STATE_COLLECTION_LIMITS.resources),
  snapshots: z.array(snapshot).max(APP_STATE_COLLECTION_LIMITS.snapshots),
  tasks: z.array(task).max(APP_STATE_COLLECTION_LIMITS.tasks),
  completions: z.array(completion).max(APP_STATE_COLLECTION_LIMITS.completions),
  events: z.array(event).max(APP_STATE_COLLECTION_LIMITS.events),
  chips: z.array(chip).max(APP_STATE_COLLECTION_LIMITS.chips),
  alertRules: z.array(alertRule).max(APP_STATE_COLLECTION_LIMITS.alertRules),
  reminders: z.array(reminder).max(APP_STATE_COLLECTION_LIMITS.reminders),
  settings,
});

export function parseAppState(input: unknown): AppState {
  return AppStateSchema.parse(input) as AppState;
}

export function safeParseAppState(
  input: unknown,
): { success: true; data: AppState } | { success: false; error: string } {
  const result = AppStateSchema.safeParse(input);
  if (result.success) return { success: true, data: result.data as AppState };
  return { success: false, error: result.error.issues.map((issue) => issue.message).join('; ') };
}
