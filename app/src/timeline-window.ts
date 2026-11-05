import { DateTime } from 'luxon';
import type { Game } from '@memoria/shared';
import { lastWeeklyReset, nextWeeklyReset } from '@memoria/shared';

/** The timeline shows one week back and three weeks ahead of today. */
export const TIMELINE_BACK_DAYS = 7;
export const TIMELINE_AHEAD_DAYS = 21;

/**
 * Whole local days: from midnight a week ago to the end of the 21st day ahead,
 * so every day on the ruler is a full day.
 */
export function timelineWindow(now: number, localTz: string): { start: number; end: number } {
  const today = DateTime.fromMillis(now, { zone: localTz }).startOf('day');
  return {
    start: today.minus({ days: TIMELINE_BACK_DAYS }).toMillis(),
    end: today.plus({ days: TIMELINE_AHEAD_DAYS + 1 }).toMillis(),
  };
}

type ResetGame = Pick<Game, 'tz' | 'dailyResetHour' | 'weeklyResetDay' | 'monthlyResetDay'>;

/**
 * Where the week lines go: the weekly reset most of the shown games share.
 *
 * Each game's resets are worked out in its own time zone, so daylight saving
 * moves a line only when it moves the reset. Games vote with their whole run of
 * resets in the window; a tie goes to the earlier run. With no games, the lines
 * fall back to Monday midnight in the player's zone.
 */
export function weekResetLines(games: readonly ResetGame[], start: number, end: number, localTz: string): number[] {
  const votes = new Map<string, { count: number; lines: number[] }>();
  for (const game of games) {
    const lines: number[] = [];
    try {
      let at = lastWeeklyReset(game, start);
      if (at < start) at = nextWeeklyReset(game, at);
      while (at <= end && lines.length < 10) {
        lines.push(at);
        at = nextWeeklyReset(game, at);
      }
    } catch {
      continue;
    }
    if (lines.length === 0) continue;
    const key = lines.join(',');
    const vote = votes.get(key);
    if (vote) vote.count += 1;
    else votes.set(key, { count: 1, lines });
  }
  let best: { count: number; lines: number[] } | undefined;
  for (const vote of votes.values()) {
    if (!best || vote.count > best.count || (vote.count === best.count && vote.lines[0]! < best.lines[0]!)) {
      best = vote;
    }
  }
  if (best) return best.lines;

  const lines: number[] = [];
  let monday = DateTime.fromMillis(start, { zone: localTz }).startOf('week');
  if (monday.toMillis() < start) monday = monday.plus({ weeks: 1 });
  while (monday.toMillis() <= end) {
    lines.push(monday.toMillis());
    monday = monday.plus({ weeks: 1 });
  }
  return lines;
}

/** The local midnights that begin each day in the window. */
export function timelineDays(start: number, end: number, localTz: string): DateTime[] {
  const days: DateTime[] = [];
  let day = DateTime.fromMillis(start, { zone: localTz }).startOf('day');
  while (day.toMillis() < end) {
    days.push(day);
    day = day.plus({ days: 1 });
  }
  return days;
}
