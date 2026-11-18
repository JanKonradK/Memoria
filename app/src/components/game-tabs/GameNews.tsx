import type { Game } from '@memoria/shared';
import { CatchUpView } from '../CatchUp';

/** What the game's recent versions added, its livestreams and codes. */
export function GameNews({ game, now }: { game: Game; now: number }) {
  return <CatchUpView key={game.id} game={game} now={now} />;
}
