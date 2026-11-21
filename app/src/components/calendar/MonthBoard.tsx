import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { DateTime } from 'luxon';
import {
  dayDigest,
  dayKey,
  foldMoments,
  isWork,
  lastPlayDay,
  monthWeeks,
  type CalendarMoment,
  type Game,
  type GameEvent,
} from '@memoria/shared';
import { endTone } from '../../util';
import { SwipeRow } from '../../swipe-row';
import { Btn, TOUCH_BUTTON } from '../ui';
import type { CalendarViewProps } from './types';
import {
  EventKind,
  MomentMark,
  MomentText,
  MomentTick,
  NightMark,
  clock,
  momentSwipes,
  shortLeft,
  useCalendarGames,
  type CalendarGames,
} from './parts';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const KEY_STEPS: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
/** Names a cell lists before it counts the rest. */
const CELL_NAMES = 3;
/** Rows of Still running before the rest fold away. */
const RUNNING_SHOWN = 6;

interface DayCell {
  /** What ends on the day (its last playable day), soonest first. */
  ends: GameEvent[];
  starts: GameEvent[];
  down: boolean;
  live?: GameEvent;
}

/**
 * A month of deadlines, Monday first. Each day lists what ends on it (its last
 * playable day, so a 04:00 end is the night before), names first and the rest
 * counted, with what starts as dots underneath. A day's ground warms with how
 * much unfinished work ends on it, so the busy days stand out. Choosing a day
 * fills the panel: what ends, what starts, what else happens, and what is still
 * running that could be done on it. On a phone the names become dots.
 */
