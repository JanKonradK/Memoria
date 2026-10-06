import { useState } from 'react';
import { DateTime } from 'luxon';
import type { Game } from '@memoria/shared';
import { useApp } from '../store';
import { useUI } from '../ui-store';
import { sortTimelineEvents } from '../timeline-sort';
import { groupGameEvents } from '../event-category';
import { calendarSchedule } from '../event-schedule';
import { EventTags } from './EventTags';
import { Btn, Field, Segmented, TextInput, TOUCH_BUTTON } from './ui';

/** Complete event management, independent of the card's visible events widget. */
export function GameEvents({ game, now, onBeforeOpen }: { game: Game; now: number; onBeforeOpen?: () => boolean }) {
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

  return (
    <section className="mt-4 border-y border-line-edge py-4" aria-label={`Events for ${game.name}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 tabIndex={-1} className="text-body font-semibold text-fg">
          Events
        </h3>
        <Btn className={TOUCH_BUTTON} onClick={() => openEvent()}>
          Add event
        </Btn>
      </div>
      <p className="mb-3 mt-1 text-meta text-muted">
        Open an event to change its name, type, dates, or check-in rules, or delete it.
      </p>
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
        <div className="mt-3">
          <Field label="Find event">
            <TextInput type="search" value={query} onChange={(event) => setQuery(event.target.value)} />
          </Field>
        </div>
      )}
      <div className="mt-3 max-h-96 overflow-y-auto overscroll-contain">
        {shown.length === 0 ? (
          <p className="py-2 text-meta text-muted">
            {match
              ? 'No events match this name.'
              : filter === 'finished'
                ? 'No finished events.'
                : 'No events in this view.'}
          </p>
        ) : (
          groupGameEvents(game, shown).map((group) => (
            <section key={group.key} className="mt-4 first:mt-0" aria-label={`${group.label} event management`}>
              {group.key !== 'events' && <h4 className="mb-1 text-meta font-semibold text-muted">{group.label}</h4>}
              <ul className="divide-y divide-line-hairline">
                {group.events.map((event) => {
                  const calendar = calendarSchedule(event);
                  return (
                    <li key={event.id}>
                      <button
                        type="button"
                        className="flex min-h-11 w-full items-center gap-3 rounded-ui-md px-2 py-3 text-left transition hover:bg-fill-2"
                        aria-label={`Edit ${game.name} event: ${event.name}`}
                        onClick={() => openEvent(event.id)}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block break-words text-body font-semibold text-fg-soft">{event.name}</span>
                          <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-label text-muted">
                            <span>{event.type}</span>
                            <EventTags game={game} event={event} />
                            <span>
                              {event.done
                                ? 'Done'
                                : event.end <= now
                                  ? 'Ended'
                                  : event.start > now
                                    ? 'Upcoming'
                                    : 'Active'}
                            </span>
                            {event.dailyTouch && <span>Daily check-in</span>}
                            {!event.notify && <span>Next actions off</span>}
                          </span>
                          <span className="mt-1 block text-label text-muted">
                            {calendar ? (
                              `${calendar.label} (${calendar.zone})`
                            ) : (
                              <>
                                Ends{' '}
                                {DateTime.fromMillis(event.end, { zone: state.settings.localTz }).toFormat(
                                  'd LLL yyyy, HH:mm',
                                )}
                              </>
                            )}
                          </span>
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
