import { useId, useMemo, useState } from 'react';
import { DateTime } from 'luxon';
import { elapsedShare, soonColumns, type CalendarMoment, type Game, type SoonBucket } from '@memoria/shared';
import { endTone } from '../../util';
import { Toggle } from '../ui';
import { PinMark } from '../EventPeek';
import type { CalendarViewProps } from './types';
import { EventKind, MomentMark, MomentText, MomentTick, clock, shortLeft, useCalendarGames } from './parts';

/** Later is a glance at what is far off; the rest of it is one press away. */
const LATER_SHOWN = 6;

const TITLES: Record<SoonBucket, string> = { today: 'Today', week: 'By Sunday', next: 'Next week', later: 'Later' };
const TONES: Record<SoonBucket, string> = {
  today: 'var(--color-rose)',
  week: 'var(--color-warn)',
  next: 'var(--color-fg-soft)',
  later: 'var(--color-muted)',
};

function span(from: number, until: number, tz: string): string {
  const first = DateTime.fromMillis(from, { zone: tz });
  const last = DateTime.fromMillis(until - 1, { zone: tz });
  if (first.hasSame(last, 'day')) return first.toFormat('cccc d LLLL');
  return `${first.toFormat(first.month === last.month ? 'cccc d' : 'cccc d LLLL')} to ${last.toFormat('cccc d LLLL')}`;
}

/** The end time in the fewest words its column needs: a clock today, a weekday this week, a date after. */
function endLabel(at: number, bucket: SoonBucket, now: number, tz: string): string {
  const end = DateTime.fromMillis(at, { zone: tz });
  const when =
    bucket === 'today'
      ? end.toFormat('HH:mm')
      : bucket === 'week'
        ? end.toFormat('ccc HH:mm')
        : bucket === 'next'
          ? end.toFormat('ccc d')
          : end.toFormat(end.year === DateTime.fromMillis(now, { zone: tz }).year ? 'ccc d LLL' : 'ccc d LLL yyyy');
  return `${when} · ${shortLeft(at - now)}`;
}

/**
 * What is left to finish, by when it ends: today, the rest of this week,
 * next week and later. Each item shows how far through its window it is, in
 * the game's colour, and how long is left, in its urgency tone.
 */
