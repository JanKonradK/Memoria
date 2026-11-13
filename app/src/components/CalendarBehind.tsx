import { DateTime } from 'luxon';
import { calendarBehind, type AppState, type CalendarBehind, type Game } from '@memoria/shared';
import { SEED_UPDATED } from '../data/seed-feed';
import { useApp } from '../store';

/** The date of the newest calendar this device has, as "4 Nov". */
export function useFeedDate(): string {
  const published = useApp((s) => s.state.settings.remoteFeedVersion?.seedUpdated);
  const date = published && published >= SEED_UPDATED ? published : SEED_UPDATED;
  const parsed = DateTime.fromISO(date);
  return parsed.isValid ? parsed.toFormat('d LLL') : date;
}

export function behindText(behind: CalendarBehind, feedDate: string): string {
  return behind.version
    ? `Calendar not updated for version ${behind.version} yet · feed from ${feedDate}`
    : `No events in the calendar right now; it may be behind · feed from ${feedDate}`;
}

/** The games whose calendar is behind, in roster order. */
export function behindGames(state: AppState, now: number): Array<{ game: Game; behind: CalendarBehind }> {
  return state.games
    .filter((game) => !game.deleted && !game.paused)
    .sort((a, b) => a.sort - b.sort)
    .flatMap((game) => {
      const behind = calendarBehind(state.events, game.id, now);
      return behind ? [{ game, behind }] : [];
    });
}

/** One plain line, so missing data does not pass for a quiet week. */
export function CalendarBehindNote({
  gameId,
  now,
  className = '',
}: {
  gameId: string;
  now: number;
  className?: string;
}) {
  const events = useApp((s) => s.state.events);
  const feedDate = useFeedDate();
  const behind = calendarBehind(events, gameId, now);
  if (!behind) return null;
  return (
    <p className={`calendar-behind text-meta text-warn-fg ${className}`} data-calendar-behind={gameId}>
      {behindText(behind, feedDate)}
    </p>
  );
}
