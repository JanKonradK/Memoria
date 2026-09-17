import { EventTags } from './EventTags';
import { useId, useMemo } from 'react';
import { DateTime } from 'luxon';
import type { Game, GameEvent } from '@memoria/shared';
import { gameTitleInk } from '../game-color';
import { useGround } from '../theme';
import { endTone, fmtDur } from '../util';
import { useIdentityColors } from './roster';
import { Btn, serverLabelClass } from './ui';
import { serverRegionLabel } from './NexusLayout';

/** Events grouped by status, with the nearest deadline first. */
export type TimelineListStatus = 'active' | 'upcoming' | 'finished';

interface Section {
  status: TimelineListStatus;
  title: string;
  events: GameEvent[];
}

const SECTION_TITLES: Record<TimelineListStatus, string> = {
  active: 'Active now',
  upcoming: 'Upcoming',
  finished: 'Finished',
};

/**
 * Finished means ticked off OR simply over — once an event ends there is nothing
 * left to act on. Same rule the lanes use, so the two views can never disagree
 * about which pile a row is in.
 */
export function timelineListStatus(event: Pick<GameEvent, 'done' | 'start' | 'end'>, now: number): TimelineListStatus {
  if (event.done || event.end <= now) return 'finished';
  return event.start > now ? 'upcoming' : 'active';
}

/**
 * Every comparison falls through to the name and then the id, so two events that
 * share a deadline hold their order between renders rather than swapping under
 * the cursor on the next tick.
 */
export function partitionTimelineEvents(
  events: readonly GameEvent[],
  now: number,
): Record<TimelineListStatus, GameEvent[]> {
  const buckets: Record<TimelineListStatus, GameEvent[]> = { active: [], upcoming: [], finished: [] };
  for (const event of events) buckets[timelineListStatus(event, now)].push(event);

  const settle = (a: GameEvent, b: GameEvent) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
  buckets.active.sort((a, b) => a.end - b.end || a.start - b.start || settle(a, b));
  buckets.upcoming.sort((a, b) => a.start - b.start || a.end - b.end || settle(a, b));
  buckets.finished.sort((a, b) => b.end - a.end || b.start - a.start || settle(a, b));
  return buckets;
}

/** The countdown, in the lanes' own words, with urgency owning the colour. */
function countdownOf(event: GameEvent, now: number): { label: string; tone: string } {
  if (event.done) return { label: 'done', tone: 'var(--color-ok)' };
  if (event.end <= now) return { label: 'ended', tone: endTone(0) };
  const upcoming = event.start > now;
  const remaining = upcoming ? event.start - now : event.end - now;
  return { label: `${upcoming ? 'arrives' : 'ends'} ${fmtDur(remaining)}`, tone: endTone(remaining) };
}

/** A window that opens and closes on one day says its date once. */
function scheduleLabel(event: GameEvent, localTz: string): string {
  const start = DateTime.fromMillis(event.start, { zone: localTz });
  const end = DateTime.fromMillis(event.end, { zone: localTz });
  return `${start.toFormat('d LLL HH:mm')} → ${end.toFormat(start.hasSame(end, 'day') ? 'HH:mm' : 'd LLL HH:mm')}`;
}

/**
 * Two accounts of one game carry the same name and the same events, so an
 * accessible name built from the event alone would produce two controls a screen
 * reader announces identically. The account is what tells them apart.
 */
function gameLabel(game: Game): string {
  const account = game.accountLabel?.trim();
  return account ? `${game.name} (${account})` : game.name;
}

/**
 * One template for the header and every row beneath it, so the columns actually
 * line up. Phone drops to two columns: the name and its countdown on the first
 * line, the dates and the controls on the second.
 */
const ROW_GRID =
  'grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 sm:grid-cols-[minmax(0,1fr)_12.5rem_6.5rem_6.5rem] sm:gap-x-4';
const COLUMN_LABEL = 'hidden text-label font-semibold uppercase tracking-wider text-dim sm:block';

