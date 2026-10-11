import { eventParts, eventPartsDone, setEventPartsDone, type GameEvent } from '@memoria/shared';
import { calendarSchedule } from '../event-schedule';
import { useNow } from '../hooks';
import { useApp } from '../store';
import { useUI } from '../ui-store';
import { endTone, fmtDur } from '../util';
import { gameInk } from '../game-color';
import { titleStyle } from '../fonts';
import { useGround } from '../theme';
import { EventTags } from './EventTags';
import { GameLogo } from './GameLogo';
import { useIdentityColors } from './roster';
import { Sheet } from './Sheet';
import { Btn, TOUCH_BUTTON } from './ui';
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
  const state = useApp((store) => store.state);
  const closeSheet = useUI((ui) => ui.closeSheet);
  const openSheet = useUI((ui) => ui.openSheet);
  const identityColors = useIdentityColors(state.games);
  const event = state.events.find((item) => item.id === eventId && !item.deleted);
  const game = event && state.games.find((item) => item.id === event.gameId && !item.deleted);

  if (!event || !game) {
    return (
      <Sheet open={open} onClose={closeSheet} title="Event">
        <p className="text-body text-muted">This event is no longer available.</p>
      </Sheet>
    );
  }

  const visualGame = { ...game, ...(identityColors[game.id] ?? {}) };
  const ink = gameInk(visualGame, ground);
  const total = eventParts(event);
  const ticked = eventPartsDone(event);
  const setParts = (count: number) =>
    useApp.getState().upsertEvent({ id: event.id, gameId: event.gameId, ...setEventPartsDone(event, count) });
  const calendar = calendarSchedule(event);
  const upcoming = event.start > now;
  const ended = event.end <= now;
  const remaining = upcoming ? event.start - now : event.end - now;

  return (
    <Sheet
      open={open}
      onClose={closeSheet}
      title={event.name}
      footer={
        <div className="event-peek-actions">
          <Btn
            className={TOUCH_BUTTON}
            onClick={() => openSheet({ kind: 'event', eventId: event.id, gameId: event.gameId })}
          >
            Edit
          </Btn>
          <Btn
            className={`${TOUCH_BUTTON} ml-auto inline-flex items-center gap-2`}
            aria-pressed={Boolean(event.pinned)}
            onClick={() => togglePinned(event)}
          >
            <PinMark className="h-4 w-4" />
            {event.pinned ? 'Pinned' : 'Pin'}
          </Btn>
          <Btn
            kind="primary"
            className={TOUCH_BUTTON}
            aria-pressed={Boolean(event.done)}
            onClick={() => setParts(event.done ? 0 : total)}
          >
            {event.done ? 'Done — undo' : 'Mark done'}
          </Btn>
        </div>
      }
    >
      <div className="event-peek" style={{ '--game-ink': ink } as React.CSSProperties}>
        <div className="flex min-w-0 items-center gap-3">
          <GameLogo game={visualGame} size={56} flippable />
          <div className="min-w-0">
            <p className="truncate text-body" style={{ ...titleStyle(game.titleFont), color: ink }}>
              {game.name}
            </p>
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-muted">
              <span className="aside">{event.type}</span>
              <EventTags game={game} event={event} />
              {event.dailyTouch && <span className="aside">daily check-in</span>}
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
          <span className="aside text-meta text-muted">
            {ended ? '' : upcoming ? 'until it starts' : 'left'}
            {calendar ? ` · ${calendar.label}` : ''}
          </span>
        </p>

        {total > 1 && (
          <div>
            <div role="group" aria-label={`${event.name}: ${ticked} of ${total} parts done`} className="event-parts">
              {Array.from({ length: total }, (_, index) => (
                <button
                  key={index}
                  type="button"
                  aria-pressed={index < ticked}
                  aria-label={`${event.name}: part ${index + 1} of ${total}`}
                  onClick={() => setParts(index + 1 === ticked ? index : index + 1)}
                  className="event-part"
                />
              ))}
            </div>
            <p className="aside text-caption text-muted">
              <span className="numeral">
                {ticked} of {total}
              </span>{' '}
              parts done
            </p>
          </div>
        )}

        {event.notes.trim() && <p className="event-peek-notes text-meta text-fg-soft">{event.notes}</p>}
      </div>
    </Sheet>
  );
}
