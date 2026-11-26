import type { ReactNode } from 'react';
import { useApp } from '../store';
import { useUI } from '../ui-store';
import { gameServerLabel } from '../server-choice';
import { GameLogo } from './GameLogo';
import { rosterGames, useIdentityColors } from './roster';
import { Tooltip } from './ui';
import '../game-scope.css';

/** One game at a time, chosen by its owner: Notes' filter. Pressing the chosen one again lets it go. */
export interface GameScopePick {
  /** The game shown, or null for every game (or for a lead option outside the roster). */
  chosen: string | null;
  onPick: (gameId: string | null) => void;
  /** Says what pressing a game does, for its tip. */
  verb: string;
}

/**
 * A logo per game, in the rail's order. On the Calendar each is pressed to hide
 * or show that game, its own choice for the session that opening a game never
 * changes. Given `pick`, it chooses one game at a time instead (Notes), with
 * any `lead` options (General) before the games.
 */
export function GameScope({
  id,
  className = '',
  label = 'Games shown',
  pick,
  lead,
}: {
  id?: string;
  className?: string;
  label?: string;
  pick?: GameScopePick;
  lead?: ReactNode;
}) {
  const games = useApp((s) => s.state.games);
  const hidden = useUI((s) => s.timelineHiddenGameIds);
  const toggle = useUI((s) => s.toggleTimelineGame);
  const colors = useIdentityColors(games);
  const roster = rosterGames(games);
  if (roster.length < (lead ? 1 : 2)) return null;
  return (
    <div
      id={id}
      role="group"
      aria-label={label}
      className={`calendar-games ${className}`}
      data-pick={pick ? '' : undefined}
    >
      {lead}
      {roster.map((game) => {
        const pressed = pick ? pick.chosen === game.id : !hidden.includes(game.id);
        const account = game.accountLabel?.trim();
        const short = `${game.name}${account ? `, ${account}` : ''}`;
        const name = `${game.name}, ${gameServerLabel(game, Date.now())}${account ? `, ${account}` : ''}`;
        const tip = pick
          ? pressed
            ? `Show every game's ${pick.verb}`
            : `Show only ${short}`
          : `${pressed ? 'Hide' : 'Show'} ${short}`;
        return (
          <Tooltip key={game.id} content={tip}>
            <button
              type="button"
              className="calendar-game-toggle"
              aria-pressed={pressed}
              aria-label={name}
              onClick={() => (pick ? pick.onPick(pressed ? null : game.id) : toggle(game.id))}
            >
              <GameLogo game={{ ...game, ...colors[game.id] }} size={30} />
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}
