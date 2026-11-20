import { DateTime } from 'luxon';
import { hasQuietHours } from './quiet';
import type { Settings } from './types';

/**
 * An event that ends in the small hours is over before the player wakes, so its
 * last day is the day before. A 04:00 Tuesday end is a Monday-night deadline:
 * someone up at 08:00 on Tuesday has already missed it.
 */

/** Without quiet hours, an end before 09:00 belongs to the night before. */
export const MORNING_MINUTES = 9 * 60;

/** The latest a morning can be: past noon, an end is that day's. */
const LATEST_MORNING = 12 * 60;

/**
 * Minutes after midnight, in home time, when the player's day begins: the end
 * of their quiet hours when they set them, else 09:00.
 */
export function morningOf(settings: Pick<Settings, 'quietStart' | 'quietEnd' | 'localTz'>): number {
  if (!hasQuietHours(settings)) return MORNING_MINUTES;
  const end = settings.quietEnd!;
  return end > 0 && end <= LATEST_MORNING ? end : MORNING_MINUTES;
}

/** Minutes into its home-time day that `at` falls, and that day's midnight. */
function clockOf(at: number, tz: string): { minute: number; midnight: number } {
  const time = DateTime.fromMillis(at, { zone: tz });
  if (!time.isValid) return { minute: LATEST_MORNING, midnight: at };
  return { minute: time.hour * 60 + time.minute, midnight: time.startOf('day').toMillis() };
}

/** True when `end` falls after midnight and before the morning, so its last day is the one before. */
export function endsOvernight(end: number, tz: string, morning = MORNING_MINUTES): boolean {
  const { minute, midnight } = clockOf(end, tz);
  return end > midnight && minute < morning;
}

/**
 * When the last day the player can play an event ends: the midnight before an
 * end that falls overnight, else the end itself.
 */
export function playEnd(end: number, tz: string, morning = MORNING_MINUTES): number {
  return endsOvernight(end, tz, morning) ? clockOf(end, tz).midnight : end;
}

/**
 * The end to draw and to sort by day. It is the play end until that midnight
 * has passed; a player still up past it sees the real end, since the event
 * is still running.
 */
export function shownEnd(end: number, now: number, tz: string, morning = MORNING_MINUTES): number {
  const last = playEnd(end, tz, morning);
  return now >= last ? end : last;
}

/** Midnight of the player's last day for an event ending at `end`: never before today. */
export function lastPlayDay(end: number, now: number, tz: string, morning = MORNING_MINUTES): DateTime {
  const day = DateTime.fromMillis(shownEnd(end, now, tz, morning) - 1, { zone: tz }).startOf('day');
  const today = DateTime.fromMillis(now, { zone: tz }).startOf('day');
  return day < today ? today : day;
}
