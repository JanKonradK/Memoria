import { z } from 'zod';

const value = z.object({
  name: z.string(),
  start: z.number(),
  end: z.number(),
  notes: z.string(),
  hash: z.string(),
});
const MAX_UNREAD = 300;
export type CalendarValue = z.infer<typeof value>;
const change = z.object({
  id: z.string(),
  key: z.string(),
  game: z.string(),
  kind: z.enum(['added', 'rescheduled', 'updated', 'withdrawn']),
  before: value.optional(),
  after: value.optional(),
  kept: value.optional(),
  published: z.string(),
});
export const CalendarInboxSchema = z.object({
  baseline: z.record(z.string(), value.nullable()),
  unread: z.array(change),
});
export type CalendarInbox = z.infer<typeof CalendarInboxSchema>;
export interface CalendarObservation {
  key: string;
  game: string;
  before?: CalendarValue;
  after?: CalendarValue;
  kept?: CalendarValue;
  /** The imported fingerprint, even when the user has since edited the row. */
  seedHash?: string;
  applied: boolean;
}

/** Compare publisher values, never the user's edited values, across deliveries. */
export function collectCalendarChanges(
  inbox: CalendarInbox,
  rows: CalendarObservation[],
  published: string,
): CalendarInbox {
  const baseline = { ...inbox.baseline };
  const unread = [...inbox.unread];
  for (const row of rows) {
    const known = Object.hasOwn(baseline, row.key);
    const before = known ? (baseline[row.key] ?? undefined) : row.before;
    const oldHash = known ? before?.hash : row.seedHash;
    if (
      (row.after ? oldHash !== row.after.hash : before !== undefined) &&
      (known || row.applied || row.seedHash !== undefined)
    ) {
      const kind = !row.after
        ? 'withdrawn'
        : !before
          ? 'added'
          : before.start !== row.after.start || before.end !== row.after.end
            ? 'rescheduled'
            : 'updated';
      let id = JSON.stringify([row.key, published, oldHash, row.after?.hash]);
      while (unread.some((item) => item.id === id)) id += '.';
      unread.push({
        id,
        key: row.key,
        game: row.game,
        kind,
        before,
        after: row.after,
        kept: row.applied ? undefined : row.kept,
        published,
      });
    }
    baseline[row.key] = row.after ?? null;
  }
  // Unread changes wait for confirmation, but a device left alone for years should not grow without end.
  return { baseline, unread: unread.slice(-MAX_UNREAD) };
}
