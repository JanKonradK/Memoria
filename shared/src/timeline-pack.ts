import type { GameEvent } from './types';

/** Anything with a time span the timeline can place. */
export interface Span {
  id: string;
  start: number;
  end: number;
}

/**
 * Packs spans into as few rows as possible: spans that do not overlap share a
 * row. First fit over spans ordered by start, so a cycle's next instance, which
 * opens as the last one closes, lands on the same row as it.
 *
 * `minSpan` is the shortest span a row reserves for one item, so a short
 * maintenance or a livestream label is not overdrawn by the next bar. `gap` is
 * the clear time kept between neighbours on a row.
 */
export function packSpans<T extends Span>(items: readonly T[], minSpan = 0, gap = 0): T[][] {
  const ordered = [...items].sort((a, b) => a.start - b.start || b.end - a.end || a.id.localeCompare(b.id));
  const rows: { until: number; items: T[] }[] = [];
  for (const item of ordered) {
    const reach = Math.max(item.end, item.start + minSpan);
    const row = rows.find((candidate) => candidate.until + gap <= item.start);
    if (row) {
      row.items.push(item);
      row.until = reach;
    } else {
      rows.push({ until: reach, items: [item] });
    }
  }
  return rows.map((row) => row.items);
}

/**
 * A window the feed has not confirmed: the publisher has not announced the
 * date, so the bundled calendar stores the plausible range under this name.
 */
export function isPredictedWindow(event: Pick<GameEvent, 'name'>): boolean {
  return /predicted window/i.test(event.name);
}
