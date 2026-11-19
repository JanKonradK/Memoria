import { memo, useCallback, useMemo, useRef, useState, type CSSProperties } from 'react';
import { DateTime } from 'luxon';
import { isPredictedWindow, packSpans, type Game, type GameEvent } from '@memoria/shared';
import { Hint } from './Hint';
import { useApp } from '../store';
import { useElementWidth, useMediaQuery } from '../hooks';
import { useUI } from '../ui-store';
import { Pill } from './primitives';
import { rosterGames, useIdentityColors } from './roster';
import { Btn, Page, ServerChip, TOUCH_BUTTON } from './ui';
import { GameLogo } from './GameLogo';
import { RangeStepper, RangeSwitch, TimelineTools } from './TimelineTools';
import { CalendarToolbar } from './CalendarToolbar';
import { CalendarFeedStatus } from './CalendarFeedStatus';
import { CalendarBehindNote } from './CalendarBehind';
import { GameScope } from './GameScope';
import { TimelineList } from './TimelineList';
import { MonthView } from './calendar/MonthView';
import { SoonView } from './calendar/SoonView';
import { PageBar, PageBarEnd, PageTitle } from './shell/PageBar';
import { PinnedEvents } from './PinnedEvents';
import { PinMark } from './EventPeek';
import { gameServerLabel } from '../server-choice';
import { assignGameInks, legible } from '../game-color';
import { useGround } from '../theme';
import { EventTags } from './EventTags';
import { groupGameEvents } from '../event-category';
import { calendarSchedule } from '../event-schedule';
import {
  barCountdown,
  collapsedSummary,
  rangeWindow,
  timelineDays,
  type BarTone,
  type TimelineRangeKey,
} from '../timeline-window';
import '../timeline.css';
import '../pinned.css';

const HOUR = 3_600_000;
const MINUTE = 60_000;
/** The narrowest a bar is drawn, so a short update stays a bar and keeps its hit area. */
const MIN_BAR_PX = 28;
/** A bar narrower than this shows its name and leaves the countdown to screen readers. */
const COUNTDOWN_ROOM_PX = 96;
/** Clear space kept between two bars sharing a row. */
const ROW_GAP_PX = 1;
/** Rough caption-size glyph width, for reserving a milestone's label on its row. */
const LABEL_CHAR_PX = 7.2;
/** A game name longer than this gives way to its short name in the label column. */
const LONG_NAME = 20;
/** Leftward or rightward travel that counts as a swipe between weeks. */
const SWIPE_PX = 56;
/** Sideways wheel or trackpad travel that moves one week. */
const WHEEL_STEP_PX = 140;

const TONE: Record<BarTone, string> = {
  rose: 'var(--color-rose)',
  warn: 'var(--color-warn-fg)',
  muted: 'var(--color-muted)',
  ok: 'var(--color-ok-fg)',
};

/** Pausing keeps the account visible without exposing any of its event rows. */
function PausedTimelineGame({ game, now, onResume }: { game: Game; now: number; onResume: () => void }) {
  const ground = useGround();
  const server = gameServerLabel(game, now);
  const account = game.accountLabel?.trim();
  return (
    <section
      data-paused-game={game.id}
      aria-label={`${game.name}${account ? `, ${account}` : ''}, ${server}: tracking paused`}
      className="relative z-20 flex min-h-11 items-center gap-3 py-2"
    >
      <GameLogo game={game} size={36} />
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-body" style={{ color: legible(game.color, ground, 4.5) }}>
          {game.name}
        </h2>
        <div className="mt-1 flex min-w-0 items-center gap-2 text-caption text-muted">
          <ServerChip label={server} />
          {account && <span className="aside min-w-0 truncate">{account}</span>}
          <Pill variant="paused">Paused</Pill>
        </div>
      </div>
      <Btn
        className={`shrink-0 ${TOUCH_BUTTON}`}
        aria-label={`Resume tracking for ${game.name}${account ? `, ${account}` : ''}, ${server}`}
        onClick={onResume}
      >
        Resume
      </Btn>
    </section>
  );
}

/** Where a span sits on the track, as percentages, clipped to the range. */
function place(start: number, end: number, ws: number, we: number) {
  const span = we - ws;
  if (!(span > 0)) return { left: 0, width: 0 };
  const left = (Math.max(start, ws) - ws) / span;
  const right = (Math.min(end, we) - ws) / span;
  return { left: left * 100, width: Math.max(0, right - left) * 100 };
}

