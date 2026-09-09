import { useMemo } from 'react';
import type { Game } from '@memoria/shared';
import { resolveGameIdentityColors, type GameColors } from '../game-color';

/**
 * The live roster in the user's own order — the list every picker shows.
 *
 * Soft deletes stay in the state so a sync can resolve them, so "the games" is
 * never `state.games`; four sheets and pages were each spelling the same filter
 * and sort out by hand.
 */
export function rosterGames(games: readonly Game[]): Game[] {
  return games.filter((game) => !game.deleted).sort((a, b) => a.sort - b.sort);
}

/**
 * Identity colours for the live roster, keyed by game id.
 *
 * Resolution is a pass across ALL games — two accounts of one game must land on
 * one trio — so every caller has to hand in the whole roster rather than the
 * subset it happens to render. Memoized on the array the store owns, which is
 * why the deleted filter lives inside: filtering at the call site would build a
 * new array on every render and the memo would never hit.
 */
export function useIdentityColors(games: readonly Game[]): Record<string, GameColors> {
  return useMemo(() => resolveGameIdentityColors(games.filter((game) => !game.deleted)), [games]);
}
