import { pityRulesFor, presetForGame, type AppState, type Game } from '@memoria/shared';
import { digestsForGame } from '../../data/catch-up';
import { nextBroadcast } from '../../catch-up-status';
import type { GameTab } from '../../ui-store';

/**
 * Games whose free currency per version is in `data/feed/history.json`. The file
 * itself loads only with the Pulls tab, so the list is kept here; a unit test
 * holds it to the file.
 */
export const VERSION_HISTORY_GAMES: readonly string[] = [
  'genshin',
  'hsr',
  'zzz',
  'wuwa',
  'nte',
  'endfield',
  'crumble',
  'uma',
  'nikke',
  'lads',
];

/** Only the file names: the catalogs themselves stay in their own chunks until Quests opens. */
const QUEST_CATALOGS = new Set(
  Object.keys(import.meta.glob('../../data/quests/*.json')).map((path) => path.replace(/^.*\/|\.json$/g, '')),
);

/**
 * Which of a game's tabs it has anything for. Track and Events always exist.
 * Pulls needs version history or pity rules, Quests a researched catalog, and
 * News version notes or a livestream on the calendar.
 */
export function gameTabAvailable(
  game: Game,
  tab: GameTab,
  { state, now }: { state: Pick<AppState, 'events'>; now: number },
): boolean {
  if (tab === 'track' || tab === 'events') return true;
  const preset = game.presetKey ?? presetForGame(game)?.key;
  if (tab === 'pulls') return !!preset && (VERSION_HISTORY_GAMES.includes(preset) || pityRulesFor(preset).length > 0);
  if (tab === 'quests') return !!preset && QUEST_CATALOGS.has(preset);
  return digestsForGame(preset).length > 0 || nextBroadcast(state, game.id, now) != null;
}
