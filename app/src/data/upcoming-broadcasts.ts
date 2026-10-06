import { parseServerDateTime, presetForGame, PRESETS, type AppState } from '@memoria/shared';
import { SEED_EVENTS } from './seed-feed';

export interface UpcomingBroadcast {
  id: string;
  game: string;
  gameName: string;
  gameId?: string;
  name: string;
  start: number;
  end: number;
  eventId?: string;
  predicted: boolean;
}

/** Owner edits and deletions take priority over the bundled broadcast calendar. */
export function upcomingBroadcasts(state: AppState, now: number): UpcomingBroadcast[] {
  const games = state.games.filter((game) => !game.deleted);
  const byId = new Map(games.map((game) => [game.id, game]));
  const tracked = new Set(games.map((game) => presetForGame(game)?.key));
  const broadcasts: UpcomingBroadcast[] = [];
  for (const event of state.events) {
    const game = byId.get(event.gameId);
    if (!game || event.deleted || event.done || event.type !== 'livestream' || event.end <= now) continue;
    broadcasts.push({
      id: event.id,
      game: presetForGame(game)?.key ?? game.id,
      gameName: game.accountLabel ? `${game.name} · ${game.accountLabel}` : game.name,
      gameId: game.id,
      name: event.name,
      start: event.start,
      end: event.end,
      eventId: event.id,
      predicted: event.name.includes('predicted window'),
    });
  }
  for (const seed of SEED_EVENTS) {
    if (seed.type !== 'livestream' || tracked.has(seed.game)) continue;
    const start = parseServerDateTime(seed.start, seed.startTimezone ?? seed.timezone ?? 'UTC+1');
    const end = parseServerDateTime(seed.end, seed.endTimezone ?? seed.timezone ?? 'UTC+1');
    if (start == null || end == null || end <= now) continue;
    broadcasts.push({
      id: seed.sourceKey,
      game: seed.game,
      gameName: PRESETS.find((preset) => preset.key === seed.game)?.name ?? seed.game,
      name: seed.name,
      start,
      end,
      predicted: seed.name.includes('predicted window'),
    });
  }
  return broadcasts.sort((a, b) => a.start - b.start || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}
