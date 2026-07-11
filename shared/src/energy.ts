import type { Resource, Snapshot } from './types';

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
}

export function projectEnergy(
  res: Pick<Resource, 'cap' | 'regenMinutes'>,
  snap: Pick<Snapshot, 'value' | 'takenAt'> | undefined,
  now: number,
): EnergyProjection {
  if (!snap) {
    return {
      value: 0,
      precise: 0,
      isFull: false,
      fullAt: null,
      msToFull: null,
      overflow: 0,
      hasSnapshot: false,
    };
  }
  if (res.regenMinutes <= 0) {
    // Non-regenerating resource: value only changes when the user edits it.
    return {
      value: snap.value,
      precise: snap.value,
      isFull: snap.value >= res.cap,
      fullAt: null,
      msToFull: null,
      overflow: 0,
      hasSnapshot: true,
    };
  }
  const periodMs = res.regenMinutes * 60_000;
  // Snapshot already at/over cap: no regen accrues, value is frozen.
  if (snap.value >= res.cap) {
    return {
      value: snap.value,
      precise: snap.value,
      isFull: true,
      fullAt: null,
      msToFull: 0,
      overflow: Math.floor(Math.max(0, now - snap.takenAt) / periodMs),
      hasSnapshot: true,
    };
  }
  const elapsed = Math.max(0, now - snap.takenAt);
  const gained = elapsed / periodMs;
  const raw = snap.value + Math.floor(gained);
  const value = Math.min(res.cap, raw);
  const fullAt = snap.takenAt + (res.cap - snap.value) * periodMs;
  const msToFull = Math.max(0, fullAt - now);
  return {
    value,
    precise: Math.min(res.cap, snap.value + gained),
    isFull: value >= res.cap,
    fullAt,
    msToFull,
    overflow: Math.max(0, raw - res.cap),
    hasSnapshot: true,
  };
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
