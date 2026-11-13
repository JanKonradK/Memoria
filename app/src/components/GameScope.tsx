import { useApp } from '../store';
import { useUI } from '../ui-store';
import { Select } from './ui';
import { gameServerLabel } from '../server-choice';

/** The Timeline's game filter: its own choice, all games until changed, never set by opening a game. */
export function GameScope() {
  const games = useApp((s) => s.state.games);
  const focused = useUI((s) => s.timelineGameId);
  const setFocused = useUI((s) => s.setTimelineGameId);
  const active = games.filter((game) => !game.deleted);
  const value = active.some((game) => game.id === focused) ? focused! : '';
  return (
    <label data-tour="focus" className="app-game-scope flex min-w-0 items-center text-meta text-muted">
      <span className="sr-only">Filter by game</span>
      <Select
        aria-label="Filter by game"
        className="!min-h-11 !w-full min-w-0 !py-1 md:!min-h-9"
        value={value}
        onChange={(event) => setFocused(event.target.value || null)}
      >
        <option value="">All games</option>
        {active.map((game) => (
          <option key={game.id} value={game.id}>
            {game.name} · {gameServerLabel(game, Date.now())}
            {game.accountLabel ? ` · ${game.accountLabel}` : ''}
          </option>
        ))}
      </Select>
    </label>
  );
}
