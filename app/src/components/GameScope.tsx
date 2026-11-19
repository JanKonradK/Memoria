import { useApp } from '../store';
import { useUI } from '../ui-store';
import { gameServerLabel } from '../server-choice';
import { GameLogo } from './GameLogo';
import { rosterGames, useIdentityColors } from './roster';

/**
 * The Calendar's game filter: a logo per game, pressed to hide or show that
 * game. Its own choice for the session; opening a game never changes it.
 */
export function GameScope({ id, className = '' }: { id?: string; className?: string }) {
  const games = useApp((s) => s.state.games);
  const hidden = useUI((s) => s.timelineHiddenGameIds);
  const toggle = useUI((s) => s.toggleTimelineGame);
  const colors = useIdentityColors(games);
  const roster = rosterGames(games);
  if (roster.length < 2) return null;
  return (
    <div id={id} role="group" aria-label="Games shown" className={`calendar-games ${className}`}>
      {roster.map((game) => {
        const shown = !hidden.includes(game.id);
        const account = game.accountLabel?.trim();
        const name = `${game.name}, ${gameServerLabel(game, Date.now())}${account ? `, ${account}` : ''}`;
        return (
          <button
            key={game.id}
            type="button"
            className="calendar-game-toggle"
            aria-pressed={shown}
            aria-label={name}
            title={`${shown ? 'Hide' : 'Show'} ${game.name}${account ? `, ${account}` : ''}`}
            onClick={() => toggle(game.id)}
          >
            <GameLogo game={{ ...game, ...colors[game.id] }} size={30} />
          </button>
        );
      })}
    </div>
  );
}
