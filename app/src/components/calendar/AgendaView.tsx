import { useId, useMemo, useState } from 'react';
import { DateTime } from 'luxon';
import { agendaDays, type CalendarMoment, type Game, type GameEvent } from '@memoria/shared';
import { endTone } from '../../util';
import { PinMark } from '../EventPeek';
import type { CalendarViewProps } from './types';
import {
  EventKind,
  MomentMark,
  MomentText,
  MomentTick,
  clock,
  dayTitle,
  gameLabel,
  useCalendarGames,
  type CalendarGames,
} from './parts';

const WHAT: Record<CalendarMoment['kind'], string> = { ends: 'ends', starts: 'starts', live: 'live', down: 'down' };

/**
 * The agenda: day by day from today, what happens and when. A row is a time,
 * what happens then, the game, the event and, where an event ends, its tick.
 * Many events of one game ending together fold into one row that opens.
 * Choosing a row opens the event's quick view, where it can be edited.
 */
export function AgendaView({
  games,
  events,
  now,
  localTz,
  showFinished,
  onOpenEvent,
  onToggleEvent,
}: CalendarViewProps) {
  const calendar = useCalendarGames(games);
  const headingId = useId();
  const [openFolds, setOpenFolds] = useState<ReadonlySet<string>>(new Set());
  const minute = Math.floor(now / 60_000);
  // An event whose game is filtered out or paused leaves with its game.
  const agenda = useMemo(
    () =>
      agendaDays(
        events.filter((event) => calendar.gameOf(event)),
        now,
        localTz,
        { showFinished },
      ),
    // Rows move on the minute, not on every tick of the clock.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [events, calendar, minute, localTz, showFinished],
  );

  if (agenda.days.length === 0 && agenda.finished.length === 0)
    return (
      <p className="cal-empty">
        {games.length > 0 && games.every((game) => game.paused)
          ? 'All games are paused.'
          : agenda.hiddenFinished > 0
            ? `Nothing running. ${agenda.hiddenFinished} finished hidden.`
            : 'No events.'}
      </p>
    );

  const toggleFold = (key: string) =>
    setOpenFolds((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  return (
    <div className="cal-agenda">
      {agenda.days.map((day) => {
        const { title, date } = dayTitle(day.start, now, localTz);
        return (
          <section key={day.date} className="cal-agenda-day" aria-labelledby={`${headingId}-${day.date}`}>
            <h2 id={`${headingId}-${day.date}`} className="cal-day-head">
              <span className="cal-day-title">{title}</span> <span className="cal-day-date">{date}</span>
            </h2>
            <ul className="cal-rows">
              {day.moments.flatMap((moment) => {
                const game = calendar.gameOf(moment.events[0]!)!;
                const open = openFolds.has(moment.key);
                const row = (
                  <AgendaRow
                    key={moment.key}
                    moment={moment}
                    game={game}
                    games={calendar}
                    now={now}
                    localTz={localTz}
                    open={open}
                    onFold={() => toggleFold(moment.key)}
                    onOpenEvent={onOpenEvent}
                    onToggleEvent={onToggleEvent}
                  />
                );
                if (!open) return [row];
                return [
                  row,
                  ...moment.events.map((event) => (
                    <AgendaRow
                      key={`${moment.key}:${event.id}`}
                      moment={{ ...moment, key: `${moment.key}:${event.id}`, events: [event] }}
                      game={game}
                      games={calendar}
                      now={now}
                      localTz={localTz}
                      nested
                      onOpenEvent={onOpenEvent}
                      onToggleEvent={onToggleEvent}
                    />
                  )),
                ];
              })}
            </ul>
          </section>
        );
      })}
      {agenda.finished.length > 0 && (
        <section className="cal-agenda-day" aria-labelledby={`${headingId}-finished`}>
          <h2 id={`${headingId}-finished`} className="cal-day-head">
            <span className="cal-day-title">Finished</span>{' '}
            <span className="cal-day-date">{agenda.finished.length}</span>
          </h2>
          <ul className="cal-rows">
            {agenda.finished.map((event) => (
              <AgendaRow
                key={event.id}
                moment={{ key: event.id, kind: 'ends', at: event.end, gameId: event.gameId, events: [event] }}
                game={calendar.gameOf(event)!}
                games={calendar}
                now={now}
                localTz={localTz}
                dated
                onOpenEvent={onOpenEvent}
                onToggleEvent={onToggleEvent}
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function AgendaRow({
  moment,
  game,
  games,
  now,
  localTz,
  open,
  onFold,
  nested = false,
  dated = false,
  onOpenEvent,
  onToggleEvent,
}: {
  moment: CalendarMoment;
  game: Game;
  games: CalendarGames;
  now: number;
  localTz: string;
  open?: boolean;
  onFold?: () => void;
  nested?: boolean;
  /** Finished rows from before today name their date as well as their time. */
  dated?: boolean;
  onOpenEvent: (event: GameEvent) => void;
  onToggleEvent: (event: GameEvent) => void;
}) {
  const lead = moment.events[0]!;
  const folded = moment.events.length > 1;
  const done = moment.events.every((event) => event.done);
  const over = done || lead.end <= now;
  const tone =
    moment.kind === 'ends'
      ? done
        ? 'var(--color-ok)'
        : endTone(moment.at - now)
      : moment.kind === 'starts'
        ? 'var(--color-muted)'
        : 'var(--color-fg-soft)';
  const detail = folded ? (
    `and ${moment.events.length - 1} more ${game.short.trim() || game.name} events`
  ) : moment.kind === 'down' ? (
    `down until ${clock(lead.end, localTz)}`
  ) : moment.kind === 'starts' ? (
    <>
      <EventKind game={game} event={lead} />, to {DateTime.fromMillis(lead.end, { zone: localTz }).toFormat('d LLL')}
    </>
  ) : (
    <EventKind game={game} event={lead} />
  );
  return (
    <li
      // One data-list-event per event: a coming event's start row is marked apart.
      data-list-event={folded || moment.kind === 'starts' ? undefined : lead.id}
      data-list-start={!folded && moment.kind === 'starts' ? lead.id : undefined}
      data-list-fold={folded ? moment.events.length : undefined}
      data-list-game={game.id}
      data-pinned={lead.pinned || undefined}
      data-done={over || undefined}
      className={`cal-row ${nested ? 'cal-row-nested' : ''}`}
    >
      <button type="button" className="cal-row-main" onClick={() => onOpenEvent(lead)}>
        <span className="cal-when">
          <b style={{ color: tone }}>
            {dated ? DateTime.fromMillis(moment.at, { zone: localTz }).toFormat('d LLL') : clock(moment.at, localTz)}
          </b>{' '}
          <span>{dated ? clock(moment.at, localTz) : WHAT[moment.kind]}</span>
        </span>{' '}
        <MomentMark event={lead} game={game} games={games} />
        <MomentText
          name={lead.name}
          game={game}
          games={games}
          done={over}
          pinned={lead.pinned ? <PinMark className="mr-1.5 inline h-3.5 w-3.5 align-[-0.1em]" /> : undefined}
        >
          {detail}
        </MomentText>
      </button>
      {folded ? (
        <button type="button" className="cal-more" aria-expanded={Boolean(open)} onClick={onFold}>
          {open ? 'Hide' : `+${moment.events.length - 1}`}{' '}
          <span className="sr-only">
            {open ? `the ${moment.events.length - 1} ` : ''}more {gameLabel(game)} events{' '}
            {moment.kind === 'ends' ? 'ending' : 'starting'} {clock(moment.at, localTz)}
          </span>
        </button>
      ) : moment.kind === 'ends' ? (
        <MomentTick moment={moment} game={game} tz={localTz} onToggleEvent={onToggleEvent} />
      ) : (
        <span aria-hidden />
      )}
    </li>
  );
}
