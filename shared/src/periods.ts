import { DateTime } from 'luxon';
import type { Game, Task } from './types';

type ResetGame = Pick<Game, 'tz' | 'dailyResetHour' | 'weeklyResetDay' | 'monthlyResetDay'>;

/**
 * Server-local time on the calendar date associated with the current game day.
 * Comparing the wall clock and stepping a calendar day keeps a 04:00 boundary
 * at 04:00 through DST; subtracting four duration-hours moves it by an offset change.
 */
function shiftedNow(game: ResetGame, now: number): DateTime {
  const dt = DateTime.fromMillis(now, { zone: game.tz });
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

export function nextDailyReset(game: ResetGame, now: number): number {
  const dt = DateTime.fromMillis(now, { zone: game.tz });
  let reset = atHour(dt, game.dailyResetHour);
  if (reset.toMillis() <= now) reset = atHour(dt.plus({ days: 1 }), game.dailyResetHour);
  return reset.toMillis();
}

export function nextWeeklyReset(game: ResetGame, now: number): number {
  const dt = DateTime.fromMillis(now, { zone: game.tz });
  let day = dt.startOf('day');
  for (let i = 0; i <= 7; i++) {
    const candidate = atHour(day, game.dailyResetHour);
    if (candidate.toMillis() > now && day.weekday === game.weeklyResetDay) return candidate.toMillis();
    day = day.plus({ days: 1 }).startOf('day');
  }
  /* istanbul ignore next */
  throw new Error('nextWeeklyReset: no reset found within 8 days');
}

/** Epoch ms when the current weekly period began (most recent weekly reset at or before `now`). */
export function lastWeeklyReset(game: ResetGame, now: number): number {
  const dt = DateTime.fromMillis(now, { zone: game.tz });
  let day = dt.startOf('day');
  for (let i = 0; i <= 7; i++) {
    const candidate = atHour(day, game.dailyResetHour);
    if (candidate.toMillis() <= now && day.weekday === game.weeklyResetDay) return candidate.toMillis();
    day = day.minus({ days: 1 }).startOf('day');
  }
  /* istanbul ignore next */
  return now;
}

export function currentMonthlyPeriodStart(game: ResetGame, now: number): number {
  const dt = DateTime.fromMillis(now, { zone: game.tz });
  const day = monthlyResetDay(game);
  let candidate = atHour(dt.startOf('month').set({ day }), game.dailyResetHour);
  if (candidate.toMillis() > now) {
    candidate = atHour(dt.startOf('month').minus({ months: 1 }).set({ day }), game.dailyResetHour);
  }
  return candidate.toMillis();
}

export function nextMonthlyReset(game: ResetGame, now: number): number {
  const dt = DateTime.fromMillis(now, { zone: game.tz });
  const day = monthlyResetDay(game);
  let candidate = atHour(dt.startOf('month').set({ day }), game.dailyResetHour);
  if (candidate.toMillis() <= now) {
    candidate = atHour(dt.startOf('month').plus({ months: 1 }).set({ day }), game.dailyResetHour);
  }
  return candidate.toMillis();
}

function customPeriodIndex(game: ResetGame, task: Pick<Task, 'anchorAt' | 'intervalDays'>, now: number): number {
  const interval = Math.max(1, task.intervalDays);
  const s = shiftedNow(game, now).startOf('day');
  const a = shiftedNow(game, task.anchorAt).startOf('day');
  const days = Math.floor(s.diff(a, 'days').days);
  return Math.floor(days / interval);
}

export function customPeriodKey(game: ResetGame, task: Pick<Task, 'anchorAt' | 'intervalDays'>, now: number): string {
  return `C${customPeriodIndex(game, task, now)}`;
}

export function nextCustomReset(game: ResetGame, task: Pick<Task, 'anchorAt' | 'intervalDays'>, now: number): number {
  const interval = Math.max(1, task.intervalDays);
  const idx = customPeriodIndex(game, task, now);
  const a = shiftedNow(game, task.anchorAt).startOf('day');
  const nextDay = a.plus({ days: (idx + 1) * interval });
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
