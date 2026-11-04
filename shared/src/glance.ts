import type { AppState, Game } from './types';
import { projectEnergy } from './energy';
import { effectiveResourceKind } from './tracking';
import { buildUrgencyContext, type UrgencyContext } from './urgency';

/** What one game needs right now, small enough for a notification or a widget row. */
export interface GameGlance {
  name: string;
  /** Regenerating meters that have a reading, in the game's own order. */
  energy: { name: string; value: number; cap: number; regenMinutes: number; isFull: boolean; fullAt: number | null }[];
  /** Unfinished tasks in the current period. */
  left: { daily: number; weekly: number };
}

export function gameGlance(state: AppState, game: Game, now: number, ctx?: UrgencyContext): GameGlance {
  const context = ctx ?? buildUrgencyContext(state, now, game);
  const energy: GameGlance['energy'] = [];
  const resources = [...(context.resourcesByGame.get(game.id) ?? [])].sort((a, b) => a.sort - b.sort);
  for (const resource of resources) {
    if (resource.deleted || effectiveResourceKind(resource) !== 'regen') continue;
    const projection = projectEnergy(resource, context.snaps.get(resource.id), now, game);
    if (!projection.hasSnapshot) continue;
    energy.push({
      name: resource.name,
      value: projection.value,
      cap: resource.cap,
      regenMinutes: resource.regenMinutes,
      isFull: projection.isFull,
      fullAt: projection.fullAt,
    });
  }
  const left = { daily: 0, weekly: 0 };
  for (const item of context.checklistByGame.get(game.id) ?? [])
    if (!item.done && (item.cadence === 'daily' || item.cadence === 'weekly')) left[item.cadence]++;
  return { name: game.accountLabel ? `${game.name} (${game.accountLabel})` : game.name, energy, left };
}

/** "3h 05m", "2d 4h", "12m". */
export function shortDuration(ms: number): string {
  const minutes = Math.max(1, Math.floor(ms / 60_000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${String(minutes % 60).padStart(2, '0')}m`;
  return `${minutes}m`;
}

/** One line: "Original Resin 142/200, full in 7h 04m · 3 dailies left". */
export function glanceLine(glance: GameGlance, now: number): string {
  const parts = glance.energy.map((meter) => {
    const reading = `${meter.name} ${meter.value}/${meter.cap}`;
    if (meter.isFull) return `${reading}, full`;
    return meter.fullAt != null ? `${reading}, full in ${shortDuration(meter.fullAt - now)}` : reading;
  });
  const { daily, weekly } = glance.left;
  if (daily) parts.push(`${daily} ${daily === 1 ? 'daily' : 'dailies'} left`);
  if (weekly) parts.push(`${weekly} ${weekly === 1 ? 'weekly' : 'weeklies'} left`);
  return parts.length ? parts.join(' · ') : 'All done for today.';
}
