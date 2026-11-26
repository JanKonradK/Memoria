import { useMemo, type ReactNode } from 'react';
import { DateTime } from 'luxon';
import type { CalendarMoment, Game, GameEvent } from '@memoria/shared';
import { assignGameInks, gameTitleInk, type GameColors } from '../../game-color';
import { eventTitle } from '../../util';
import { eventBannerKind, eventCategory } from '../../event-category';
import { useGround } from '../../theme';
import { useIdentityColors } from '../roster';
import { GameLogo } from '../GameLogo';
import { Tick } from '../primitives';
import { Tooltip } from '../ui';
import type { SwipeAction } from '../../swipe-row';
import './calendar.css';

const BANNER_LABELS = { character: 'Character', weapon: 'Weapon', support: 'Support', memory: 'Memory' } as const;

/**
 * Two accounts of one game carry the same name and the same events, so a
 * control named from the event alone would be announced twice. The account
 * is what tells them apart.
 */
export function gameLabel(game: Game): string {
  const account = game.accountLabel?.trim();
  return account ? `${game.name} (${account})` : game.name;
}

/** The games the views draw, with the colour pass every lane and logo agree on. */
export function useCalendarGames(games: Game[]) {
  const ground = useGround();
  const identity = useIdentityColors(games);
  return useMemo(() => {
    const inks = assignGameInks(games, ground);
    const byId = new Map(games.map((game) => [game.id, game]));
    // An account name only tells rows apart when the player tracks one game twice.
    const kinds = new Map<string, number>();
    for (const game of games) kinds.set(game.presetKey ?? game.id, (kinds.get(game.presetKey ?? game.id) ?? 0) + 1);
    return {
      byId,
      /** The account's name where it tells two of one game apart, else nothing. */
      account: (game: Game) => ((kinds.get(game.presetKey ?? game.id) ?? 0) > 1 ? game.accountLabel?.trim() || '' : ''),
      /** Bars, dots and progress fills. */
      ink: (gameId: string) => inks[gameId] ?? 'var(--color-fg-soft)',
      /** The game's name as text, held to AA on the ground. */
      text: (game: Game) => gameTitleInk(identity[game.id] ?? game, ground, 5.2),
      visual: (game: Game): Game & GameColors => ({ ...game, ...(identity[game.id] ?? {}) }),
      /** Undefined for an event whose game is filtered out or paused: it leaves with its game. */
      gameOf: (event: GameEvent) => {
        const game = byId.get(event.gameId);
        return game && !game.paused ? game : undefined;
      },
    };
  }, [games, ground, identity]);
}

export type CalendarGames = ReturnType<typeof useCalendarGames>;

/**
 * What an event is, after the game: "Weapon banner", "cycle", "livestream". A
 * plain event says nothing; it is what a row is unless told otherwise.
 */
export function EventKind({ game, event }: { game?: Game; event: GameEvent }) {
  const world = eventCategory(game, event) === 'miliastra' && (
    <Tooltip content="Miliastra Wonderland">
      <span data-event-tag className="cal-tag">
        MW
      </span>
    </Tooltip>
  );
  if (event.type === 'banner') {
    const kind = eventBannerKind(event);
    const label = kind && kind !== 'other' ? BANNER_LABELS[kind] : undefined;
    return (
      <>
        {world}
        {label ? (
          <>
            <span data-event-tag>{label}</span> banner
          </>
        ) : (
          'banner'
        )}
      </>
    );
  }
  const words: Record<GameEvent['type'], string> = {
    banner: 'banner',
    event: '',
    cycle: 'cycle',
    custom: '',
    maintenance: 'maintenance',
    livestream: 'livestream',
  };
  return (
    <>
      {world}
      {words[event.type] || null}
    </>
  );
}

