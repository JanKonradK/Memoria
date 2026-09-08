import { useApp } from '../store';
import { useUI } from '../ui-store';
import { Select } from './ui';
import { serverRegionLabel } from './NexusLayout';

/** One selection follows the player across Dashboard, Timeline and Settings. */
export function GameScope() {
  const games = useApp((s) => s.state.games);
  const focused = useUI((s) => s.focusedGameId);
  const setFocused = useUI((s) => s.setFocusedGameId);
  const active = games.filter((game) => !game.deleted);
  const value = active.some((game) => game.id === focused) ? focused! : '';
  return (
    <label data-tour="focus" className="app-game-scope flex min-w-0 items-center text-meta text-muted">
      <span className="sr-only">Focus game</span>
      <Select
        aria-label="Focus game"
        className="!min-h-9 !w-full min-w-0 !py-1"
        value={value}
        onChange={(event) => setFocused(event.target.value || null)}
      >
        <option value="">All games</option>
        {active.map((game) => (
          <option key={game.id} value={game.id}>
            {game.name} · {serverRegionLabel(game.tz, Date.now())}
            {game.accountLabel ? ` · ${game.accountLabel}` : ''}
          </option>
        ))}
      </Select>
    </label>
  );
}
