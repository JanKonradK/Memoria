import type { Game, Resource, Snapshot } from './types';
import { measuredSnapshot, projectEnergy, type EnergyProjection } from './energy';
import { effectiveResourceKind } from './tracking';

/**
 * A stamina bar's banked stock: what holds on to energy the bar cannot.
 *
 * Two shapes exist in the wild, and the player thinks of both as one thing:
 * - a reserve on the bar itself, filling while the bar sits at cap (Reserved
 *   Trailblaze Power, Backup Battery Charge, Waveplate Crystals, Photo Paper
 *   Supply);
 * - a counter beside it that the player crafts by spending the bar (Condensed
 *   Resin beside Original Resin).
 */
export interface EnergyBank {
  kind: 'reserve' | 'counter';
  /** The resource that holds the figure: the bar itself for a reserve, the counter otherwise. */
  resourceId: string;
  label: string;
  /** null until the player has read it. */
  value: number | null;
  cap: number;
  full: boolean;
  /** A reserve's fill moment while the bar sits at cap; null otherwise. */
  fullAt: number | null;
}

const lastWord = (name: string) =>
  name
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .at(-1)
    ?.replace(/[^\p{L}\p{N}]/gu, '') ?? '';

/**
 * The counter that banks a bar, when it has no reserve of its own: a manual
 * counter of the same game named for the same stuff, as "Condensed Resin" is
 * for "Original Resin". Names alone pair them, so nothing needs migrating.
 */
export function bankCounterOf(main: Resource, siblings: readonly Resource[]): Resource | undefined {
  if (main.reserveCap > 0 || effectiveResourceKind(main) !== 'regen') return undefined;
  const word = lastWord(main.name);
  if (word.length < 3) return undefined;
  return siblings
    .filter(
      (item) =>
        item.id !== main.id &&
        item.gameId === main.gameId &&
        !item.deleted &&
        item.cap > 0 &&
        effectiveResourceKind(item) === 'counter' &&
        lastWord(item.name) === word,
    )
    .sort((a, b) => a.sort - b.sort)[0];
}

/** The ids of counters that live inside a bar's row, so they are not shown again on their own. */
export function bankedCounterIds(resources: readonly Resource[]): Set<string> {
  const ids = new Set<string>();
  for (const res of resources) {
    if (res.deleted) continue;
    const counter = bankCounterOf(res, resources);
    if (counter) ids.add(counter.id);
  }
  return ids;
}

/**
 * The bank of one bar, read from its projection (a reserve) or its counter's
 * latest reading. `snaps` is the latest snapshot per resource id.
 */
export function energyBank(
  main: Resource,
  projection: EnergyProjection,
  siblings: readonly Resource[],
  snaps: ReadonlyMap<string, Snapshot>,
  now: number,
  game?: Pick<Game, 'tz' | 'dailyResetHour' | 'weeklyResetDay' | 'monthlyResetDay'>,
): EnergyBank | null {
  if (main.reserveCap > 0) {
    const raw = projection.reserve ?? snaps.get(main.id)?.reserve;
    const value = projection.hasSnapshot ? Math.max(0, Math.min(main.reserveCap, raw ?? 0)) : null;
    return {
      kind: 'reserve',
      resourceId: main.id,
      label: main.reserveLabel?.trim() || 'Reserve',
      value,
      cap: main.reserveCap,
      full: value != null && value >= main.reserveCap,
      fullAt: value != null && value < main.reserveCap ? (projection.reserveFullAt ?? null) : null,
    };
  }
  const counter = bankCounterOf(main, siblings);
  if (!counter) return null;
  const counted = projectEnergy(counter, measuredSnapshot(counter, snaps.get(counter.id)), now, game);
  const value = counted.hasSnapshot ? counted.value : null;
  return {
    kind: 'counter',
    resourceId: counter.id,
    label: counter.name,
    value,
    cap: counter.cap,
    full: value != null && value >= counter.cap,
    fullAt: null,
  };
}
