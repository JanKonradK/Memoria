import { useEffect } from 'react';
import { DateTime } from 'luxon';
import {
  endsOvernight,
  lastPlayDay,
  morningOf,
  eventReward,
  EVENT_PROGRESS_LABEL,
  eventProgress,
  type EventProgress,
  type GameEvent,
} from '@memoria/shared';
import { calendarSchedule } from '../event-schedule';
import { useNow } from '../hooks';
import { useApp } from '../store';
import { useShallow } from 'zustand/react/shallow';
import { useUI } from '../ui-store';
import { endTone, fmtDur } from '../util';
import { gameInk } from '../game-color';
import { useGround } from '../theme';
import { EventTags } from './EventTags';
import { NightMark } from './NightMark';
import { GameLogo } from './GameLogo';
import { useIdentityColors } from './roster';
import { Sheet, SheetFooter } from './Sheet';
import { Btn, Segmented } from './ui';
import '../event-peek.css';

/** A pin, drawn small beside a pinned event's name wherever it is listed. */
export function PinMark({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden
      className={`pin-mark icon shrink-0 ${className}`}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12.5 2.5 17.5 7.5 14 9l-1 4.5-6.5-6.5L11 6zM9.5 10.5 3 17" />
    </svg>
  );
}

/** Pinning marks an event as one you mean to do; it is highlighted and listed first. */
export function togglePinned(event: GameEvent): void {
  useApp.getState().upsertEvent({ id: event.id, gameId: event.gameId, pinned: !event.pinned });
}

/**
 * What opens when an event is chosen: what it is, how long is left, and the
 * things you do to an event far more often than editing it — tick it off, tick
 * off a part, pin it. The editor is one step further, for the times you need it.
 */
export function EventPeek({ open, eventId }: { open: boolean; eventId: string }) {
  const now = useNow(30_000);
  const ground = useGround();
  const state = useApp(
    useShallow((s) => ({ games: s.state.games, events: s.state.events, settings: s.state.settings })),
  );
  const closeSheet = useUI((ui) => ui.closeSheet);
  const openSheet = useUI((ui) => ui.openSheet);
  useEffect(() => {
    void import('./EventSheet');
  }, []);
  const identityColors = useIdentityColors(state.games);
  const event = state.events.find((item) => item.id === eventId && !item.deleted);
  const game = event && state.games.find((item) => item.id === event.gameId && !item.deleted);

  if (!event || !game) {
    return (
      <Sheet open={open} onClose={closeSheet} title="Event">
        <p className="text-body text-muted">This event was deleted.</p>
      </Sheet>
    );
  }

  const visualGame = { ...game, ...(identityColors[game.id] ?? {}) };
  const ink = gameInk(visualGame, ground);
  const progress = eventProgress(event);
  const setProgress = (next: EventProgress) => useApp.getState().setEventProgress(event.id, next);
  const calendar = calendarSchedule(event);
  const upcoming = event.start > now;
  const ended = event.end <= now;
  const zone = state.settings.localTz;
  const remaining = upcoming ? event.start - now : event.end - now;

  return (
    <Sheet
      open={open}
      onClose={closeSheet}
      title={event.name}
      footer={
        // Edit sits apart on the left; the two things you came to do are on the right, under the thumb.
        <SheetFooter
          start={<Btn onClick={() => openSheet({ kind: 'event', eventId: event.id, gameId: event.gameId })}>Edit</Btn>}
        >
          <Btn
            className="inline-flex items-center justify-center gap-2"
            aria-pressed={Boolean(event.pinned)}
            onClick={() => togglePinned(event)}
          >
            <PinMark className="h-4 w-4" />
            {event.pinned ? 'Pinned' : 'Pin'}
          </Btn>
          <Btn
            kind="primary"
            aria-pressed={Boolean(event.done)}
            onClick={() => {
              setProgress(event.done ? 'none' : 'done');
              // Marking done is the last thing you do here; undoing keeps the sheet open.
              if (!event.done) closeSheet();
            }}
          >
            {event.done ? 'Done — undo' : 'Mark done'}
          </Btn>
        </SheetFooter>
      }
    >
      <div className="event-peek" style={{ '--game-ink': ink } as React.CSSProperties}>
        <div className="flex min-w-0 items-center gap-3">
          <GameLogo game={visualGame} size={56} flippable />
          <div className="min-w-0">
            <p className="truncate text-body" style={{ color: ink }}>
              {game.name}
            </p>
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-muted">
              <EventTags game={game} event={event} />
              {event.dailyTouch && <span>Daily check-in</span>}
            </p>
          </div>
        </div>

        <p className="event-peek-time">
          <span
            className="numeral text-heading font-semibold"
            style={{ color: upcoming || ended ? undefined : endTone(remaining) }}
          >
            {ended ? 'Ended' : fmtDur(remaining)}
          </span>
          <span className="text-meta text-muted">
            {ended ? '' : upcoming ? 'until it starts' : 'left'}
            {calendar ? (
              ` · ${calendar.label}`
            ) : !ended ? (
              <>
                {' · '}
                {/* The last day it can be played: the night before an end in the small hours. */}
                {lastPlayDay(event.end, now, zone, morningOf(state.settings)).toFormat('ccc d LLL')}{' '}
                {endsOvernight(event.end, zone, morningOf(state.settings)) && <NightMark at={event.end} tz={zone} />}
                {DateTime.fromMillis(event.end, { zone }).toFormat('HH:mm')}
              </>
            ) : null}
          </span>
        </p>

        <Segmented
          ariaLabel={`${event.name} progress`}
          value={progress}
          onChange={setProgress}
          options={(['none', 'partial', 'done'] as const).map((value) => ({
            value,
            label: EVENT_PROGRESS_LABEL[value],
          }))}
        />

        {event.reward && game && (
          <p className="text-meta font-semibold text-fg">Pays {eventReward(event, game)?.label}</p>
        )}
        {event.notes.trim() && <p className="event-peek-notes text-meta text-fg-soft">{event.notes}</p>}
      </div>
    </Sheet>
  );
}
