import type { Game } from '@memoria/shared';
import { PullsPage } from '../History';

/** One game's savings, pity and version history. */
export function GamePulls({ game }: { game: Game }) {
  return <PullsPage key={game.id} />;
}