export function SoonBoard({ games, events, now, localTz, onOpenEvent, onToggleEvent }: CalendarViewProps) {
  const calendar = useCalendarGames(games);
  const headingId = useId();
  const [hideDone, setHideDone] = useState(false);
  const [openFolds, setOpenFolds] = useState<ReadonlySet<string>>(new Set());
  const [allLater, setAllLater] = useState(false);
  const minute = Math.floor(now / 60_000);
  const columns = useMemo(
    () =>
      soonColumns(
        events.filter((event) => calendar.gameOf(event)),
        now,
        localTz,
        { hideDone },
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [events, calendar, minute, localTz, hideDone],
  );
  const toggleFold = (key: string) =>
    setOpenFolds((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  return (
    <div className="cal-soon">
      <div className="cal-view-bar">
        <Toggle checked={hideDone} onChange={setHideDone} label="Hide what is done" className="cal-switch" />
      </div>
      <div className="cal-board">
        {columns.map((column) => (
          <section
            key={column.bucket}
            className="cal-col"
            data-soon={column.bucket}
            aria-labelledby={`${headingId}-${column.bucket}`}
          >
            <h2 id={`${headingId}-${column.bucket}`} className="cal-col-head" style={{ color: TONES[column.bucket] }}>
              {TITLES[column.bucket]} <span className="cal-col-count">{column.count}</span>
            </h2>
            <p className="cal-col-sub">
              {column.bucket === 'today'
                ? 'Before midnight'
                : column.bucket === 'later'
                  ? `From ${DateTime.fromMillis(column.from, { zone: localTz }).toFormat('cccc d LLLL')}`
                  : column.from < column.until
                    ? span(column.from, column.until, localTz)
                    : 'Today is Sunday'}
            </p>
            {column.moments.length === 0 ? (
              <p className="cal-col-none">Nothing ends {column.bucket === 'today' ? 'today' : 'then'}.</p>
            ) : (
              <ul className="cal-items">
                {(column.bucket === 'later' && !allLater ? column.moments.slice(0, LATER_SHOWN) : column.moments).map(
                  (moment) => (
                    <SoonItem
                      key={moment.key}
                      moment={moment}
                      bucket={column.bucket}
                      game={calendar.gameOf(moment.events[0]!)!}
                      calendar={calendar}
                      now={now}
                      localTz={localTz}
                      open={openFolds.has(moment.key)}
                      onFold={() => toggleFold(moment.key)}
                      onOpenEvent={onOpenEvent}
                      onToggleEvent={onToggleEvent}
                    />
                  ),
                )}
              </ul>
            )}
            {column.bucket === 'later' && column.moments.length > LATER_SHOWN && (
              <button
                type="button"
                className="cal-fold"
                aria-expanded={allLater}
                onClick={() => setAllLater(!allLater)}
              >
                {allLater ? 'Show fewer' : `Show all ${column.count}`}
              </button>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}

function SoonItem({
  moment,
  bucket,
  game,
  calendar,
  now,
  localTz,
  open,
  onFold,
  onOpenEvent,
  onToggleEvent,
}: {
  moment: CalendarMoment;
  bucket: SoonBucket;
  game: Game;
  calendar: ReturnType<typeof useCalendarGames>;
  now: number;
  localTz: string;
  open: boolean;
  onFold: () => void;
} & Pick<CalendarViewProps, 'onOpenEvent' | 'onToggleEvent'>) {
  const lead = moment.events[0]!;
  const folded = moment.events.length > 1;
  const done = moment.events.every((event) => event.done);
  const share = done ? 1 : elapsedShare(lead, now);
  return (
    <li
      className="cal-item"
      data-soon-event={lead.id}
      data-done={done || undefined}
      data-pinned={lead.pinned || undefined}
    >
      <div className="cal-item-top">
        <button type="button" className="cal-item-main" onClick={() => onOpenEvent(lead)}>
          <MomentMark event={lead} game={game} games={calendar} />
          <MomentText
            name={lead.name}
            game={game}
            games={calendar}
            done={done}
            pinned={lead.pinned ? <PinMark className="mr-1.5 inline h-3.5 w-3.5 align-[-0.1em]" /> : undefined}
          >
            <EventKind game={game} event={lead} />
          </MomentText>
        </button>
        <MomentTick moment={moment} game={game} tz={localTz} onToggleEvent={onToggleEvent} />
      </div>
      <div className="cal-prog">
        <span
          className="cal-prog-track"
          role="meter"
          aria-label={`${lead.name}: time elapsed`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(share * 100)}
        >
          <i style={{ width: `${share * 100}%`, background: calendar.ink(game.id) }} />
        </span>
        <span className="cal-prog-end" style={{ color: done ? 'var(--color-ok)' : endTone(moment.at - now) }}>
          {done ? 'done' : endLabel(moment.at, bucket, now, localTz)}
        </span>
      </div>
      {folded && (
        <>
          <button type="button" className="cal-fold" aria-expanded={open} onClick={onFold}>
            {open ? 'Hide' : 'and'} {moment.events.length - 1} more {game.short.trim() || game.name} events at{' '}
            {clock(moment.at, localTz)}
          </button>
          {open && (
            <ul className="cal-fold-list">
              {moment.events.map((event) => (
                <li
                  key={event.id}
                  className="cal-fold-row"
                  data-soon-event={event.id}
                  data-done={event.done || undefined}
                >
                  <button type="button" className="cal-fold-name" onClick={() => onOpenEvent(event)}>
                    <span className={`cal-name ${event.done ? 'cal-name-done' : ''}`}>{event.name}</span>
                  </button>
                  <MomentTick
                    moment={{ ...moment, key: event.id, events: [event] }}
                    game={game}
                    tz={localTz}
                    onToggleEvent={onToggleEvent}
                  />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </li>
  );
}
