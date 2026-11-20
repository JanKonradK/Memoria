import '../today.css';
import './game-tabs/game-tabs.css';
import { useState } from 'react';
import { DateTime } from 'luxon';
import type { Game } from '@memoria/shared';
import { useApp } from '../store';
import { useUI } from '../ui-store';
import { sortTimelineEvents } from '../timeline-sort';
import { groupGameEvents } from '../event-category';
import { calendarSchedule } from '../event-schedule';
import { fmtDur } from '../util';
import { EventTags } from './EventTags';
import { CalendarBehindNote } from './CalendarBehind';
import { Btn, Segmented, TextInput, TOUCH_BUTTON } from './ui';

/** Every event of one game, to add, find and edit. It sits on the page, under one toolbar. */
export function GameEvents({
  game,
  now,
  onBeforeOpen,
  className = '',
  titled = false,
}: {
  game: Game;
  now: number;
  onBeforeOpen?: () => boolean;
  className?: string;
  /** Show the Events heading; a game's Events tab already names it. */
  titled?: boolean;
}) {
  const state = useApp((store) => store.state);
  const openSheet = useUI((store) => store.openSheet);
  const openEvent = (eventId?: string) => {
    if (onBeforeOpen && !onBeforeOpen()) return;
    openSheet({ kind: 'event', gameId: game.id, ...(eventId ? { eventId } : {}) });
  };
  const [filter, setFilter] = useState('current');
  const [query, setQuery] = useState('');
  const events = sortTimelineEvents(state.events.filter((event) => event.gameId === game.id && !event.deleted));
  const finished = events.filter((event) => event.done || event.end <= now).length;
  const match = query.trim().toLocaleLowerCase();
  const shown = events.filter((event) => {
    const isFinished = event.done || event.end <= now;
    return (
      (filter === 'all' || (filter === 'finished' ? isFinished : !isFinished)) &&
      (!match || event.name.toLocaleLowerCase().includes(match))
    );
  });
  const zone = state.settings.localTz;

  return (
    <section className={className} aria-label={`Events for ${game.name}`}>
      <h2 tabIndex={-1} className={titled ? 'mb-3 text-body font-semibold text-fg' : 'sr-only'}>
        Events
      </h2>
      <div className="game-events-bar">
        <Segmented
          ariaLabel="Game event status"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'current', label: `Current (${events.length - finished})` },
            { value: 'finished', label: `Finished (${finished})` },
            { value: 'all', label: `All (${events.length})` },
          ]}
        />
        {events.length > 0 && (
          <TextInput
            type="search"
            aria-label="Find event"
            placeholder="Find event"
            className="game-events-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        )}
        <Btn kind="primary" className={`game-events-add ${TOUCH_BUTTON}`} onClick={() => openEvent()}>
          Add event
        </Btn>
      </div>
      <CalendarBehindNote gameId={game.id} now={now} className="mt-3" />
      <div className="mt-5">
        {shown.length === 0 ? (
          <p className="py-2 text-meta text-muted">
            {match ? 'No matches.' : filter === 'finished' ? 'No finished events.' : 'No events.'}
          </p>
        ) : (
          groupGameEvents(game, shown).map((group) => (
            <section key={group.key} className="mt-6 first:mt-0" aria-label={`${group.label} event management`}>
              <h3 className="tab-label">
                {group.label}
                <span className="tab-label-end numeral">{group.events.length}</span>
              </h3>
              <ul className="game-events-list">
                {group.events.map((event) => {
                  const calendar = calendarSchedule(event);
                  // Running or coming is said by its countdown; only an end needs a word.
                  const status = event.done ? 'Done' : event.end <= now ? 'Ended' : '';
                  const when = calendar
                    ? `${calendar.label} (${calendar.zone})`
                    : event.done || event.end <= now
                      ? `Ended ${DateTime.fromMillis(event.end, { zone }).toFormat('d LLL yyyy')}`
                      : event.start > now
                        ? `Starts in ${fmtDur(event.start - now)}`
                        : `Ends in ${fmtDur(event.end - now)}`;
                  return (
                    <li key={event.id}>
                      <button type="button" className="game-events-row" onClick={() => openEvent(event.id)}>
                        <span className="min-w-0">
                          <span
                            className={`block break-words text-body font-semibold ${event.done ? 'text-muted line-through' : 'text-fg-soft'}`}
                          >
                            <span className="sr-only">Edit {game.name} event:</span> {event.name}
                          </span>
                          {(status || event.dailyTouch || event.type !== 'event') && (
                            <span
                              className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-label text-muted"
                              aria-hidden
                            >
                              <EventTags game={game} event={event} />
                              {status && <span>{status}</span>}
                              {event.dailyTouch && <span>Daily check-in</span>}
                            </span>
                          )}
                        </span>
                        <span className="game-events-when numeral inline-flex items-center gap-1.5" aria-hidden>
                          {!event.notify && (
                            <span title="Not on Today or in reminders" className="inline-flex items-center">
                              <svg
                                viewBox="0 0 20 20"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.6"
                                className="h-4 w-4"
                                aria-hidden
                              >
                                <path
                                  d="M5.5 8.5a4.5 4.5 0 0 1 7.6-3.2M14.5 8.5c0 4 1.5 5.5 1.5 5.5H6M8.5 16.5a1.7 1.7 0 0 0 3 0M3.5 3.5l13 13"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                />
                              </svg>
                              <span className="sr-only">Not on Today or in reminders</span>
                            </span>
                          )}
                          {calendar ? (
                            when
                          ) : (
                            <span title={DateTime.fromMillis(event.end, { zone }).toFormat('d LLL yyyy, HH:mm')}>
                              {when}
                            </span>
                          )}
                        </span>
                        <svg
                          viewBox="0 0 20 20"
                          fill="none"
                          stroke="currentColor"
                          className="icon h-4 w-4 shrink-0 text-muted"
                          aria-hidden
                        >
                          <path
                            d="M13.3 3.7a1.7 1.7 0 0 1 2.4 2.4L7.4 14.4 4 15l.6-3.4z"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))
        )}
      </div>
    </section>
  );
}