export function TimelineList({
  games,
  events,
  now,
  localTz,
  showFinished,
  onOpenEvent,
  onToggleEvent,
}: {
  /** Already narrowed by the global game focus. */
  games: Game[];
  /** Already narrowed by search, deletion and the focused game's id set. */
  events: GameEvent[];
  now: number;
  localTz: string;
  showFinished: boolean;
  onOpenEvent: (event: GameEvent) => void;
  onToggleEvent: (event: GameEvent) => void;
}) {
  const ground = useGround();
  const headingId = useId();
  const identityColors = useIdentityColors(games);
  const gamesById = useMemo(() => new Map(games.map((game) => [game.id, game])), [games]);
  // Two accounts of one game can produce the same name+nickname, and then the
  // row controls need the server to tell them apart. Counted once for the whole
  // list rather than re-scanned per row.
  const labelCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const game of games) counts.set(gameLabel(game), (counts.get(gameLabel(game)) ?? 0) + 1);
    return counts;
  }, [games]);

  // An event whose game is filtered out has nothing to identify it on the row,
  // so it leaves with its game rather than appearing under a blank badge.
  const shown = useMemo(() => events.filter((event) => gamesById.has(event.gameId)), [events, gamesById]);
  const buckets = useMemo(() => partitionTimelineEvents(shown, now), [shown, now]);

  const sections: Section[] = (['active', 'upcoming', 'finished'] as const)
    .filter((status) => status !== 'finished' || showFinished)
    .map((status) => ({ status, title: SECTION_TITLES[status], events: buckets[status] }))
    .filter((section) => section.events.length > 0);

  const hiddenFinished = showFinished ? 0 : buckets.finished.length;

  return (
    <div data-tour="timeline" className="timeline-board relative">
      {sections.length === 0 ? (
        <p className="px-1 py-10 text-center text-body text-muted">
          {hiddenFinished > 0
            ? `Nothing running or arriving. ${hiddenFinished} finished ${
                hiddenFinished === 1 ? 'event is' : 'events are'
              } hidden — use the history control to show them, or Add → Event to add one.`
            : 'No events here yet. Use Add → Event to add one.'}
        </p>
      ) : (
        sections.map((section) => (
          <section key={section.status} aria-labelledby={`${headingId}-${section.status}`}>
            <div
              className={`${ROW_GRID} sticky top-0 z-20 items-baseline border-b border-line-hairline bg-surface-0 px-1 py-1.5`}
            >
              <h2
                id={`${headingId}-${section.status}`}
                className="flex items-baseline gap-2 text-label font-semibold uppercase tracking-wider text-muted"
              >
                {section.title} <span className="numeral text-caption text-dim">{section.events.length}</span>
              </h2>
              <span className={COLUMN_LABEL}>Schedule</span>
              <span className={COLUMN_LABEL}>Time left</span>
              <span className={COLUMN_LABEL}>Actions</span>
            </div>

            <ul>
              {section.events.map((event) => {
                const game = gamesById.get(event.gameId)!;
                const colors = identityColors[game.id] ?? game;
                const account = game.accountLabel?.trim();
                const serverLabel = serverRegionLabel(game.tz, now);
                const countdown = countdownOf(event, now);
                const baseLabel = gameLabel(game);
                const controlLabel =
                  (labelCounts.get(baseLabel) ?? 0) > 1 ? `${baseLabel} (${serverLabel})` : baseLabel;
                const finished = section.status === 'finished';

                return (
                  <li
                    key={event.id}
                    data-list-event={event.id}
                    className={`${ROW_GRID} items-start border-b border-line-hairline px-1 py-1.5 transition-colors duration-(--dur-fast) hover:bg-fill-1 motion-reduce:transition-none sm:items-center`}
                  >
                    <div className="col-start-1 row-start-1 min-w-0">
                      {/* The full name wraps rather than truncating: an event you
                          cannot read is an event you cannot pick out of the list. */}
                      <p className={`break-words text-body font-medium ${finished ? 'text-muted' : 'text-fg'}`}>
                        {event.name}
                      </p>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-muted">
                        <span className="font-semibold" style={{ color: gameTitleInk(colors, ground) }}>
                          {game.name}
                        </span>
                        {account && <span className="text-fg-soft">{account}</span>}
                        <EventTags game={game} event={event} />
                        <span className={`font-semibold text-fg-soft ${serverLabelClass(serverLabel)}`}>
                          {serverLabel}
                        </span>
                        <span className="capitalize">
                          {event.type === 'livestream' ? 'Special program' : event.type}
                        </span>
                      </div>
                    </div>

                    <div className="numeral col-start-1 row-start-2 mt-1 text-caption text-muted sm:col-start-2 sm:row-start-1 sm:mt-0 sm:text-meta">
                      <span className="sr-only">Runs </span>
                      {scheduleLabel(event, localTz)}
                    </div>

                    <div className="col-start-2 row-start-1 justify-self-end sm:col-start-3 sm:row-start-1 sm:justify-self-start">
                      <span className="numeral text-meta font-semibold" style={{ color: countdown.tone }}>
                        {countdown.label}
                      </span>
                    </div>

                    <div className="col-start-2 row-start-2 flex items-center justify-end gap-2 sm:col-start-4 sm:row-start-1">
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={Boolean(event.done)}
                        aria-label={`${event.done ? 'Restore' : 'Mark done'}: ${controlLabel} event ${event.name}`}
                        onClick={() => onToggleEvent(event)}
                        className="flex min-h-11 min-w-11 items-center justify-center rounded-ui-sm sm:min-h-9 sm:min-w-9"
                      >
                        <span
                          aria-hidden
                          className={`flex h-5 w-5 items-center justify-center rounded-ui-sm border text-caption font-black transition-colors duration-(--dur-fast) motion-reduce:transition-none ${
                            event.done
                              ? 'border-ok bg-ok text-fg-invert'
                              : 'border-line-strong text-transparent hover:bg-fill-2'
                          }`}
                        >
                          ✓
                        </span>
                      </button>
                      {/* The name above is text, not a second button aimed at the
                          same sheet. One row, one way to open it. */}
                      <Btn onClick={() => onOpenEvent(event)} aria-label={`Edit ${controlLabel} event: ${event.name}`}>
                        Edit
                      </Btn>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
