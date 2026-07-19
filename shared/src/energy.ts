import type { AppState, Game, Resource, Snapshot } from './types';
import { lastWeeklyReset, nextWeeklyReset } from './periods';
import { effectiveReserveRegenMinutes, effectiveResourceKind } from './tracking';

export interface EnergyProjection {
  /** Whole-point value right now, clamped to cap (unless snapshot was over cap). */
  value: number;
  /** Fractional value for smooth bar animation. */
  precise: number;
  isFull: boolean;
  /** Epoch ms when the resource hits cap; null if full, not regenerating, or unknown. */
  fullAt: number | null;
  /** Ms until full; 0 when full, null when not applicable. */
  msToFull: number | null;
  /** Points regenerated past cap since the snapshot (wasted regen). */
  overflow: number;
  hasSnapshot: boolean;
  /** Weekly-refill resources show when they reset to cap. */
  weeklyResetAt?: number | null;
  /** Projected reserve level — grows while the bar sits at cap; null when the resource has no reserve. */
  reserve?: number | null;
}

type EnergyResource = Pick<Resource, 'cap' | 'regenMinutes' | 'kind'> & {
  name?: string;
  reserveCap?: number;
  reserveRegenMinutes?: number;
};
type EnergyGame = Pick<Game, 'tz' | 'dailyResetHour' | 'weeklyResetDay' | 'monthlyResetDay'>;

function effectiveSnapshot(
  game: EnergyGame | undefined,
  res: EnergyResource,
  snap: Pick<Snapshot, 'value' | 'takenAt'>,
  now: number,
): Pick<Snapshot, 'value' | 'takenAt'> {
  if (effectiveResourceKind(res) !== 'weekly' || !game) return snap;
  const periodStart = lastWeeklyReset(game, now);
  if (snap.takenAt < periodStart) return { value: res.cap, takenAt: periodStart };
  return snap;
}

export function projectEnergy(
  res: EnergyResource,
  snap: Pick<Snapshot, 'value' | 'takenAt' | 'reserve'> | undefined,
  now: number,
  game?: EnergyGame,
): EnergyProjection {
  const kind = effectiveResourceKind(res);

  // Reserve (overflow) storage fills only while the bar sits at cap, at half
  // the main regen speed by default (2 × regenMinutes per point).
  const reserveSince = (capSince: number): number | null => {
    if (!res.reserveCap || res.reserveCap <= 0) return null;
    const base = snap?.reserve ?? 0;
    const perPointMs = effectiveReserveRegenMinutes(res) * 60_000;
    const gained = perPointMs > 0 ? Math.floor(Math.max(0, now - capSince) / perPointMs) : 0;
    return Math.min(res.reserveCap, base + gained);
  };

  if (!snap) {
    return {
      value: 0,
      precise: 0,
      isFull: false,
      fullAt: null,
      msToFull: null,
      overflow: 0,
      hasSnapshot: false,
      weeklyResetAt: kind === 'weekly' && game ? nextWeeklyReset(game, now) : undefined,
      reserve: null,
    };
  }

  const live = effectiveSnapshot(game, res, snap, now);

  if (kind === 'weekly') {
    const weeklyResetAt = game ? nextWeeklyReset(game, now) : null;
    return {
      value: live.value,
      precise: live.value,
      isFull: live.value >= res.cap,
      fullAt: null,
      msToFull: null,
      overflow: 0,
      hasSnapshot: true,
      weeklyResetAt,
      reserve: null,
    };
  }

  if (kind === 'counter' || res.regenMinutes <= 0) {
    return {
      value: live.value,
      precise: live.value,
      isFull: live.value >= res.cap,
      fullAt: null,
      msToFull: null,
      overflow: 0,
      hasSnapshot: true,
      reserve: null,
    };
  }

  const periodMs = res.regenMinutes * 60_000;
  if (live.value >= res.cap) {
    return {
      value: live.value,
      precise: live.value,
      isFull: true,
      fullAt: null,
      msToFull: 0,
      overflow: Math.floor(Math.max(0, now - live.takenAt) / periodMs),
      hasSnapshot: true,
      reserve: reserveSince(live.takenAt),
    };
  }
  const elapsed = Math.max(0, now - live.takenAt);
  const gained = elapsed / periodMs;
  const raw = live.value + Math.floor(gained);
  const value = Math.min(res.cap, raw);
  const fullAt = live.takenAt + (res.cap - live.value) * periodMs;
  const msToFull = Math.max(0, fullAt - now);
  return {
    value,
    precise: Math.min(res.cap, live.value + gained),
    isFull: value >= res.cap,
    fullAt,
    msToFull,
    overflow: Math.max(0, raw - res.cap),
    hasSnapshot: true,
    reserve: reserveSince(fullAt),
  };
}

export interface SleepCheck {
  /** Some resource hits cap within the sleep window (regen will be wasted). */
  caps: boolean;
  /** Earliest cap moment among regenerating resources; null if none applicable. */
  fullAt: number | null;
}

/** Would sleeping `sleepHours` from now waste regen in this game? */
export function sleepCheck(state: AppState, game: Game, sleepHours: number, now: number): SleepCheck {
  const snaps = latestSnapshots(state.snapshots);
  const horizon = now + sleepHours * 3_600_000;
  let fullAt: number | null = null;
  for (const res of state.resources.filter((r) => r.gameId === game.id && !r.deleted && r.regenMinutes > 0)) {
    const proj = projectEnergy(res, snaps.get(res.id), now);
    if (!proj.hasSnapshot) continue;
    const at = proj.isFull ? now : proj.fullAt;
    if (at != null && at <= horizon && (fullAt == null || at < fullAt)) fullAt = at;
  }
  return { caps: fullAt != null, fullAt };
}

/** Latest snapshot per resource id. */
export function latestSnapshots(snapshots: Snapshot[]): Map<string, Snapshot> {
  const map = new Map<string, Snapshot>();
  for (const s of snapshots) {
    const cur = map.get(s.resourceId);
    if (!cur || s.takenAt > cur.takenAt || (s.takenAt === cur.takenAt && s.id > cur.id)) {
      map.set(s.resourceId, s);
    }
  }
  return map;
}
