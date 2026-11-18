import type { Game } from '@memoria/shared';
import { useUI } from '../../ui-store';
import { Btn } from '../ui';

/** What the game's recent versions added, its livestreams and codes. */
export function GameNews({ game }: { game: Game; now: number }) {
  const openSheet = useUI((s) => s.openSheet);
  return <Btn onClick={() => openSheet({ kind: 'catchUp', gameId: game.id })}>Catch up</Btn>;
}
