import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { DateTime } from 'luxon';
import { dayDigest, monthWeeks, packWeek, type CalendarMoment, type Game, type GameEvent } from '@memoria/shared';
import { endTone } from '../../util';
import { Btn, TOUCH_BUTTON } from '../ui';
import type { CalendarViewProps } from './types';
import {
  EventKind,
  MomentMark,
  MomentText,
  MomentTick,
  clock,
  gameLabel,
  useCalendarGames,
  type CalendarGames,
} from './parts';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const LANES = 3;
const KEY_STEPS: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };

/**
 * A month of the player's days, Monday first. Events are bars in their game's
 * colour, three lanes a week with the rest counted per day; maintenance is a
 * hatched mark on its day. Choosing a day fills the panel beside the grid with
 * what ends that day and what starts the next; choosing a bar opens the event.
 * On a phone the bars become dots and the panel sits below the grid.
 */
export function MonthBoard({ games, events, now, localTz, onOpenEvent, onToggleEvent }: CalendarViewProps) {
  const calendar = useCalendarGames(games);
  const headingId = useId();
  const gridRef = useRef<HTMLDivElement>(null);
  const focusNext = useRef<string | null>(null);
  const todayIso = DateTime.fromMillis(now, { zone: localTz }).toISODate()!;
  const [selected, setSelected] = useState(todayIso);
  const [cursor, setCursor] = useState<DateTime>(() => DateTime.fromISO(todayIso, { zone: localTz }).startOf('month'));

  const shown = useMemo(() => events.filter((event) => calendar.gameOf(event)), [events, calendar]);
  const weeks = useMemo(() => monthWeeks(cursor.year, cursor.month, localTz), [cursor, localTz]);
  const packed = useMemo(() => weeks.map((week) => packWeek(shown, week, LANES)), [weeks, shown]);
  const selectedDay = DateTime.fromISO(selected, { zone: localTz });
  const digest = useMemo(
    () => dayDigest(shown, selectedDay.toMillis(), localTz),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shown, selected, localTz],
  );

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
  const endCount = digest.ends.reduce((sum, moment) => sum + moment.events.length, 0);
  const tomorrowWord = isToday ? 'tomorrow' : 'the next day';

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
      </div>

      <div className="cal-month-body">
        <section className="cal-grid" aria-labelledby={`${headingId}-month`} ref={gridRef}>
          <div className="cal-weekdays" aria-hidden>
            {WEEKDAYS.map((name) => (
              <span key={name}>{name}</span>
            ))}
          </div>
          {weeks.map((week, index) => {
            const { bars, hidden, changes, marks, games: dayGames } = packed[index]!;
            return (
              <div key={week.start} className="cal-week">
                <div className="cal-cells">
                  {week.days.map((day, column) => {
                    const count =
                      bars
                        .filter((bar) => bar.from <= column && column < bar.to)
                        .reduce((sum, bar) => sum + bar.events.length, 0) + hidden[column]!;
                    const down = marks[column]!.some((event) => event.type === 'maintenance');
                    const live = marks[column]!.find((event) => event.type === 'livestream');
                    const today = day.date === todayIso;
                    const date = DateTime.fromMillis(day.start, { zone: localTz });
                    // The cell shows its number; the rest of its name is for screen readers.
                    const rest = [
                      date.toFormat('LLLL'),
                      today && 'today',
                      `${count} ${count === 1 ? 'event' : 'events'}`,
                      down && 'maintenance',
                      live && 'livestream',
                    ]
                      .filter(Boolean)
                      .join(', ');
                    return (
                      <button
                        key={day.date}
                        type="button"
                        data-date={day.date}
                        className={`cal-cell ${day.inMonth ? '' : 'cal-cell-out'} ${day.weekend ? 'cal-cell-we' : ''} ${today ? 'cal-cell-today' : ''}`}
                        aria-pressed={day.date === selected}
                        aria-current={today ? 'date' : undefined}
                        tabIndex={day.date === selected ? 0 : -1}
                        onClick={() => choose(day.date, false)}
                        onKeyDown={(event) => onCellKey(event, day.date)}
                      >
                        <span className="sr-only">{date.toFormat('cccc')}</span>{' '}
                        <span className="cal-cell-n">{day.day}</span> <span className="sr-only">{rest}</span>
                        <span className="cal-cell-marks" aria-hidden>
                          {live && <i className="cal-diamond" style={{ background: calendar.ink(live.gameId) }} />}
                          {down && <i className="cal-hatch" title="Maintenance" />}
                        </span>
                        {changes[column]! > 0 && (
                          <span className="cal-cell-more" aria-hidden>
                            +{changes[column]} more
                          </span>
                        )}
                        <span className="cal-dots" aria-hidden>
                          {dayGames[column]!.slice(0, 4).map((gameId) => (
                            <i key={gameId} style={{ background: calendar.ink(gameId) }} />
                          ))}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <div className="cal-lanes">
                  {bars.map((bar) => {
                    const lead = bar.events[0]!;
                    const game = calendar.gameOf(lead)!;
                    const more = bar.events.length - 1;
                    const range = `${DateTime.fromMillis(lead.start, { zone: localTz }).toFormat('d LLL HH:mm')} to ${DateTime.fromMillis(lead.end, { zone: localTz }).toFormat('d LLL HH:mm')}`;
                    return (
                      <button
                        key={`${lead.id}:${week.start}`}
                        type="button"
                        data-month-event={lead.id}
                        className={`cal-bar ${bar.clippedStart ? 'cal-bar-cl' : ''} ${bar.clippedEnd ? 'cal-bar-cr' : ''} ${bar.events.every((event) => event.done || event.end <= now) ? 'cal-bar-over' : ''}`}
                        style={{
                          left: `calc(${(bar.from / 7) * 100}% + 3px)`,
                          width: `calc(${((bar.to - bar.from) / 7) * 100}% - 6px)`,
                          top: bar.lane * 22,
                          ['--bar-ink' as string]: calendar.ink(game.id),
                        }}
                        title={`${lead.name}${more ? ` and ${more} more` : ''} · ${game.name} · ${range}`}
                        onClick={() => onOpenEvent(lead)}
                      >
                        {lead.name}
                        {more > 0 && <span className="cal-bar-more"> +{more}</span>}
                        <span className="sr-only">
                          , {gameLabel(game)}, {range}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </section>

        <aside className="cal-panel" aria-labelledby={`${headingId}-day`}>
          <h2 id={`${headingId}-day`} className="cal-panel-title">
            {selectedDay.toFormat(selectedDay.year === cursor.year ? 'cccc d LLLL' : 'cccc d LLLL yyyy')}
          </h2>
          <p className="cal-panel-sub">
            {isToday && 'Today · '}
            {digest.running} {digest.running === 1 ? 'event' : 'events'} running, {endCount}{' '}
            {endCount === 1 ? 'ends' : 'end'} {isToday ? 'today' : 'that day'}
          </p>
          {digest.marks.length > 0 && (
            <>
              <h3 className="cal-label">{isToday ? 'Also today' : 'Also that day'}</h3>
              <ul className="cal-panel-list">
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
                    games={calendar}
                    now={now}
                    localTz={localTz}
                    onOpenEvent={onOpenEvent}
                    onToggleEvent={onToggleEvent}
                  />
                ))}
              </ul>
            </>
          )}
          <h3 className="cal-label">{isToday ? 'Ends today' : 'Ends that day'}</h3>
          {digest.ends.length === 0 ? (
            <p className="cal-col-none">Nothing ends {isToday ? 'today' : 'that day'}.</p>
          ) : (
            <ul className="cal-panel-list">
              {digest.ends.map((moment) => (
                <PanelRow
                  key={moment.key}
                  moment={moment}
                  game={calendar.gameOf(moment.events[0]!)!}
                  games={calendar}
                  now={now}
                  localTz={localTz}
                  onOpenEvent={onOpenEvent}
                  onToggleEvent={onToggleEvent}
                />
              ))}
            </ul>
          )}
          <h3 className="cal-label">Starts {tomorrowWord}</h3>
          {digest.startsNext.length === 0 ? (
            <p className="cal-col-none">Nothing starts {tomorrowWord}.</p>
          ) : (
            <ul className="cal-panel-list">
              {digest.startsNext.map((moment) => (
                <PanelRow
                  key={moment.key}
                  moment={moment}
                  game={calendar.gameOf(moment.events[0]!)!}
                  games={calendar}
                  now={now}
                  localTz={localTz}
                  onOpenEvent={onOpenEvent}
                  onToggleEvent={onToggleEvent}
                />
              ))}
            </ul>
          )}
        </aside>
      </div>
    </div>
  );
}

function PanelRow({
  moment,
  game,
  games,
  now,
  localTz,
  onOpenEvent,
  onToggleEvent,
}: {
  moment: CalendarMoment;
  game: Game;
  games: CalendarGames;
  now: number;
  localTz: string;
  onOpenEvent: (event: GameEvent) => void;
  onToggleEvent: (event: GameEvent) => void;
}) {
  const [open, setOpen] = useState(false);
  const lead = moment.events[0]!;
  const more = moment.events.length - 1;
  const done = moment.events.every((event) => event.done);
  const tone =
    moment.kind === 'ends'
      ? done
        ? 'var(--color-ok)'
        : endTone(moment.at - now)
      : moment.kind === 'starts'
        ? 'var(--color-muted)'
        : 'var(--color-fg-soft)';
  return (
    <li className="cal-panel-row" data-panel-event={lead.id} data-done={done || undefined}>
      <div className="cal-panel-top">
        <button type="button" className="cal-item-main" onClick={() => onOpenEvent(lead)}>
          <MomentMark event={lead} game={game} games={games} size={28} />
          <MomentText name={lead.name} game={game} games={games} done={moment.kind === 'ends' && done} short>
            {more > 0 ? (
              `and ${more} more ${game.short.trim() || game.name} events`
            ) : moment.kind === 'down' ? (
              `down until ${clock(lead.end, localTz)}`
            ) : moment.kind === 'starts' ? (
              <>
                <EventKind game={game} event={lead} />, until{' '}
                {DateTime.fromMillis(lead.end, { zone: localTz }).toFormat('d LLL')}
              </>
            ) : (
              <EventKind game={game} event={lead} />
            )}
          </MomentText>
        </button>
        <span className="cal-panel-time" style={{ color: tone }}>
          {clock(moment.at, localTz)}
        </span>
        {moment.kind === 'ends' && (
          <MomentTick moment={moment} game={game} tz={localTz} onToggleEvent={onToggleEvent} />
        )}
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
                    <span className={`cal-name ${moment.kind === 'ends' && event.done ? 'cal-name-done' : ''}`}>
                      {event.name}
                    </span>
                  </button>
                  {moment.kind === 'ends' && (
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
    </li>
  );
}
