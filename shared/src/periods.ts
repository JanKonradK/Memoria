import { DateTime } from 'luxon';
import type { Game, Task } from './types';

type ResetGame = Pick<Game, 'tz' | 'dailyResetHour' | 'weeklyResetDay' | 'monthlyResetDay'>;

/**
 * Server-local time shifted back by the daily reset hour, so that a game "day"
 * (reset → reset) maps onto one calendar date. E.g. with a 04:00 reset,
 * 03:59 still belongs to yesterday's date.
 */
function shiftedNow(game: ResetGame, now: number): DateTime {
  return DateTime.fromMillis(now, { zone: game.tz }).minus({ hours: game.dailyResetHour });
}

/** Wall-clock `hour`:00 on the calendar day of `day` (DST-safe, unlike plus({hours})). */
function atHour(day: DateTime, hour: number): DateTime {
  return day.set({ hour, minute: 0, second: 0, millisecond: 0 });
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
  const m = s.day >= game.monthlyResetDay ? s : s.minus({ months: 1 });
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

export function nextMonthlyReset(game: ResetGame, now: number): number {
  const dt = DateTime.fromMillis(now, { zone: game.tz });
  const day = Math.min(28, Math.max(1, game.monthlyResetDay));
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
  // Start of the next period, un-shifted back to real time.
  return a
    .plus({ days: (idx + 1) * interval })
    .plus({ hours: game.dailyResetHour })
    .toMillis();
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