export function MonthBoard({ games, events, now, localTz, morning, onOpenEvent, onToggleEvent }: CalendarViewProps) {
  const calendar = useCalendarGames(games);
  const headingId = useId();
  const gridRef = useRef<HTMLDivElement>(null);
  const focusNext = useRef<string | null>(null);
  const todayIso = DateTime.fromMillis(now, { zone: localTz }).toISODate()!;
  const [selected, setSelected] = useState(todayIso);
  const [cursor, setCursor] = useState<DateTime>(() => DateTime.fromISO(todayIso, { zone: localTz }).startOf('month'));
  const minute = Math.floor(now / 60_000);
  const hour = Math.floor(minute / 60);

  const shown = useMemo(() => events.filter((event) => calendar.gameOf(event)), [events, calendar]);
  const weeks = useMemo(() => monthWeeks(cursor.year, cursor.month, localTz), [cursor, localTz]);

  // Every day's endings, starts and marks, keyed by ISO date.
  const days = useMemo(() => {
    const map = new Map<string, DayCell>();
    const cell = (date: string) => {
      let found = map.get(date);
      if (!found) map.set(date, (found = { ends: [], starts: [], down: false }));
      return found;
    };
    for (const event of shown) {
      if (event.type === 'maintenance') cell(dayKey(event.start, localTz)).down = true;
      else if (event.type === 'livestream') cell(dayKey(event.start, localTz)).live ??= event;
      else {
        cell(lastPlayDay(event.end, now, localTz, morning).toISODate()!).ends.push(event);
        cell(dayKey(event.start, localTz)).starts.push(event);
      }
    }
    for (const day of map.values()) {
      day.ends.sort((a, b) => Number(Boolean(a.done)) - Number(Boolean(b.done)) || a.end - b.end);
      day.starts.sort((a, b) => a.start - b.start);
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, localTz, morning, hour]);

  // The month in one line: how much ends in it, how much is left, and its busiest day ahead.
  const summary = useMemo(() => {
    let total = 0;
    let left = 0;
    let busiest: { date: string; left: number } | null = null;
    for (const week of weeks)
      for (const day of week.days) {
        if (!day.inMonth) continue;
        const work = (days.get(day.date)?.ends ?? []).filter(isWork);
        total += work.length;
        const open = work.filter((event) => !event.done && event.end > now).length;
        left += open;
        if (day.date >= todayIso && open > 1 && (!busiest || open > busiest.left))
          busiest = { date: day.date, left: open };
      }
    return { total, left, busiest };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weeks, days, todayIso, minute]);

  const selectedDay = DateTime.fromISO(selected, { zone: localTz });
  const selectedStart = selectedDay.toMillis();
  const selectedEnd = selectedDay.plus({ days: 1 }).toMillis();
  const digest = useMemo(
    () => dayDigest(shown, selectedStart, localTz, { now, morning }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shown, selected, localTz, minute, morning],
  );
  const starts = useMemo(
    () =>
      foldMoments(
        shown
          .filter((event) => isTimed(event) && event.start >= selectedStart && event.start < selectedEnd)
          .map((event) => ({ event, kind: 'starts' as const, at: event.start })),
      ),
    [shown, selectedStart, selectedEnd],
  );
  // Open on the day, not ending on it, not done: what could be done then.
  const running = useMemo(
    () =>
      selected < todayIso
        ? []
        : shown
            .filter(
              (event) =>
                isWork(event) &&
                !event.done &&
                // What starts on the day is listed under Starts.
                event.start < selectedStart &&
                event.end > Math.max(selectedStart, now) &&
                lastPlayDay(event.end, now, localTz, morning).toISODate()! > selected,
            )
            .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || a.end - b.end),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shown, selected, todayIso, localTz, morning, minute],
  );
  const [allRunning, setAllRunning] = useState(false);

  useEffect(() => {
    if (!focusNext.current) return;
    gridRef.current?.querySelector<HTMLElement>(`[data-date="${focusNext.current}"]`)?.focus();
    focusNext.current = null;
  });

  const showMonth = (month: DateTime) => {
    const start = month.startOf('month');
    setCursor(start);
    // The chosen day follows into the month shown: today if it is there, else the 1st.
    if (!selectedDay.hasSame(start, 'month'))
      setSelected(
        DateTime.fromISO(todayIso, { zone: localTz }).hasSame(start, 'month') ? todayIso : start.toISODate()!,
      );
  };
  const choose = (iso: string, focus: boolean) => {
    setSelected(iso);
    setAllRunning(false);
    if (!weeks.some((week) => week.days.some((day) => day.date === iso)))
      setCursor(DateTime.fromISO(iso, { zone: localTz }).startOf('month'));
    if (focus) focusNext.current = iso;
  };
  const onCellKey = (event: KeyboardEvent<HTMLButtonElement>, iso: string) => {
    const day = DateTime.fromISO(iso, { zone: localTz });
    let next: DateTime | undefined;
    if (event.key in KEY_STEPS) next = day.plus({ days: KEY_STEPS[event.key]! });
    else if (event.key === 'Home') next = day.minus({ days: day.weekday - 1 });
    else if (event.key === 'End') next = day.plus({ days: 7 - day.weekday });
    else if (event.key === 'PageUp') next = day.minus({ months: 1 });
    else if (event.key === 'PageDown') next = day.plus({ months: 1 });
    if (!next) return;
    event.preventDefault();
    choose(next.toISODate()!, true);
  };

  const isToday = selected === todayIso;
  const rowProps = { games: calendar, now, localTz, morning, onOpenEvent, onToggleEvent };
  const runningShown = allRunning ? running : running.slice(0, RUNNING_SHOWN);

  return (
    <div className="cal-month">
      <div className="cal-view-bar cal-month-nav">
        <button
          type="button"
          className="cal-nav-button"
          aria-label="Previous month"
          onClick={() => showMonth(cursor.minus({ months: 1 }))}
        >
          <svg viewBox="0 0 20 20" aria-hidden className="icon h-5 w-5" fill="none" stroke="currentColor">
            <path d="m12 5-5 5 5 5" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <h2 id={`${headingId}-month`} className="cal-month-title" aria-live="polite">
          {cursor.toFormat('LLLL yyyy')}
        </h2>
        <button
          type="button"
          className="cal-nav-button"
          aria-label="Next month"
          onClick={() => showMonth(cursor.plus({ months: 1 }))}
        >
          <svg viewBox="0 0 20 20" aria-hidden className="icon h-5 w-5" fill="none" stroke="currentColor">
            <path d="m8 5 5 5-5 5" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <Btn
          className={TOUCH_BUTTON}
          onClick={() => {
            showMonth(DateTime.fromISO(todayIso, { zone: localTz }));
            choose(todayIso, true);
          }}
        >
          Today
        </Btn>
        <p className="cal-month-summary">
          {summary.total === 0 ? (
            'Nothing ends this month'
          ) : (
            <>
              <b className="numeral">{summary.total}</b> end · <b className="numeral">{summary.left}</b> left
              {summary.busiest && (
                <span className="cal-month-busiest">
                  {' · busiest '}
                  <button type="button" className="cal-month-jump" onClick={() => choose(summary.busiest!.date, true)}>
                    {DateTime.fromISO(summary.busiest.date, { zone: localTz }).toFormat('ccc d')} (
                    {summary.busiest.left})
                  </button>
                </span>
              )}
            </>
          )}
        </p>
      </div>

      <div className="cal-month-body">
        <section className="cal-grid" aria-labelledby={`${headingId}-month`} ref={gridRef}>
          <div className="cal-weekdays" aria-hidden>
            {WEEKDAYS.map((name) => (
              <span key={name}>{name}</span>
            ))}
          </div>
          {weeks.map((week) => (
            <div key={week.start} className="cal-week">
              {week.days.map((day) => {
                const info = days.get(day.date);
                const ends = info?.ends ?? [];
                const open = ends.filter((event) => isWork(event) && !event.done && event.end > now).length;
                const today = day.date === todayIso;
                const past = day.date < todayIso;
                const date = DateTime.fromMillis(day.start, { zone: localTz });
                const startCount = info?.starts.length ?? 0;
                const rest = [
                  date.toFormat('LLLL'),
                  today && 'today',
                  ends.length > 0 &&
                    `${ends.length} ${ends.length === 1 ? 'ends' : 'end'}${open ? `, ${open} not done` : ''}`,
                  startCount > 0 && `${startCount} ${startCount === 1 ? 'starts' : 'start'}`,
                  info?.down && 'maintenance',
                  info?.live && 'livestream',
                ]
                  .filter(Boolean)
                  .join(', ');
                const startGames = [...new Set((info?.starts ?? []).map((event) => event.gameId))];
                return (
                  <button
                    key={day.date}
                    type="button"
                    data-date={day.date}
                    data-load={past ? undefined : Math.min(3, open) || undefined}
                    data-past={past || undefined}
                    className={`cal-cell ${day.inMonth ? '' : 'cal-cell-out'} ${day.weekend ? 'cal-cell-we' : ''} ${today ? 'cal-cell-today' : ''}`}
                    aria-pressed={day.date === selected}
                    aria-current={today ? 'date' : undefined}
                    tabIndex={day.date === selected ? 0 : -1}
                    onClick={() => choose(day.date, false)}
                    onKeyDown={(event) => onCellKey(event, day.date)}
                  >
                    <span className="cal-cell-head">
                      <span className="sr-only">{date.toFormat('cccc')}</span>{' '}
                      <span className="cal-cell-n">{day.day}</span> <span className="sr-only">{rest}</span>
                      <span className="cal-cell-marks" aria-hidden>
                        {info?.live && (
                          <i className="cal-diamond" style={{ background: calendar.ink(info.live.gameId) }} />
                        )}
                        {info?.down && <i className="cal-hatch" />}
                      </span>
                    </span>
                    <span className="cal-ends" aria-hidden>
                      {ends.slice(0, CELL_NAMES).map((event) => (
                        <span
                          key={event.id}
                          className="cal-end"
                          data-done={event.done || undefined}
                          data-banner={event.type === 'banner' || undefined}
                          style={{ ['--end-ink' as string]: calendar.ink(event.gameId) }}
                        >
                          {event.name}
                        </span>
                      ))}
                      {ends.length > CELL_NAMES && <span className="cal-end-more">+{ends.length - CELL_NAMES}</span>}
                    </span>
                    {startCount > 0 && (
                      <span className="cal-starts" aria-hidden>
                        <svg viewBox="0 0 10 10" className="cal-starts-mark">
                          <path d="M3 2.2v5.6L7.6 5z" fill="currentColor" />
                        </svg>
                        {startCount}
                        {startGames.slice(0, 4).map((gameId) => (
                          <i key={gameId} style={{ background: calendar.ink(gameId) }} />
                        ))}
                      </span>
                    )}
                    <span className="cal-dots" aria-hidden>
                      {[...new Set(ends.map((event) => event.gameId))].slice(0, 4).map((gameId) => (
                        <i key={gameId} style={{ background: calendar.ink(gameId) }} />
                      ))}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
          <p className="cal-month-key" aria-hidden>
            <span className="cal-key-swatch" data-load="1" />
            <span className="cal-key-swatch" data-load="2" />
            <span className="cal-key-swatch" data-load="3" />
            unfinished events ending that day
          </p>
        </section>

        <aside className="cal-panel" aria-labelledby={`${headingId}-day`}>
          <h2 id={`${headingId}-day`} className="cal-panel-title">
            {isToday ? 'Today · ' : ''}
            {selectedDay.toFormat(selectedDay.year === cursor.year ? 'cccc d LLLL' : 'cccc d LLLL yyyy')}
          </h2>
          <PanelSection title="Ends" count={digest.ends.length}>
            {digest.ends.map((moment) => (
              <PanelRow key={moment.key} moment={moment} game={calendar.gameOf(moment.events[0]!)!} {...rowProps} />
            ))}
          </PanelSection>
          <PanelSection title="Starts" count={starts.length}>
            {starts.map((moment) => (
              <PanelRow key={moment.key} moment={moment} game={calendar.gameOf(moment.events[0]!)!} {...rowProps} />
            ))}
          </PanelSection>
          <PanelSection title="Also" count={digest.marks.length}>
            {digest.marks.map((event) => (
              <PanelRow
                key={event.id}
                moment={{
                  key: event.id,
                  kind: event.type === 'livestream' ? 'live' : 'down',
                  at: event.start,
                  gameId: event.gameId,
                  events: [event],
                }}
                game={calendar.gameOf(event)!}
                {...rowProps}
              />
            ))}
          </PanelSection>
          {digest.ends.length + starts.length + digest.marks.length === 0 && (
            <p className="cal-col-none">Nothing ends or starts{isToday ? ' today' : ''}.</p>
          )}
          <PanelSection title={isToday ? 'Running now' : 'Still running'} count={running.length} hint="ends later">
            {runningShown.map((event) => (
              <PanelRow
                key={event.id}
                moment={{ key: `run:${event.id}`, kind: 'ends', at: event.end, gameId: event.gameId, events: [event] }}
                game={calendar.gameOf(event)!}
                running
                {...rowProps}
              />
            ))}
          </PanelSection>
          {running.length > RUNNING_SHOWN && (
            <button
              type="button"
              className="cal-fold"
              aria-expanded={allRunning}
              onClick={() => setAllRunning(!allRunning)}
            >
              {allRunning ? 'Show fewer' : `Show all ${running.length}`}
            </button>
          )}
        </aside>
      </div>
    </div>
  );
}

function isTimed(event: GameEvent): boolean {
  return event.type !== 'livestream' && event.type !== 'maintenance';
}

function PanelSection({
  title,
  count,
  hint,
  children,
}: {
  title: string;
  count: number;
  hint?: string;
  children: ReactNode;
}) {
  if (count === 0) return null;
  return (
    <>
      <h3 className="cal-label">
        {title} <span className="cal-label-count numeral">{count}</span>
        {hint && <span className="cal-label-hint say">{hint}</span>}
      </h3>
      <ul className="cal-panel-list">{children}</ul>
    </>
  );
}

function PanelRow({
  moment,
  game,
  games,
  now,
  localTz,
  morning,
  running = false,
  onOpenEvent,
  onToggleEvent,
}: {
  moment: CalendarMoment;
  game: Game;
  games: CalendarGames;
  now: number;
  localTz: string;
  morning: number;
  /** Open on the day but ending later: its time is its last day and how long is left. */
  running?: boolean;
  onOpenEvent: (event: GameEvent) => void;
  onToggleEvent: (event: GameEvent) => void;
}) {
  const [open, setOpen] = useState(false);
  const lead = moment.events[0]!;
  const more = moment.events.length - 1;
  const done = moment.events.every((event) => event.done);
  const tickable = moment.kind === 'ends';
  const tone =
    moment.kind === 'ends'
      ? done
        ? 'var(--color-ok)'
        : endTone(moment.at - now)
      : moment.kind === 'starts'
        ? 'var(--color-muted)'
        : 'var(--color-fg-soft)';
  const swipes = tickable ? momentSwipes(moment, onToggleEvent) : { right: null, left: null };
  return (
    <SwipeRow
      as="li"
      className="cal-panel-row"
      right={swipes.right}
      left={swipes.left}
      ink={games.ink(game.id)}
      data-panel-event={lead.id}
      data-done={done || undefined}
    >
      <div className="cal-panel-top">
        <button type="button" className="cal-item-main" onClick={() => onOpenEvent(lead)}>
          <MomentMark event={lead} game={game} games={games} size={28} />
          <MomentText name={lead.name} game={game} games={games} done={tickable && done} short>
            {more > 0 ? (
              `+${more} more`
            ) : moment.kind === 'down' ? (
              `until ${clock(lead.end, localTz)}`
            ) : moment.kind === 'starts' ? (
              <>
                <EventKind game={game} event={lead} /> to{' '}
                {lastPlayDay(lead.end, now, localTz, morning).toFormat('d LLL')}
              </>
            ) : (
              <EventKind game={game} event={lead} />
            )}
          </MomentText>
        </button>
        <span className="cal-panel-time" style={{ color: tone }}>
          {running ? (
            <>
              {lastPlayDay(lead.end, now, localTz, morning).toFormat('ccc d')} · {shortLeft(lead.end - now)}
            </>
          ) : (
            <>
              {moment.overnight && <NightMark at={moment.at} tz={localTz} />}
              {clock(moment.at, localTz)}
            </>
          )}
        </span>
        {tickable && <MomentTick moment={moment} game={game} tz={localTz} onToggleEvent={onToggleEvent} />}
      </div>
      {more > 0 && (
        <>
          <button type="button" className="cal-fold" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? 'Hide' : 'Show'} all {moment.events.length}
          </button>
          {open && (
            <ul className="cal-fold-list">
              {moment.events.map((event) => (
                <li key={event.id} className="cal-fold-row" data-done={event.done || undefined}>
                  <button type="button" className="cal-fold-name" onClick={() => onOpenEvent(event)}>
                    <span className={`cal-name ${tickable && event.done ? 'cal-name-done' : ''}`}>{event.name}</span>
                  </button>
                  {tickable && (
                    <MomentTick
                      moment={{ ...moment, key: event.id, events: [event] }}
                      game={game}
                      tz={localTz}
                      onToggleEvent={onToggleEvent}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </SwipeRow>
  );
}
