import { DateTime } from 'luxon';
import { dailyPeriodKey } from './periods';
import { effectiveCountTarget, effectiveTaskMode } from './tracking';
import type { AppState, Completion, Task } from './types';

/**
 * Daily streaks, derived from the completion rows the checklist already writes
 * (`D2026-11-26` period keys). Nothing new is stored, so every device that has
 * the rows agrees, and the streak can only reach back as far as completions are
 * kept (see `COMPLETION_RETENTION_MS`).
 *
 * A game day counts when every live daily task of the game is done for it: a
 * plain or timer task by its tick, a counter by reaching its target. Today never
 * breaks a streak while it is still open; it adds to it once its dailies are done.
 */

export interface GameStreak {
  gameId: string;
  /** Game days in a row with every daily done, ending today when today is done, else yesterday. */
  current: number;
  /** The longest run in the kept completions. */
  best: number;
  /** Today's dailies are all done. */
  today: boolean;
}

export interface StreakSummary {
  /** Games with dailies, longest current streak first. */
  games: GameStreak[];
  /** Days in a row on which at least one game had every daily done. */
  current: number;
  best: number;
}

/** Further back than completions are ever kept: the walk stops long before this. */
const MAX_DAYS = 400;

/** `D2026-11-26` → `2026-11-26`; anything that is not a daily key → null. */
function dayOf(periodKey: string): string | null {
  return /^D\d{4}-\d{2}-\d{2}$/.test(periodKey) ? periodKey.slice(1) : null;
}

function previousDay(day: string): string {
  return DateTime.fromISO(day, { zone: 'utc' }).minus({ days: 1 }).toISODate() ?? '';
}

function isDone(task: Task, row: Completion | undefined): boolean {
  if (!row) return false;
  if (effectiveTaskMode(task) === 'count')
    return row.countDone == null ? row.done : row.countDone >= effectiveCountTarget(task);
  return row.done;
}

/**
 * The run of `days` ending at `today`. While `today` is open (`skipToday`) the
 * run ends the day before instead, so an unfinished today never breaks it.
 */
function runEndingAt(days: ReadonlySet<string>, today: string, skip: ReadonlySet<string>): number {
  let day = today;
  let count = 0;
  for (let step = 0; step < MAX_DAYS && day; step++, day = previousDay(day)) {
    if (days.has(day)) count++;
    else if (!skip.has(day)) break;
  }
  return count;
}

/** The longest run of consecutive days. */
function longestRun(days: ReadonlySet<string>): number {
  let best = 0;
  for (const day of days) {
    // Only start counting at the first day of a run.
    if (days.has(previousDay(day))) continue;
    let length = 0;
    let cursor = DateTime.fromISO(day, { zone: 'utc' });
    while (length < MAX_DAYS && days.has(cursor.toISODate() ?? '')) {
      length++;
      cursor = cursor.plus({ days: 1 });
    }
    best = Math.max(best, length);
  }
  return best;
}

/** Per game and overall daily streaks at `now`. Paused and deleted games, and games without dailies, are left out. */
export function dailyStreaks(state: Pick<AppState, 'games' | 'tasks' | 'completions'>, now: number): StreakSummary {
  const dailiesByGame = new Map<string, Task[]>();
  for (const task of state.tasks) {
    if (task.deleted || task.cadence !== 'daily') continue;
    const list = dailiesByGame.get(task.gameId) ?? [];
    list.push(task);
    dailiesByGame.set(task.gameId, list);
  }
  // Live rows by task, then by day. The first live row for an id wins, as in the checklist index.
  const rowsByTask = new Map<string, Map<string, Completion>>();
  const firstDay = new Map<string, string>();
  for (const row of state.completions) {
    if (row.deleted) continue;
    const day = dayOf(row.periodKey);
    if (!day) continue;
    const byDay = rowsByTask.get(row.taskId) ?? new Map<string, Completion>();
    if (!byDay.has(day)) byDay.set(day, row);
    rowsByTask.set(row.taskId, byDay);
    const earliest = firstDay.get(row.taskId);
    if (!earliest || day < earliest) firstDay.set(row.taskId, day);
  }

  const games: GameStreak[] = [];
  const anyGameDays = new Set<string>();
  const openTodays = new Set<string>();
  let latestToday = '';
  for (const game of state.games) {
    if (game.deleted || game.paused) continue;
    const dailies = dailiesByGame.get(game.id);
    if (!dailies?.length) continue;
    const today = dayOf(dailyPeriodKey(game, now));
    if (!today) continue;
    const candidates = new Set<string>();
    for (const task of dailies) {
      for (const day of rowsByTask.get(task.id)?.keys() ?? []) {
        if (day <= today) candidates.add(day);
      }
    }
    const complete = new Set<string>();
    for (const day of candidates) {
      if (day === today) {
        if (dailies.every((task) => isDone(task, rowsByTask.get(task.id)?.get(today)))) complete.add(today);
        continue;
      }
      // Without task creation dates, treat a daily added later as starting on its first live row
      // so adding a new daily never erases prior complete days.
      const existed = dailies.filter((task) => {
        const first = firstDay.get(task.id);
        return first !== undefined && first <= day;
      });
      if (existed.length > 0 && existed.every((task) => isDone(task, rowsByTask.get(task.id)?.get(day)))) {
        complete.add(day);
      }
    }
    const todayDone = complete.has(today);
    if (!todayDone) openTodays.add(today);
    if (today > latestToday) latestToday = today;
    for (const day of complete) anyGameDays.add(day);
    games.push({
      gameId: game.id,
      current: runEndingAt(complete, today, new Set([today])),
      best: longestRun(complete),
      today: todayDone,
    });
  }
  games.sort((a, b) => b.current - a.current || b.best - a.best);
  const overallCurrent = latestToday ? runEndingAt(anyGameDays, latestToday, openTodays) : 0;
  return {
    games,
    current: overallCurrent,
    best: Math.max(longestRun(anyGameDays), overallCurrent),
  };
}