/** "45m", "6h", "1d 22h", "6d": the countdown beside a time, in the fewest characters. */
export function shortLeft(ms: number): string {
  if (ms <= 0) return 'now';
  const minutes = Math.ceil(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return days < 3 ? `${days}d ${hours % 24}h` : `${days}d`;
}

export function clock(at: number, tz: string): string {
  return DateTime.fromMillis(at, { zone: tz }).toFormat('HH:mm');
}

export { NightMark } from '../NightMark';

/** A day's heading: Today, Tomorrow, or its weekday, with the date beside it. */
export function dayTitle(start: number, now: number, tz: string): { title: string; date: string } {
  const day = DateTime.fromMillis(start, { zone: tz });
  const today = DateTime.fromMillis(now, { zone: tz }).startOf('day');
  const offset = Math.round(day.startOf('day').diff(today, 'days').days);
  const year = day.year !== today.year ? ' yyyy' : '';
  if (offset === 0) return { title: 'Today', date: day.toFormat(`cccc d LLLL${year}`) };
  if (offset === 1) return { title: 'Tomorrow', date: day.toFormat(`cccc d LLLL${year}`) };
  return { title: day.toFormat('cccc'), date: day.toFormat(`d LLLL${year}`) };
}

/** The mark in a row's icon column: the game's logo, a diamond for a livestream, a hatch for maintenance. */
export function MomentMark({
  event,
  game,
  games,
  size = 30,
}: {
  event: GameEvent;
  game: Game;
  games: CalendarGames;
  size?: number;
}) {
  if (event.type === 'livestream')
    return (
      <span className="cal-mark" style={{ width: size, height: size }} aria-hidden>
        <i className="cal-diamond" style={{ background: games.ink(game.id) }} />
      </span>
    );
  if (event.type === 'maintenance')
    return (
      <span className="cal-mark" style={{ width: size, height: size }} aria-hidden>
        <i className="cal-hatch" />
      </span>
    );
  return <GameLogo game={games.visual(game)} size={size} className="shrink-0" />;
}

/** A moment's swipes: right marks every event in it done, left takes them all back. */
export function momentSwipes(
  moment: CalendarMoment,
  onToggleEvent: (event: GameEvent) => void,
): { right: SwipeAction | null; left: SwipeAction | null } {
  const all = moment.events;
  const anyDone = all.some((event) => event.done);
  const allDone = all.every((event) => event.done);
  return {
    right: allDone
      ? null
      : {
          label: 'Done',
          run: () => {
            for (const event of all) if (!event.done) onToggleEvent(event);
          },
        },
    left: anyDone
      ? {
          label: 'Not done',
          run: () => {
            for (const event of all) if (event.done) onToggleEvent(event);
          },
        }
      : null,
  };
}

/**
 * The round tick at the end of a row. On a fold it ticks every event in it at
 * once, and undoes them all when every one is already done.
 */
export function MomentTick({
  moment,
  game,
  onToggleEvent,
  tz,
}: {
  moment: CalendarMoment;
  game: Game;
  onToggleEvent: (event: GameEvent) => void;
  tz: string;
}) {
  const all = moment.events;
  const done = all.every((event) => event.done);
  const lead = all[0]!;
  const label =
    all.length > 1
      ? `${done ? 'Completed — Restore' : 'Mark done'}: all ${all.length} ${gameLabel(game)} events ending ${clock(moment.at, tz)}`
      : `${done ? 'Completed — Restore' : 'Mark done'}: ${gameLabel(game)} event ${lead.name}`;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={done}
      aria-label={label}
      className="cal-tick group"
      onClick={() => {
        for (const event of all) if (done || !event.done) onToggleEvent(event);
      }}
    >
      <Tick color="var(--color-ok)" checked={done} className="cal-tick-ring" />
    </button>
  );
}

/** A row's name and its "game · kind" line; the kind is left out when there is none. */
export function MomentText({
  name,
  game,
  games,
  children,
  done,
  pinned,
  short = false,
}: {
  name: ReactNode;
  game: Game;
  games: CalendarGames;
  children: ReactNode;
  done?: boolean;
  pinned?: ReactNode;
  /** Always the game's short name, for a narrow column. A phone gets it anyway. */
  short?: boolean;
}) {
  const shortName = game.short.trim() || game.name;
  return (
    <span className="cal-text">
      <span className={`cal-name ${done ? 'cal-name-done' : ''}`}>
        {pinned}
        {typeof name === 'string' ? eventTitle(name) : name}
      </span>{' '}
      <span className="cal-sub">
        <span className="cal-game" style={{ color: games.text(game) }}>
          {short || shortName === game.name ? (
            shortName
          ) : (
            <>
              <span className="cal-game-full">{game.name}</span>
              <span className="cal-game-short">{shortName}</span>
            </>
          )}
        </span>
        {games.account(game) && <span className="cal-account"> {games.account(game)}</span>}
        {/* The separator is drawn by CSS, so a row with nothing to add ends at the game. */}
        <span className="cal-kind">{children}</span>
      </span>
    </span>
  );
}
