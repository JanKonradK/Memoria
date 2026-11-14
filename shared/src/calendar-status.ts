import type { GameEvent } from './types';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export interface CalendarBehind {
  gameId: string;
  /** The version whose update has gone live without new rows, e.g. "4.7"; null when the calendar is simply empty. */
  version: string | null;
  /** When that version went live, or now for an empty calendar. */
  since: number;
}

/** Rows that say what is on: banners and events. Endgame cycles repeat on their own and prove nothing. */
const CONTENT = new Set<GameEvent['type']>(['banner', 'event']);

/** "v4.7 update maintenance" → "4.7". */
export function versionOf(name: string): string | null {
  return /\bv?(\d+\.\d+)\b/i.exec(name)?.[1] ?? null;
}

/**
 * Says when a game's calendar is behind, instead of letting missing data look
 * like a quiet week. Only games that have ever had calendar rows from the feed
 * are checked; a player's own game with no feed has nothing to be behind.
 *
 * Behind means either a version update has gone live and no banner or event
 * starts from it, or nothing is running and nothing starts within a week.
 */
export function calendarBehind(events: GameEvent[], gameId: string, now: number): CalendarBehind | null {
  const rows = events.filter((event) => event.gameId === gameId && !event.deleted);
  if (!rows.some((event) => event.sourceKey)) return null;
  const content = rows.filter((event) => CONTENT.has(event.type));

  const update = rows
    .filter((event) => event.type === 'maintenance' && event.start <= now && versionOf(event.name))
    .sort((a, b) => b.start - a.start)[0];
  // Rows for a new version start when its maintenance does, give or take the
  // time zones the publishers announce in.
  if (update && !content.some((event) => event.start >= update.start - 12 * HOUR))
    return { gameId, version: versionOf(update.name), since: update.start };

  const running = content.some((event) => event.start <= now && event.end > now);
  const coming = content.some((event) => event.start > now && event.start <= now + 7 * DAY);
  if (!running && !coming) return { gameId, version: null, since: now };
  return null;
}
