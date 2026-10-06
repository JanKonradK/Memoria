import { EventTags } from './EventTags';
import { calendarSchedule } from '../event-schedule';
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
  const calendar = calendarSchedule(event);
  if (calendar) return { label: calendar.label, tone: 'var(--color-muted)' };
  const upcoming = event.start > now;
  const remaining = upcoming ? event.start - now : event.end - now;
  return { label: `${upcoming ? 'arrives' : 'ends'} ${fmtDur(remaining)}`, tone: endTone(remaining) };
}

/** Explicit endpoints stay readable when a window crosses a day or year. */
function EventSchedule({ event, localTz, now }: { event: GameEvent; localTz: string; now: number }) {
  const calendar = calendarSchedule(event);
  if (calendar)
    return (
      <div className="timeline-event-schedule text-caption text-muted" title={calendar.description}>
        <span>{calendar.label}</span>
        <span>{calendar.zone}</span>
      </div>
    );
  const start = DateTime.fromMillis(event.start, { zone: localTz });
  const end = DateTime.fromMillis(event.end, { zone: localTz });
  const currentYear = DateTime.fromMillis(now, { zone: localTz }).year;
  const showYear = start.year !== end.year || start.year !== currentYear || end.year !== currentYear;
  const format = showYear ? 'd LLL yyyy HH:mm' : 'd LLL HH:mm';
  return (
    <div className="timeline-event-schedule text-caption text-muted">
      <span className="timeline-schedule-endpoint">
        <span>Starts</span>
        <time dateTime={start.toISO() ?? undefined}>{start.toFormat(format)}</time>
      </span>
      <span className="timeline-schedule-endpoint">
        <span>Ends</span>
        <time dateTime={end.toISO() ?? undefined}>{end.toFormat(format)}</time>
      </span>
    </div>
  );
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
const ROW_GRID = 'timeline-list-grid';
const COLUMN_LABEL = 'timeline-column-label';

export function TimelineList({
  games,
  events,
  now,
  localTz,
  showFinished,
  search = '',
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
  search?: string;
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
  const shown = useMemo(
    () =>
      events.filter((event) => {
        const game = gamesById.get(event.gameId);
        return game && !game.paused;
      }),
    [events, gamesById],
  );
  const buckets = useMemo(() => partitionTimelineEvents(shown, now), [shown, now]);

  const sections: Section[] = (['active', 'upcoming', 'finished'] as const)
    .filter((status) => status !== 'finished' || showFinished)
    .map((status) => ({ status, title: SECTION_TITLES[status], events: buckets[status] }))
    .filter((section) => section.events.length > 0);

  const hiddenFinished = showFinished ? 0 : buckets.finished.length;

  return (
    <div data-tour="timeline" className="timeline-board timeline-list-board relative">
      {sections.length === 0 ? (
        <p className="timeline-empty text-center text-body text-muted">
          {games.length > 0 && games.every((game) => game.paused)
            ? 'Events are hidden while tracking is paused.'
            : hiddenFinished > 0
              ? `Nothing running or arriving. ${hiddenFinished} finished ${
                  hiddenFinished === 1 ? 'event is' : 'events are'
                } hidden — use Show finished events to see them.`
              : search
                ? `No events match “${search}”. Clear the search to see all events.`
                : 'No events here yet. Use Add → Event to add one.'}
        </p>
      ) : (
        sections.map((section) => (
          <section
            key={section.status}
            data-event-status={section.status}
            className="timeline-list-section"
            aria-labelledby={`${headingId}-${section.status}`}
          >
            <div className={`${ROW_GRID} timeline-list-heading`}>
              <h2
                id={`${headingId}-${section.status}`}
                className="flex items-center gap-2.5 text-body font-semibold text-fg-soft"
              >
                {section.title} <span className="timeline-section-count tabular-nums">{section.events.length}</span>
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
                    data-list-game={game.id}
                    className={`${ROW_GRID} timeline-event-row transition-colors duration-(--dur-fast) motion-reduce:transition-none`}
                  >
                    <div className="timeline-event-identity min-w-0">
                      {/* The full name wraps rather than truncating: an event you
                          cannot read is an event you cannot pick out of the list. */}
                      <p
                        className={`timeline-event-name break-words text-body font-medium ${finished ? 'text-muted' : 'text-fg'}`}
                      >
                        {event.name}
                      </p>
                      <div className="timeline-event-metadata flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-muted">
                        <span className="font-semibold" style={{ color: gameTitleInk(colors, ground, 5.2) }}>
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

                    <EventSchedule event={event} localTz={localTz} now={now} />

                    <div className="timeline-event-deadline">
                      <span
                        className="timeline-countdown tabular-nums text-meta font-semibold"
                        style={{ color: countdown.tone }}
                      >
                        {countdown.label}
                      </span>
                    </div>

                    <div className="timeline-event-actions flex items-center justify-end gap-2">
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={Boolean(event.done)}
                        aria-label={`${event.done ? 'Completed — Restore' : 'Mark done'}: ${controlLabel} event ${event.name}`}
                        onClick={() => onToggleEvent(event)}
                        className="timeline-complete-control flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-ui-md px-3 text-meta font-medium text-fg-soft sm:min-h-9 sm:min-w-9"
                      >
                        <span
                          aria-hidden
                          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-ui-sm border text-caption font-black transition-colors duration-(--dur-fast) motion-reduce:transition-none ${
                            event.done
                              ? 'border-ok bg-ok text-fg-invert'
                              : 'border-line-strong text-transparent hover:bg-fill-2'
                          }`}
                        >
                          ✓
                        </span>
                        <span className="whitespace-nowrap">{event.done ? 'Completed' : 'Mark done'}</span>
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
