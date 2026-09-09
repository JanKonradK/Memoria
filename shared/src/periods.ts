import { DateTime } from 'luxon';
import type { Game, Task } from './types';

type ResetGame = Pick<Game, 'tz' | 'dailyResetHour' | 'weeklyResetDay' | 'monthlyResetDay'>;

/** Server-local time for an instant. */
function zoned(game: Pick<Game, 'tz'>, at: number): DateTime {
  return DateTime.fromMillis(at, { zone: game.tz });
}

/**
 * Server-local time on the calendar date associated with the current game day.
 * Comparing the wall clock and stepping a calendar day keeps a 04:00 boundary
 * at 04:00 through DST; subtracting four duration-hours moves it by an offset change.
 */
function shiftedNow(game: ResetGame, now: number): DateTime {
  const dt = zoned(game, now);
  return dt.hour < game.dailyResetHour ? dt.minus({ days: 1 }) : dt;
}

/** Wall-clock `hour`:00 on the calendar day of `day` (DST-safe, unlike plus({hours})). */
function atHour(day: DateTime, hour: number): DateTime {
  return day.set({ hour, minute: 0, second: 0, millisecond: 0 });
}

/** Persisted state can bypass validation; 1–28 gives every month the same reset date. */
function monthlyResetDay(game: ResetGame): number {
  return Math.min(28, Math.max(1, game.monthlyResetDay));
}

export function dailyPeriodKey(game: ResetGame, now: number): string {
  return `D${shiftedNow(game, now).toISODate()}`;
}

export function weeklyPeriodKey(game: ResetGame, now: number): string {
  const s = shiftedNow(game, now);
  const daysSinceReset = (s.weekday - game.weeklyResetDay + 7) % 7;
  return `W${s.minus({ days: daysSinceReset }).toISODate()}`;
}

export function monthlyPeriodKey(game: ResetGame, now: number): string {
  const s = shiftedNow(game, now);
  const m = s.day >= monthlyResetDay(game) ? s : s.minus({ months: 1 });
  return `M${m.toFormat('yyyy-LL')}`;
}

/** Wall-clock reset moment on the configured monthly day, `months` from the month of `dt`. */
function monthlyResetAt(game: ResetGame, dt: DateTime, months: number): DateTime {
  return atHour(
    dt
      .startOf('month')
      .plus({ months })
      .set({ day: monthlyResetDay(game) }),
    game.dailyResetHour,
  );
}

export function nextDailyReset(game: Pick<Game, 'tz' | 'dailyResetHour'>, now: number): number {
  const dt = zoned(game, now);
  const reset = atHour(dt, game.dailyResetHour);
  return (reset.toMillis() <= now ? atHour(dt.plus({ days: 1 }), game.dailyResetHour) : reset).toMillis();
}

/** Start from midnight so a repeated DST hour selects the same reset from either direction. */
function weeklyResetAt(game: ResetGame, now: number, direction: 1 | -1): number | undefined {
  let day = zoned(game, now).startOf('day');
  for (let i = 0; i <= 7; i++) {
    const candidate = atHour(day, game.dailyResetHour).toMillis();
    if (day.weekday === game.weeklyResetDay && (direction === 1 ? candidate > now : candidate <= now)) {
      return candidate;
    }
    day = day.plus({ days: direction }).startOf('day');
  }
  return undefined;
}

export function nextWeeklyReset(game: ResetGame, now: number): number {
  const reset = weeklyResetAt(game, now, 1);
  if (reset !== undefined) return reset;
  throw new Error('nextWeeklyReset: no reset found within 8 days');
}

/** Epoch ms when the current weekly period began (most recent weekly reset at or before `now`). */
export function lastWeeklyReset(game: ResetGame, now: number): number {
  return weeklyResetAt(game, now, -1) ?? now;
}

export function currentMonthlyPeriodStart(game: ResetGame, now: number): number {
  const dt = zoned(game, now);
  const thisMonth = monthlyResetAt(game, dt, 0);
  return (thisMonth.toMillis() > now ? monthlyResetAt(game, dt, -1) : thisMonth).toMillis();
}

export function nextMonthlyReset(game: ResetGame, now: number): number {
  const dt = zoned(game, now);
  const thisMonth = monthlyResetAt(game, dt, 0);
  return (thisMonth.toMillis() <= now ? monthlyResetAt(game, dt, 1) : thisMonth).toMillis();
}

type CustomTask = Pick<Task, 'anchorAt' | 'intervalDays'>;

/** Server-local game day the custom cadence counts its intervals from. */
function customAnchorDay(game: ResetGame, task: CustomTask): DateTime {
  return shiftedNow(game, task.anchorAt).startOf('day');
}

function customPeriodIndex(game: ResetGame, task: CustomTask, now: number): number {
  const days = Math.floor(shiftedNow(game, now).startOf('day').diff(customAnchorDay(game, task), 'days').days);
  return Math.floor(days / Math.max(1, task.intervalDays));
}

export function customPeriodKey(game: ResetGame, task: CustomTask, now: number): string {
  return `C${customPeriodIndex(game, task, now)}`;
}

export function nextCustomReset(game: ResetGame, task: CustomTask, now: number): number {
  const periods = customPeriodIndex(game, task, now) + 1;
  const nextDay = customAnchorDay(game, task).plus({ days: periods * Math.max(1, task.intervalDays) });
  // A wall-clock set preserves the configured reset hour when the interval crosses DST.
  return atHour(nextDay, game.dailyResetHour).toMillis();
}

/** Period key for a task given its cadence. */
export function taskPeriodKey(game: ResetGame, task: Task, now: number): string {
  switch (task.cadence) {
    case 'daily':
      return dailyPeriodKey(game, now);
    case 'weekly':
      return weeklyPeriodKey(game, now);
    case 'monthly':
      return monthlyPeriodKey(game, now);
    case 'custom':
      return customPeriodKey(game, task, now);
  }
}

/** When the current period of a task ends (its next reset), epoch ms. */
export function taskNextReset(game: ResetGame, task: Task, now: number): number {
  switch (task.cadence) {
    case 'daily':
      return nextDailyReset(game, now);
    case 'weekly':
      return nextWeeklyReset(game, now);
    case 'monthly':
      return nextMonthlyReset(game, now);
    case 'custom':
      return nextCustomReset(game, task, now);
  }
}
