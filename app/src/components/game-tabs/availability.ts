import { presetForGame, type Game } from '@memoria/shared';
import type { GameTab } from '../../ui-store';

/**
 * Which of a game's tabs it has anything for. Track and Events always exist;
 * Pulls, Quests and News draw on a preset's researched data.
 */
export function gameTabAvailable(game: Game, tab: GameTab): boolean {
  if (tab === 'track' || tab === 'events') return true;
  return presetForGame(game) != null;
}
