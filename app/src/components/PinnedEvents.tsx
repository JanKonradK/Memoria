import { useMemo } from 'react';
import type { Game, GameEvent } from '@memoria/shared';
import { gameTitleInk } from '../game-color';
import { useGround } from '../theme';
import { fmtDur } from '../util';
import { useIdentityColors } from './roster';
import { PinMark } from './EventPeek';
import '../today.css';
import '../pinned.css';

/**
 * The pinned events that need you, nearest first: running ones by their deadline,
 * then the ones still to arrive by their start. Ties settle on name and id, so the
 * strip holds its order between ticks instead of reshuffling.
 */
export function pinnedEventsNeedingYou(events: readonly GameEvent[], games: readonly Game[], now: number): GameEvent[] {
  // Paused and deleted games never show their events, so they stay out of the strip too.
  const open = new Set(games.filter((game) => !game.deleted && !game.paused).map((game) => game.id));
  const pinned = events.filter(
    (event) => event.pinned && !event.deleted && !event.done && event.end > now && open.has(event.gameId),
  );
  const settle = (a: GameEvent, b: GameEvent) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
  const running = pinned.filter((event) => event.start <= now).sort((a, b) => a.end - b.end || settle(a, b));
  const upcoming = pinned.filter((event) => event.start > now).sort((a, b) => a.start - b.start || settle(a, b));
  return [...running, ...upcoming];
}

export interface PinnedEventsProps {
  /** The events the page shows, already narrowed by its game filter and search. */
  events: readonly GameEvent[];
  /** The games in scope. Paused and deleted games are filtered again so the strip can be tested alone. */
  games: readonly Game[];
  now: number;
  /** The quick-view opener a timeline bar uses, so a chip and a bar open the same view. */
  onOpen: (event: GameEvent) => void;
}

/** Pinned events above the Calendar's views, so a marked event is found without scrolling a lane. */
export function PinnedEvents({ events, games, now, onOpen }: PinnedEventsProps) {
  const ground = useGround();
  const identityColors = useIdentityColors(games);
  const gamesById = useMemo(() => new Map(games.map((game) => [game.id, game])), [games]);
  const pinned = useMemo(() => pinnedEventsNeedingYou(events, games, now), [events, games, now]);
  if (pinned.length === 0) return null;

  return (
    <section aria-label="Pinned events" className="pinned-events">
      <div className="today-group-rule">
        <h2 className="text-meta font-semibold text-fg-soft">
          <PinMark className="mr-1.5 inline h-3.5 w-3.5 align-[-0.1em]" />
          Pinned
        </h2>
        <span aria-hidden />
        <span className="numeral aside text-caption text-muted">{pinned.length}</span>
      </div>
      <div className="flex flex-wrap gap-2 px-2">
        {pinned.map((event) => {
          const game = gamesById.get(event.gameId);
          if (!game) return null;
          const colors = identityColors[game.id] ?? game;
          const running = event.start <= now;
          const remaining = running ? event.end - now : event.start - now;
          return (
            <button
              key={event.id}
              type="button"
              aria-label={`Open pinned ${game.name} event: ${event.name}`}
              onClick={() => onOpen(event)}
              className="pinned-chip inline-flex min-h-11 min-w-0 max-w-full items-center gap-2 px-3 text-meta md:min-h-8"
            >
              <span className="shrink-0 font-semibold" style={{ color: gameTitleInk(colors, ground, 4.5) }}>
                {game.short}
              </span>
              <span className="min-w-0 max-w-[28ch] truncate text-fg">{event.name}</span>
              <span className="numeral shrink-0 whitespace-nowrap text-fg-soft">
                {running ? fmtDur(remaining) : `in ${fmtDur(remaining)}`}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