const pct = (value: number) => `${value.toFixed(3)}%`;

interface BoardProps {
  game: Game;
  ink: string;
  now: number;
  ws: number;
  we: number;
  trackPx: number;
  localTz: string;
  compact: boolean;
  onOpenEvent: (event: GameEvent) => void;
  onToggleEvent: (event: GameEvent) => void;
}

function scheduleText(ev: GameEvent, localTz: string): string {
  const calendar = calendarSchedule(ev);
  if (calendar) return calendar.description;
  const start = DateTime.fromMillis(ev.start, { zone: localTz });
  const end = DateTime.fromMillis(ev.end, { zone: localTz });
  return `Starts ${start.toFormat('d LLL yyyy HH:mm')}. Ends ${end.toFormat('d LLL yyyy HH:mm')}. Dates in ${localTz}.`;
}

/**
 * One event on its row. The whole bar opens the quick view; the tick inside it
 * appears under the pointer or keyboard focus and marks the event done.
 */
const TimelineBar = memo(function TimelineBar({
  ev,
  game,
  ink,
  now,
  ws,
  we,
  trackPx,
  localTz,
  compact,
  onOpenEvent,
  onToggleEvent,
}: BoardProps & { ev: GameEvent }) {
  const { left, width } = place(ev.start, ev.end, ws, we);
  const predicted = isPredictedWindow(ev);
  const stream = ev.type === 'livestream';
  const countdown = barCountdown(ev, now, we, localTz);
  const description = scheduleText(ev, localTz);
  const open = (
    <button
      type="button"
      className="tl-open"
      onClick={() => onOpenEvent(ev)}
      aria-label={`Open ${game.name} event: ${ev.name}`}
      aria-description={description}
      title={`${ev.name}. ${description}`}
    />
  );

  // A confirmed livestream is a moment, not a span: a diamond at its start.
  if (stream && !predicted) {
    return (
      <div
        data-event-id={ev.id}
        data-timeline-event-row
        className="tl-milestone"
        data-done={ev.done || undefined}
        style={{ left: pct(left), '--ink': ink } as CSSProperties}
      >
        {open}
        <span data-event-bar aria-hidden className="tl-diamond" />
        <span data-event-title className="tl-milestone-name">
          {ev.name}
        </span>
        <span data-event-countdown className="sr-only">
          {countdown.label}
        </span>
      </div>
    );
  }

  const barPx = (width / 100) * trackPx;
  const cutStart = ev.start < ws;
  const cutEnd = ev.end > we;
  return (
    <div
      data-event-id={ev.id}
      data-timeline-event-row
      className="tl-bar"
      data-done={ev.done || undefined}
      data-predicted={predicted || undefined}
      data-cut-start={cutStart || undefined}
      data-cut-end={cutEnd || undefined}
      style={
        {
          left: pct(left),
          width: `max(${pct(width)}, ${MIN_BAR_PX}px)`,
          '--ink': ink,
        } as CSSProperties
      }
    >
      {open}
      <span data-event-bar data-pinned={ev.pinned || undefined} className="tl-face">
        {!compact && (
          <button
            type="button"
            className="tl-tick"
            aria-label={ev.done ? `Restore ${ev.name}` : `Mark ${ev.name} done`}
            onClick={() => onToggleEvent(ev)}
          >
            {ev.done && (
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden>
                <path d="m4.5 10.5 3.5 3.5 7.5-8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </button>
        )}
        {predicted && stream && <span aria-hidden className="tl-diamond" />}
        <span className="tl-name">
          <EventTags game={game} event={ev} inherit availableWidth={barPx - 70} />
          {ev.type === 'cycle' && barPx > 160 && <span className="tl-tag">Cycle ·</span>}
          {ev.pinned && <PinMark className="h-3.5 w-3.5 shrink-0" />}
          <span data-event-title className="min-w-0 truncate">
            {ev.name.replace(/\s*—\s*predicted window/i, '')}
          </span>
        </span>
        {/* A phone shows the countdown only where it ends inside the week. A bar
            too short for both keeps its name; the countdown is still read out. */}
        {(!compact || (countdown.tone !== 'muted' && !cutEnd) || ev.done) && (
          <span
            data-event-countdown
            className={`tl-left numeral ${barPx > 0 && barPx < COUNTDOWN_ROOM_PX ? 'sr-only' : ''}`}
            style={{ '--tl-tone': TONE[countdown.tone] } as CSSProperties}
          >
            {predicted ? 'predicted' : countdown.label}
          </span>
        )}
      </span>
    </div>
  );
});

/** Maintenance: a hatched band down every row of its game. */
function MaintenanceBand({
  ev,
  game,
  ws,
  we,
  localTz,
  onOpenEvent,
}: {
  ev: GameEvent;
  game: Game;
  ws: number;
  we: number;
  localTz: string;
  onOpenEvent: (event: GameEvent) => void;
}) {
  const { left, width } = place(ev.start, ev.end, ws, we);
  return (
    <button
      type="button"
      data-event-id={ev.id}
      data-timeline-event-row
      className="tl-maint"
      style={{ left: pct(left), width: `max(${pct(width)}, 6px)` }}
      onClick={() => onOpenEvent(ev)}
      aria-label={`Open ${game.name} event: ${ev.name}`}
      aria-description={scheduleText(ev, localTz)}
      title={`${ev.name}. ${scheduleText(ev, localTz)}`}
    >
      <span data-event-bar aria-hidden />
    </button>
  );
}

type Row = { group: string; label?: string; events: GameEvent[] };

/**
 * Rows for one game: banners on rows of their own, everything else packed so
 * events that do not overlap share a row. Maintenance is not a row; it is
 * drawn across them.
 */
function packGame(game: Game, events: GameEvent[], ws: number, we: number, trackPx: number): Row[] {
  const msPerPx = trackPx > 0 ? (we - ws) / trackPx : 0;
  const reach = (ev: GameEvent) => {
    const minPx = ev.type === 'livestream' && !isPredictedWindow(ev) ? 24 + ev.name.length * LABEL_CHAR_PX : MIN_BAR_PX;
    return minPx * msPerPx;
  };
  const rows: Row[] = [];
  const rowEvents = events.filter((ev) => ev.type !== 'maintenance');
  // Genshin already splits by world with banners last; every game gets the banner rows.
  const groups = [
    ...groupGameEvents(
      game,
      rowEvents.filter((ev) => ev.type !== 'banner'),
    ),
    { key: 'banners', label: 'Banners', events: rowEvents.filter((ev) => ev.type === 'banner') },
  ];
  const byId = new Map(events.map((ev) => [ev.id, ev]));
  for (const group of groups) {
    if (group.events.length === 0) continue;
    const spans = group.events.map((ev) => {
      const start = Math.max(ev.start, ws);
      return { id: ev.id, start, end: Math.max(Math.min(ev.end, we), start + reach(ev)) };
    });
    packSpans(spans, 0, ROW_GAP_PX * msPerPx).forEach((packed, index) =>
      rows.push({
        group: group.key,
        label: index === 0 && group.key !== 'events' ? group.label : undefined,
        events: packed.map((span) => byId.get(span.id)!),
      }),
    );
  }
  return rows;
}

const TimelineLane = memo(function TimelineLane({
  game,
  ink,
  nameInk,
  events,
  finishedHidden,
  open,
  onOpenChange,
  ...board
}: BoardProps & {
  nameInk: string;
  /** Events this lane shows, already filtered for Show finished. */
  events: GameEvent[];
  /** Events in the range that Show finished is hiding. */
  finishedHidden: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { now, ws, we, trackPx, localTz, compact } = board;
  const server = gameServerLabel(game, now);
  const account = game.accountLabel?.trim();
  const countText = `${events.length} ${events.length === 1 ? 'event' : 'events'}`;
  const countLine = `${countText}${account ? ` · ${account}` : ''}`;
  const shownName = compact || game.name.length > LONG_NAME ? game.short || game.name : game.name;
  const rows = useMemo(() => packGame(game, events, ws, we, trackPx), [game, events, ws, we, trackPx]);
  const maintenance = events.filter((ev) => ev.type === 'maintenance');
  const contentId = `timeline-lane-${game.id}`;
  const summary = collapsedSummary(events, now, localTz, compact);
  const groups = rows.reduce<{ key: string; label: string; rows: Row[] }[]>((list, row) => {
    const last = list.at(-1);
    if (last?.key === row.group) last.rows.push(row);
    else list.push({ key: row.group, label: row.label ?? 'Events', rows: [row] });
    return list;
  }, []);

  return (
    <section
      id={`timeline-game-${game.id}`}
      className="tl-game"
      data-open={open || undefined}
      aria-label={`${game.name}${account ? `, ${account}` : ''}`}
      style={{ '--ink': ink } as CSSProperties}
    >
      <div className="tl-row tl-head">
        <h2 className="tl-label">
          <button
            type="button"
            className="tl-head-button"
            aria-expanded={open}
            aria-controls={contentId}
            onClick={() => onOpenChange(!open)}
          >
            <GameLogo game={game} size={compact ? 24 : 28} />
            <span className="tl-head-text">
              <span className="tl-head-name" style={{ color: nameInk }} title={game.name}>
                {shownName}
              </span>{' '}
              <span className="tl-head-count numeral">{countLine}</span>
              {/* The name is the words on screen, so a voice user can say what they see. */}
              <span className="sr-only">
                , {shownName === game.name ? '' : `${game.name}, `}
                {server}
              </span>
            </span>
            <svg
              className="tl-chevron"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="m5 8 5 5 5-5" />
            </svg>
          </button>
        </h2>
        {!compact && (
          <div className="tl-track" aria-hidden>
            {open &&
              maintenance.map((ev) => {
                const { left, width } = place(ev.start, ev.end, ws, we);
                const at = DateTime.fromMillis(ev.start, { zone: localTz });
                return (
                  <span key={ev.id} className="tl-maint-label" style={{ left: pct(left + width / 2) }}>
                    Maintenance {at.toFormat('ccc HH:mm')}
                  </span>
                );
              })}
          </div>
        )}
      </div>
      <div id={contentId} className="tl-content">
        <CalendarBehindNote gameId={game.id} now={now} className="tl-note" />
        {!open ? (
          <div className="tl-row tl-summary">
            <p className="tl-label tl-summary-text">{summary}</p>
            {!compact && (
              <div className="tl-track tl-density" aria-hidden>
                {rows.flatMap((row, index) =>
                  row.events.map((ev) => {
                    const { left, width } = place(ev.start, ev.end, ws, we);
                    return (
                      <i
                        key={ev.id}
                        style={{ left: pct(left), width: `max(${pct(width)}, 3px)`, top: (index % 4) * 5 + 6 }}
                      />
                    );
                  }),
                )}
              </div>
            )}
          </div>
        ) : events.length === 0 ? (
          <p className="tl-note text-label text-muted">
            {finishedHidden > 0 ? `Nothing running. ${finishedHidden} finished hidden.` : 'No events in this window.'}
          </p>
        ) : (
          <div className="tl-rows">
            {groups.map((group) => (
              <div
                key={group.key}
                role="group"
                data-timeline-event-group={group.key}
                aria-label={`${group.label} timeline for ${game.name}`}
              >
                {group.rows.map((row, index) => (
                  <div key={index} className="tl-row">
                    {!compact && <div className="tl-label tl-row-label">{row.label}</div>}
                    <div className="tl-track">
                      {row.events.map((ev) => (
                        <TimelineBar key={ev.id} ev={ev} game={game} ink={ink} {...board} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ))}
            {maintenance.length > 0 && (
              <div className="tl-bands">
                {maintenance.map((ev) => (
                  <MaintenanceBand
                    key={ev.id}
                    ev={ev}
                    game={game}
                    ws={ws}
                    we={we}
                    localTz={localTz}
                    onOpenEvent={board.onOpenEvent}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
});

/** The day ruler: weekday and date, today raised, months named where they begin. */
function Ruler({
  ws,
  we,
  now,
  localTz,
  trackPx,
  compact,
}: {
  ws: number;
  we: number;
  now: number;
  localTz: string;
  trackPx: number;
  compact: boolean;
}) {
  const days = timelineDays(ws, we, localTz);
  const dayPx = days.length > 0 ? trackPx / days.length : 0;
  const today = DateTime.fromMillis(now, { zone: localTz }).toISODate();
  const sparse = dayPx > 0 && dayPx < 24;
  return (
    <div className="tl-days" aria-hidden>
      {days.map((day, index) => {
        const isToday = day.toISODate() === today;
        const weekend = day.weekday >= 6;
        const { left, width } = place(day.toMillis(), day.plus({ days: 1 }).toMillis(), ws, we);
        const named = !sparse || isToday || day.weekday === 1;
        return (
          <span
            key={day.toMillis()}
            data-timeline-tick
            className="tl-day"
            data-today={isToday || undefined}
            data-weekend={weekend || undefined}
            style={{ left: pct(left), width: pct(width) }}
          >
            {(index === 0 || day.day === 1) && <span className="tl-month">{day.toFormat('LLL')}</span>}
            {named && !sparse && (
              <span className="tl-weekday">{compact ? day.toFormat('ccc') : day.toFormat('ccccc')}</span>
            )}
            {named && <b className="numeral">{day.day}</b>}
          </span>
        );
      })}
    </div>
  );
}

export function TimelinePage({ now }: { now: number }) {
  const state = useApp((s) => s.state);
  const upsertEvent = useApp((s) => s.upsertEvent);
  const updateGame = useApp((s) => s.updateGame);
  const openSheet = useUI((s) => s.openSheet);
  const ground = useGround();
  const localTz = state.settings.localTz;
  const [trackRef, trackPx] = useElementWidth();
  const view = useUI((s) => s.timelineView) ?? 'lanes';
  const compact = useMediaQuery('(max-width: 767px)');
  const showFinished = useUI((s) => s.timelineShowFinished);
  const setShowFinished = useUI((s) => s.setTimelineShowFinished);
  const hidden = useUI((s) => s.timelineHiddenGameIds);
  const chosenRange = useUI((s) => s.timelineRange);
  const setRange = useUI((s) => s.setTimelineRange);
  const range: TimelineRangeKey = chosenRange ?? (compact ? 'week' : 'month');
  const [weeks, setWeeks] = useState(0);
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Ticked here, so they stay on their row, faded, until the page is left.
  const [justDone, setJustDone] = useState<ReadonlySet<string>>(new Set());

  const peekEvent = useCallback((event: GameEvent) => openSheet({ kind: 'eventPeek', eventId: event.id }), [openSheet]);
  const toggleEvent = useCallback(
    (event: GameEvent) => {
      if (!event.done) setJustDone((current) => new Set(current).add(event.id));
      upsertEvent({ id: event.id, gameId: event.gameId, done: !event.done });
    },
    [upsertEvent],
  );

  // The grid is rebuilt on the hour; countdowns and the now line move each minute.
  const hourBucket = Math.floor(now / HOUR);
  const minuteNow = Math.floor(now / MINUTE) * MINUTE;
  const { start: ws, end: we } = useMemo(
    () => rangeWindow(hourBucket * HOUR, localTz, range, weeks),
    [hourBucket, localTz, range, weeks],
  );
  const games = useMemo(
    () => rosterGames(state.games).filter((game) => !hidden.includes(game.id)),
    [state.games, hidden],
  );
  const { events, eventsByGame } = useMemo(() => {
    const live = state.events.filter((event) => !event.deleted);
    const open = new Set(games.filter((game) => !game.paused).map((game) => game.id));
    const byGame = new Map<string, GameEvent[]>();
    for (const event of live) {
      if (!open.has(event.gameId) || event.end <= ws || event.start >= we) continue;
      const list = byGame.get(event.gameId) ?? [];
      list.push(event);
      byGame.set(event.gameId, list);
    }
    // The undeleted set the other views show, so every view counts the same events.
    return { events: live.filter((event) => open.has(event.gameId)), eventsByGame: byGame };
  }, [state.events, games, ws, we]);

  const laneInk = useMemo(() => assignGameInks(games, ground), [games, ground]);
  const identityColors = useIdentityColors(state.games);
  const isShown = useCallback(
    (event: GameEvent) => showFinished || (event.end > minuteNow && (!event.done || justDone.has(event.id))),
    [showFinished, minuteNow, justDone],
  );

  const [laneOpen, setLaneOpen] = useState<Record<string, boolean>>({});
  const resumeGame = (id: string) => {
    setLaneOpen((current) => ({ ...current, [id]: true }));
    updateGame(id, { paused: false });
    requestAnimationFrame(() => {
      const lane = document.getElementById(`timeline-game-${id}`);
      const row = [...document.querySelectorAll<HTMLElement>('[data-list-game]')].find(
        (node) => node.dataset.listGame === id,
      );
      const control =
        lane?.querySelector<HTMLButtonElement>('h2 button') ?? row?.querySelector<HTMLButtonElement>('.cal-row-main');
      (control ?? document.querySelector<HTMLElement>('.timeline-page h1'))?.focus();
    });
  };

  const pausedGames = games.filter((game) => game.paused);
  const shownGames = games.filter((game) => !game.paused);
  const scopedEvents = view === 'lanes' ? [...eventsByGame.values()].flat() : events;
  const visibleCount = scopedEvents.filter(
    view === 'lanes' ? isShown : (event) => showFinished || (!event.done && event.end > now),
  ).length;
  const pausedRows = pausedGames.length > 0 && (
    <div className="mt-4 divide-y divide-line-hairline border-t border-line-edge">
      {pausedGames.map((game) => (
        <PausedTimelineGame
          key={game.id}
          game={{ ...game, ...identityColors[game.id] }}
          now={now}
          onResume={() => resumeGame(game.id)}
        />
      ))}
    </div>
  );

  const first = DateTime.fromMillis(ws, { zone: localTz });
  const last = DateTime.fromMillis(we - 1, { zone: localTz });
  const rangeLabel =
    first.month === last.month
      ? `${first.toFormat('d')}–${last.toFormat('d LLL')}`
      : `${first.toFormat('d LLL')} – ${last.toFormat('d LLL')}`;
  const step = useCallback((by: number) => setWeeks((current) => current + by), []);
  const nowInView = minuteNow >= ws && minuteNow < we;
  const lanes = view === 'lanes';

  // A phone swipes between weeks; a trackpad's sideways scroll does the same.
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const wheel = useRef({ dx: 0, at: 0 });

  const addButton = (
    <Btn
      className={`inline-flex items-center gap-1.5 ${TOUCH_BUTTON}`}
      aria-label="Add an event"
      onClick={() => openSheet({ kind: 'event' })}
    >
      <svg
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        className="icon h-4 w-4"
        aria-hidden
      >
        <path d="M10 4v12M4 10h12" />
      </svg>
      {!compact && 'Event'}
    </Btn>
  );

  const nowLeft = place(ws, minuteNow, ws, we).width;

  return (
    <Page className="timeline-page">
      <PageBar className="calendar-bar">
        <PageTitle>Calendar</PageTitle>
        {compact ? (
          <PageBarEnd>
            <button
              type="button"
              className="calendar-tool"
              data-icon-only
              aria-label="Choose games"
              aria-expanded={filtersOpen}
              aria-controls="calendar-game-filter"
              onClick={() => setFiltersOpen((open) => !open)}
            >
              <svg
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                className="icon h-5 w-5"
                aria-hidden
              >
                <path d="M3.5 5.5h13M6 10h8M8.5 14.5h3" />
              </svg>
            </button>
            {addButton}
          </PageBarEnd>
        ) : null}
        <CalendarToolbar view={view} />
        {compact ? (
          filtersOpen && <GameScope id="calendar-game-filter" className="calendar-games-panel" />
        ) : (
          <>
            <GameScope />
            <span className="calendar-bar-gap" aria-hidden />
            {lanes && <RangeSwitch range={range} onRange={setRange} />}
            {lanes && (
              <RangeStepper label={rangeLabel} onStep={step} onToday={() => setWeeks(0)} atToday={weeks === 0} />
            )}
            <TimelineTools showFinished={showFinished} onShowFinished={setShowFinished} />
            {addButton}
          </>
        )}
      </PageBar>
      <div className="timeline-caption flex flex-wrap items-center gap-x-3 gap-y-2 text-meta text-muted">
        <span>
          {visibleCount} {visibleCount === 1 ? 'event' : 'events'}
        </span>
        <CalendarFeedStatus />
        {pausedGames.length > 0 && <span>{pausedGames.length} paused</span>}
        {compact && (
          <span className="calendar-caption-tools">
            {lanes && <span className="numeral text-fg-soft">{rangeLabel}</span>}
            {lanes && (
              <RangeStepper label={rangeLabel} onStep={step} onToday={() => setWeeks(0)} atToday={weeks === 0} />
            )}
            <TimelineTools compact showFinished={showFinished} onShowFinished={setShowFinished} />
          </span>
        )}
      </div>

      <Hint id="events" className="mt-3" />
      <PinnedEvents events={events} games={games} now={now} onOpen={peekEvent} />

      {games.length > 0 && games.every((game) => game.paused) ? null : view === 'month' ? (
        <MonthView
          games={games}
          events={events}
          now={now}
          localTz={state.settings.localTz}
          showFinished={showFinished}
          onOpenEvent={peekEvent}
          onToggleEvent={toggleEvent}
        />
      ) : view === 'soon' ? (
        <SoonView
          games={games}
          events={events}
          now={now}
          localTz={state.settings.localTz}
          showFinished={showFinished}
          onOpenEvent={peekEvent}
          onToggleEvent={toggleEvent}
        />
      ) : view === 'agenda' ? (
        <TimelineList
          games={games}
          events={events}
          now={now}
          localTz={localTz}
          showFinished={showFinished}
          onOpenEvent={peekEvent}
          onToggleEvent={toggleEvent}
        />
      ) : (
        <div
          className="timeline-board tl-board"
          data-compact={compact || undefined}
          data-range={range}
          onTouchStart={(e) => {
            const touch = e.touches[0];
            swipe.current = touch && e.touches.length === 1 ? { x: touch.clientX, y: touch.clientY } : null;
          }}
          onTouchEnd={(e) => {
            const start = swipe.current;
            const touch = e.changedTouches[0];
            swipe.current = null;
            if (!start || !touch) return;
            const dx = touch.clientX - start.x;
            const dy = touch.clientY - start.y;
            if (Math.abs(dx) >= SWIPE_PX && Math.abs(dx) > Math.abs(dy) * 1.5) step(dx < 0 ? 1 : -1);
          }}
          onWheel={(e) => {
            if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
            const state = wheel.current;
            if (e.timeStamp - state.at > 400) state.dx = 0;
            state.at = e.timeStamp;
            state.dx += e.deltaX;
            if (Math.abs(state.dx) < WHEEL_STEP_PX) return;
            step(state.dx > 0 ? 1 : -1);
            state.dx = 0;
          }}
        >
          <div className="tl-ruler" data-timeline-ruler>
            {!compact && <div className="tl-label" />}
            <div ref={trackRef} data-timeline-scale className="tl-track">
              <Ruler ws={ws} we={we} now={minuteNow} localTz={localTz} trackPx={trackPx} compact={compact} />
            </div>
          </div>
          <div className="tl-body">
            <div className="tl-overlay" aria-hidden>
              {timelineDays(ws, we, localTz)
                .filter((day) => day.weekday >= 6)
                .map((day) => {
                  const { left, width } = place(day.toMillis(), day.plus({ days: 1 }).toMillis(), ws, we);
                  return (
                    <span key={day.toMillis()} className="tl-weekend" style={{ left: pct(left), width: pct(width) }} />
                  );
                })}
              {nowInView && <span data-timeline-now className="tl-now" style={{ left: pct(nowLeft) }} />}
            </div>
            {shownGames.length === 0 && pausedGames.length === 0 && (
              <p className="py-8 text-center text-body text-dim">No events.</p>
            )}
            {shownGames.map((game) => {
              const colors = identityColors[game.id] ?? game;
              const inRange = eventsByGame.get(game.id) ?? [];
              const shown = inRange.filter(isShown);
              const ink = laneInk[game.id] ?? colors.color;
              return (
                <TimelineLane
                  key={game.id}
                  game={{ ...game, ...colors }}
                  ink={ink}
                  nameInk={legible(ink, ground, 4.5)}
                  events={shown}
                  finishedHidden={inRange.length - shown.length}
                  open={laneOpen[game.id] ?? inRange.length > 0}
                  onOpenChange={(open) => setLaneOpen((current) => ({ ...current, [game.id]: open }))}
                  now={minuteNow}
                  ws={ws}
                  we={we}
                  trackPx={trackPx}
                  localTz={localTz}
                  compact={compact}
                  onOpenEvent={peekEvent}
                  onToggleEvent={toggleEvent}
                />
              );
            })}
          </div>
          {compact && (
            <p className="tl-hint text-caption text-muted">
              Swipe sideways to move through the weeks. Tap a bar to see it or tick it done.
            </p>
          )}
          {!compact && (
            <div className="tl-legend text-caption text-muted" aria-hidden>
              <span>
                <i className="tl-legend-tick" />
                Hover a bar to tick it done
              </span>
              <span>
                <i className="tl-diamond" />
                Livestream
              </span>
              <span>
                <i className="tl-legend-predicted" />
                Predicted
              </span>
              <span>
                <i className="tl-legend-maint" />
                Maintenance
              </span>
              <span>Dashed end: runs past the range</span>
            </div>
          )}
          {pausedRows}
        </div>
      )}
      {(view !== 'lanes' || games.every((game) => game.paused)) && pausedRows}
    </Page>
  );
}
