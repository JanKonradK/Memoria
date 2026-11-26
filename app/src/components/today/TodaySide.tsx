import { useState } from 'react';
import { DateTime } from 'luxon';
import {
  endsOvernight,
  lastPlayDay,
  morningOf,
  type AppState,
  type GameEvent,
  type TodayWeekItem,
} from '@memoria/shared';
import { nextBroadcast } from '../../catch-up-status';
import { useUI } from '../../ui-store';
import { GameLogo } from '../GameLogo';
import { NightMark } from '../NightMark';
import { TodayCodes } from '../TodayCodes';
import type { StepGame } from './StepRow';
import { cadenceNoun, hhmm, shortLeft, weekWhen } from './step-format';

const LIVESTREAMS_SHOWN = 3;
const STARTING_SHOWN = 4;
const WEEK_SHOWN = 6;
const TYPE_WORD: Partial<Record<GameEvent['type'], string>> = {
  banner: 'Banner',
  event: 'Event',
  cycle: 'Cycle',
  custom: 'Event',
};

function SideRow({
  game,
  event,
  sub,
  right,
  diamond,
}: {
  game: StepGame;
  event: GameEvent;
  sub: string;
  right: string;
  diamond?: boolean;
}) {
  const openSheet = useUI((ui) => ui.openSheet);
  return (
    <li>
      <button
        type="button"
        className="today-side-row"
        onClick={() => openSheet({ kind: 'eventPeek', eventId: event.id })}
      >
        <GameLogo game={game.logo} size={32} />
        <span className="min-w-0">
          <span className="today-side-name">
            {diamond && <span className="today-side-diamond" style={{ background: game.ink }} aria-hidden />}
            {event.name.replace(/\s*—\s*predicted window/i, '')}
          </span>
          <span className="today-side-sub">{sub}</span>
        </span>
        <span className="today-side-right numeral">{right}</span>
      </button>
    </li>
  );
}

/** Something later this week: no controls, only when. */
function WeekRow({
  item,
  game,
  now,
  zone,
  morning,
}: {
  item: TodayWeekItem;
  game: StepGame;
  now: number;
  zone: string;
  morning: number;
}) {
  // An event ending in the small hours shows the night before, as the calendar does.
  const overnight = item.kind === 'event' && endsOvernight(item.at, zone, morning);
  const what =
    item.kind === 'cap'
      ? `${item.name} caps`
      : item.kind === 'event'
        ? `${item.name} ends`
        : `${item.left === 1 ? item.name : `${item.left} ${cadenceNoun(item.kind, item.left)}`} reset`;
  return (
    <li className="today-week-row">
      <GameLogo game={game.logo} size={28} />
      <span className="min-w-0 truncate">
        <b style={{ color: game.text }}>{game.game.short}</b>
        {game.account && <> · {game.account}</>} · {what}
      </span>
      <span className="today-week-at numeral">
        {overnight ? (
          <>
            {lastPlayDay(item.at, now, zone, morning).toFormat('ccc')} <NightMark at={item.at} tz={zone} />
            {hhmm(item.at, zone)}
          </>
        ) : (
          weekWhen(item.at, now, zone)
        )}
      </span>
    </li>
  );
}

/**
 * Beside the steps on a wide window, under them otherwise: the rest of the
 * week's deadlines, what is coming, and codes to claim.
 */
export function TodaySide({
  state,
  now,
  games,
  week,
}: {
  state: AppState;
  now: number;
  games: Map<string, StepGame>;
  /** Caps, resets and endings past the next day, already limited to the games shown. */
  week: readonly TodayWeekItem[];
}) {
  const zone = state.settings.localTz;
  const [weekOpen, setWeekOpen] = useState(false);
  const streams = [...games.keys()]
    .map((id) => nextBroadcast(state, id, now))
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    .sort((a, b) => a.event.start - b.event.start)
    .slice(0, LIVESTREAMS_SHOWN);
  const tomorrowEnd = DateTime.fromMillis(now, { zone }).plus({ days: 1 }).endOf('day').toMillis();
  const starting = state.events
    .filter(
      (event) =>
        !event.deleted &&
        games.has(event.gameId) &&
        event.type !== 'livestream' &&
        event.type !== 'maintenance' &&
        event.start > now &&
        event.start <= tomorrowEnd,
    )
    .sort((a, b) => a.start - b.start || a.name.localeCompare(b.name))
    .slice(0, STARTING_SHOWN);
  const allTomorrow = starting.every((event) =>
    DateTime.fromMillis(event.start, { zone }).hasSame(DateTime.fromMillis(now, { zone }).plus({ days: 1 }), 'day'),
  );
  const at = (ms: number, format: string) => DateTime.fromMillis(ms, { zone }).toFormat(format);

  return (
    <aside className="today-side" aria-label="Coming up">
      {week.length > 0 && (
        <section aria-labelledby="today-group-week">
          <h2 id="today-group-week" className="today-side-label">
            This week
          </h2>
          <ul className="today-week-list">
            {(weekOpen ? week : week.slice(0, WEEK_SHOWN)).map((item) => (
              <WeekRow
                key={item.key}
                item={item}
                game={games.get(item.gameId)!}
                now={now}
                zone={zone}
                morning={morningOf(state.settings)}
              />
            ))}
          </ul>
          {week.length > WEEK_SHOWN && (
            <button type="button" className="today-steps-more" onClick={() => setWeekOpen(!weekOpen)}>
              {weekOpen ? 'Show less' : `Show ${week.length - WEEK_SHOWN} more this week`}
            </button>
          )}
        </section>
      )}
      {streams.length > 0 && (
        <section aria-labelledby="today-side-streams">
          <h2 id="today-side-streams" className="today-side-label">
            Livestreams
          </h2>
          <ul>
            {streams.map(({ event, estimated }) => (
              <SideRow
                key={event.id}
                game={games.get(event.gameId)!}
                event={event}
                diamond
                sub={
                  event.start <= now
                    ? 'On now'
                    : estimated
                      ? `Predicted ${at(event.start, 'd LLL')} to ${at(event.end, 'd LLL')}`
                      : at(event.start, 'ccc d LLL · HH:mm')
                }
                right={event.start <= now ? 'Live' : shortLeft(event.start - now, estimated)}
              />
            ))}
          </ul>
        </section>
      )}
      {starting.length > 0 && (
        <section aria-labelledby="today-side-starting">
          <h2 id="today-side-starting" className="today-side-label">
            {allTomorrow ? 'Starting tomorrow' : 'Starting soon'}
          </h2>
          <ul>
            {starting.map((event) => (
              <SideRow
                key={event.id}
                game={games.get(event.gameId)!}
                event={event}
                sub={`${TYPE_WORD[event.type] ?? 'Event'} · ${at(event.start, 'ccc HH:mm')} to ${at(event.end, 'd LLL')}`}
                right={shortLeft(event.start - now)}
              />
            ))}
          </ul>
        </section>
      )}
      <TodayCodes games={state.games} now={now} />
    </aside>
  );
}
