import { useMemo } from 'react';
import { DateTime } from 'luxon';
import {
  deadlineLoad,
  eventReward,
  getAheadPicks,
  PILEUP,
  weekProgress,
  type AheadReason,
  type GameEvent,
} from '@memoria/shared';
import { SwipeRow } from '../../swipe-row';
import { endTone } from '../../util';
import { PinMark } from '../EventPeek';
import type { CalendarViewProps } from './types';
import { EventKind, MomentMark, MomentText, MomentTick, momentSwipes, shortLeft, type CalendarGames } from './parts';

const LOAD_DAYS = 14;

function reasonText(reason: AheadReason, tz: string, currency?: string): string {
  switch (reason.kind) {
    case 'pinned':
      return 'Pinned';
    case 'ends':
      return reason.daysLeft === 0
        ? 'Last day today'
        : reason.daysLeft === 1
          ? 'Last day tomorrow'
          : `${reason.daysLeft} days left`;
    case 'pileup':
      return `${reason.count} end ${DateTime.fromISO(reason.date, { zone: tz }).toFormat('ccc d')}`;
    case 'started':
      return 'Started';
    case 'reward':
      return `+${reason.amount.toLocaleString('en-US')}${currency ? ` ${currency}` : ''}`;
  }
}

/**
 * The top of Ending soon: how today and this week stand, the next two weeks'
 * load day by day, and the few events most worth doing now, each with why.
 * The point is to finish things while there is time, before the days pile up.
 */
export function SoonAhead({
  events,
  now,
  localTz,
  morning,
  calendar,
  onOpenEvent,
  onToggleEvent,
  onJumpToDay,
}: Pick<CalendarViewProps, 'events' | 'now' | 'localTz' | 'morning' | 'onOpenEvent' | 'onToggleEvent'> & {
  calendar: CalendarGames;
  onJumpToDay: (start: number) => void;
}) {
  const minute = Math.floor(now / 60_000);
  const shown = useMemo(() => events.filter((event) => calendar.gameOf(event)), [events, calendar]);
  const load = useMemo(
    () => deadlineLoad(shown, now, localTz, { days: LOAD_DAYS, morning }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shown, localTz, morning, minute],
  );
  const picks = useMemo(
    () =>
      getAheadPicks(shown, now, localTz, {
        morning,
        limit: 4,
        reward: (event) => eventReward(event, calendar.gameOf(event))?.amount ?? null,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shown, localTz, morning, minute, calendar],
  );
  const week = useMemo(
    () => weekProgress(shown, now, localTz, morning),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shown, localTz, morning, minute],
  );
  const today = load[0]!;
  const peak = Math.max(PILEUP, ...load.map((day) => day.total));
  const nextPile = load.slice(1).find((day) => day.left >= PILEUP);

  const headline =
    today.left > 0
      ? `${today.left} ${today.left === 1 ? 'ends' : 'end'} today, not done yet`
      : today.total > 0
        ? 'Everything ending today is done'
        : 'Nothing ends today: a good day to get ahead';

  return (
    <section className="soon-ahead" aria-label="Getting ahead">
      <div className="soon-head">
        <p className="soon-headline" data-tone={today.left > 0 ? 'now' : 'calm'}>
          {headline}
        </p>
        <p className="soon-week">
          {week.total > 0 && (
            <span>
              This week <b className="numeral">{week.done}</b>/<span className="numeral">{week.total}</span> done
            </span>
          )}
          {nextPile && (
            <span className="soon-week-pile">
              {' · '}
              {nextPile.left} end {DateTime.fromISO(nextPile.date, { zone: localTz }).toFormat('cccc d')}
            </span>
          )}
        </p>
      </div>

      <div className="soon-load" role="list" aria-label={`The next ${LOAD_DAYS} days`}>
        {load.map((day, index) => {
          const date = DateTime.fromISO(day.date, { zone: localTz });
          const said = `${index === 0 ? 'Today' : date.toFormat('cccc d LLLL')}: ${
            day.total === 0 ? 'nothing ends' : `${day.total} ${day.total === 1 ? 'ends' : 'end'}, ${day.left} not done`
          }`;
          return (
            <div key={day.date} role="listitem" className="soon-load-cell">
              <button
                type="button"
                className="soon-load-day"
                data-today={index === 0 || undefined}
                data-pile={day.left >= PILEUP || undefined}
                data-weekend={date.weekday >= 6 || undefined}
                onClick={() => onJumpToDay(day.start)}
              >
                <span className="sr-only">{said}</span>
                <span className="soon-load-bar" aria-hidden>
                  {day.games.map((item) => (
                    <i
                      key={item.gameId}
                      style={{ flexGrow: item.left, background: calendar.ink(item.gameId) }}
                      data-game={item.gameId}
                    />
                  ))}
                  {day.total - day.left > 0 && (
                    <i className="soon-load-done" style={{ flexGrow: day.total - day.left }} />
                  )}
                  <b style={{ flexGrow: Math.max(0, peak - day.total) }} />
                </span>
                <span className="soon-load-n numeral" aria-hidden>
                  {day.left || ''}
                </span>
                <span className="soon-load-date" aria-hidden>
                  <span className="soon-load-wd">{date.toFormat('ccc')}</span>
                  <span className="soon-load-d numeral">{date.toFormat('d')}</span>
                </span>
              </button>
            </div>
          );
        })}
      </div>

      {picks.length > 0 && (
        <div className="soon-picks">
          <h2 className="soon-picks-title">Do next</h2>
          <ul className="soon-picks-list">
            {picks.map((pick) => {
              const event = pick.event as GameEvent;
              const game = calendar.gameOf(event)!;
              const moment = {
                key: `pick:${event.id}`,
                kind: 'ends' as const,
                at: event.end,
                gameId: event.gameId,
                events: [event],
              };
              const swipes = momentSwipes(moment, onToggleEvent);
              const currency = eventReward(event, game)?.currency;
              return (
                <SwipeRow
                  as="li"
                  key={event.id}
                  className="soon-pick"
                  right={swipes.right}
                  left={swipes.left}
                  ink={calendar.ink(game.id)}
                  data-pick={event.id}
                  style={{ ['--pick-ink' as string]: calendar.ink(game.id) }}
                >
                  <div className="soon-pick-top">
                    <button type="button" className="cal-item-main" onClick={() => onOpenEvent(event)}>
                      <MomentMark event={event} game={game} games={calendar} size={32} />
                      <MomentText
                        name={event.name}
                        game={game}
                        games={calendar}
                        pinned={
                          event.pinned ? <PinMark className="mr-1.5 inline h-3.5 w-3.5 align-[-0.1em]" /> : undefined
                        }
                      >
                        <EventKind game={game} event={event} />
                      </MomentText>
                    </button>
                    <MomentTick moment={moment} game={game} tz={localTz} onToggleEvent={onToggleEvent} />
                  </div>
                  <p className="soon-pick-why">
                    {pick.reasons
                      .filter((reason) => reason.kind !== 'pinned')
                      .map((reason) => (
                        <span
                          key={reason.kind}
                          className="soon-reason"
                          data-kind={reason.kind}
                          style={
                            reason.kind === 'ends' ? { ['--tone' as string]: endTone(event.end - now) } : undefined
                          }
                        >
                          {reason.kind === 'ends' && pick.daysLeft === 0
                            ? `${shortLeft(event.end - now)} left`
                            : reasonText(reason, localTz, currency)}
                        </span>
                      ))}
                  </p>
                </SwipeRow>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
