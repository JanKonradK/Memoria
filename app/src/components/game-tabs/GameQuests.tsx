import type { Game } from '@memoria/shared';
import { QuestsPage } from '../Quests';

/** One game's story progress. */
export function GameQuests({ game }: { game: Game }) {
  return <QuestsPage key={game.id} />;
}
