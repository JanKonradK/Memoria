import type { GameEvent } from '@technogg/shared';

/** Playable events first, followed by cycles, banners, then maintenance. */
export const TYPE_RANK = { event: 0, custom: 0, cycle: 1, banner: 2, maintenance: 3 } as const;

export function agendaRank(event: GameEvent, now: number): 0 | 1 | 2 | 3 {
  if (event.done) return 3;
  if (event.start <= now && now < event.end) return 0;
  if (event.start > now) return 1;
  return 2;
}

export function agendaCompare(a: GameEvent, b: GameEvent, now: number): number {
  const aRank = agendaRank(a, now);
  const bRank = agendaRank(b, now);
  if (aRank !== bRank) return aRank - bRank;

  // Final id tiebreak keeps the order a total order, so synced devices agree
  // even when events tie on every displayed field.
  if (aRank === 0) {
    return (
      a.end - b.end || TYPE_RANK[a.type] - TYPE_RANK[b.type] || a.name.localeCompare(b.name) || a.id.localeCompare(b.id)
    );
  }
  if (aRank === 1) {
    return a.start - b.start || a.end - b.end || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
  }
  return b.end - a.end || a.id.localeCompare(b.id);
}
