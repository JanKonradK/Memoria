import { nextDailyReset, type NextAction } from '@memoria/shared';
import type { Derived } from './selectors';

export interface AllClear {
  /** The earliest next daily reset among the games being tracked. */
  until: number;
  /** The soonest thing still ahead, if any game has one. */
  next: (NextAction & { gameName: string }) | null;
}

/**
 * Every daily in every active game is ticked and no energy caps before the next
 * reset. Null otherwise, and with no active games: an empty list is not a win.
 */
export function selectAllClear({ order, checklistByGame, primaryEnergy, now }: Derived): AllClear | null {
  const active = order.filter((entry) => !entry.game.paused);
  if (active.length === 0) return null;
  const until = Math.min(...active.map((entry) => nextDailyReset(entry.game, now)));
  for (const { game } of active) {
    if ((checklistByGame.get(game.id) ?? []).some((item) => item.cadence === 'daily' && !item.done)) return null;
    const { projection } = primaryEnergy(game.id);
    if (projection?.isFull || (projection?.fullAt != null && projection.fullAt <= until)) return null;
  }
  // Nothing to clear is not the same as clearing it.
  if (!active.some(({ game }) => (checklistByGame.get(game.id) ?? []).some((item) => item.cadence === 'daily'))) {
    return null;
  }
  let next: AllClear['next'] = null;
  for (const { game, next: action } of active) {
    if (action && action.at > now && (!next || action.at < next.at)) next = { ...action, gameName: game.name };
  }
  return { until, next };
}
