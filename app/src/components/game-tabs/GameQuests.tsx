import type { Game } from '@memoria/shared';
import { GameQuestsView } from '../Quests';

/** One game's story progress. */
export function GameQuests({ game }: { game: Game }) {
  return <GameQuestsView key={game.id} game={game} />;
}
