import type { Game } from '@memoria/shared';
import { GamePullsView } from '../History';

/** One game's savings, pity and version history. */
export function GamePulls({ game }: { game: Game }) {
  return <GamePullsView key={game.id} game={game} />;
}
