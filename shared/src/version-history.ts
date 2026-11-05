import { z } from 'zod';
import { PublicFeedEventSchema, type PublicFeedEvent } from './event-feed';

/**
 * Version history: what each game version gave a free player, version by
 * version. Researched totals live in `app/src/data/feed/history.json` next to
 * the events of every version that has ended. The timeline never reads that
 * file; only the History page loads it, on demand.
 */

const count = z.number().int().min(0).max(10_000_000).nullable();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const link = z.object({ label: z.string().min(1).max(200), url: z.url({ protocol: /^https$/ }) });

export const VersionCurrencySchema = z.object({
  /** Free premium currency a player without purchases could collect. Null: no sourced figure. */
  total: count,
  events: count.optional(),
  daily: count.optional(),
  endgame: count.optional(),
  /** Maintenance compensation, codes, web events and shop resets. */
  other: count.optional(),
  basis: z.enum(['official', 'community-estimate']),
});

export const VersionRecordSchema = z.object({
  game: z.string().min(1).max(20),
  version: z.string().min(1).max(20),
  title: z.string().max(200).nullable().optional(),
  /** Release date, and the next version's release date, YYYY-MM-DD. */
  start: day,
  end: day.nullable().optional(),
  currency: VersionCurrencySchema,
  newCharacters: z.array(z.string().min(1).max(100)).max(40).default([]),
  sources: z.array(link).max(20).default([]),
});

export const VersionHistorySchema = z.object({
  reviewed: day,
  /** Premium currency name and the cost of one pull, per game. */
  games: z.record(
    z.string(),
    z.object({
      currency: z.string().min(1).max(60),
      pullCost: z.number().int().positive().nullable(),
      methodology: z.string().max(600).optional(),
      /** When the feed began covering this game, if later than `archiveSince`. */
      archiveSince: day.optional(),
    }),
  ),
  versions: z.array(VersionRecordSchema).max(5000),
  /** First day the archived events below are complete from; earlier versions have no event counts. */
  archiveSince: day,
  /** Events of versions that have ended, moved out of the current feed. */
  archive: z.array(PublicFeedEventSchema).max(50_000),
});

export type VersionCurrency = z.infer<typeof VersionCurrencySchema>;
export type VersionRecord = z.infer<typeof VersionRecordSchema>;
export type VersionHistory = z.infer<typeof VersionHistorySchema>;

/** Event dates are server-time strings; their first ten characters are the date. */
const eventDay = (event: Pick<PublicFeedEvent, 'start'>) => event.start.slice(0, 10);

/** Versions of one game, oldest first. */
export function versionsOf(history: Pick<VersionHistory, 'versions'>, game: string): VersionRecord[] {
  return history.versions.filter((v) => v.game === game).sort((a, b) => a.start.localeCompare(b.start));
}

/** The version a date falls in: from its release up to, not including, the next release. */
export function versionAt(versions: VersionRecord[], date: string): VersionRecord | undefined {
  let found: VersionRecord | undefined;
  for (const version of versions) {
    if (version.start > date) break;
    if (!version.end || date < version.end) found = version;
  }
  return found;
}

export interface VersionRow {
  record: VersionRecord;
  days: number | null;
  /** Free pulls: the total divided by the game's pull cost, one decimal. */
  pulls: number | null;
  perDay: number | null;
  /** Counted only when the archive covers the whole version. */
  events: number | null;
  banners: number | null;
  /** Change from the previous version with a known total. */
  change: number | null;
}

const DAY_MS = 86_400_000;
function daysBetween(start: string, end: string): number {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / DAY_MS);
}

/** One row per version of a game, oldest first, with everything the History page shows. */
export function versionRows(history: VersionHistory, game: string): VersionRow[] {
  const versions = versionsOf(history, game);
  const pullCost = history.games[game]?.pullCost ?? null;
  const since = history.games[game]?.archiveSince ?? history.archiveSince;
  const counts = new Map<VersionRecord, { events: number; banners: number }>();
  const seen = new Set<string>();
  for (const event of history.archive) {
    if (event.game !== game || seen.has(event.sourceKey)) continue;
    seen.add(event.sourceKey);
    if (event.type !== 'event' && event.type !== 'banner') continue;
    const version = versionAt(versions, eventDay(event));
    if (!version) continue;
    const tally = counts.get(version) ?? { events: 0, banners: 0 };
    tally[event.type === 'event' ? 'events' : 'banners'] += 1;
    counts.set(version, tally);
  }
  let previous: number | null = null;
  return versions.map((record) => {
    const total = record.currency.total;
    const days = record.end ? daysBetween(record.start, record.end) : null;
    const covered = record.start >= since && !!record.end;
    const tally = counts.get(record);
    const row: VersionRow = {
      record,
      days,
      pulls: total !== null && pullCost ? Math.round((total / pullCost) * 10) / 10 : null,
      perDay: total !== null && days ? Math.round(total / days) : null,
      events: covered ? (tally?.events ?? 0) : null,
      banners: covered ? (tally?.banners ?? 0) : null,
      change: total !== null && previous !== null ? total - previous : null,
    };
    if (total !== null) previous = total;
    return row;
  });
}

export interface VersionSummary {
  versions: number;
  known: number;
  average: number | null;
  averagePulls: number | null;
  best: VersionRow | null;
  latest: VersionRow | null;
  /** The latest known total against the average of the versions before it. */
  latestVsAverage: number | null;
}

export function summarizeVersions(rows: VersionRow[]): VersionSummary {
  const known = rows.filter((row) => row.record.currency.total !== null);
  const mean = (values: number[]) =>
    values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
  const totals = known.map((row) => row.record.currency.total!);
  const pulls = known.flatMap((row) => (row.pulls === null ? [] : [row.pulls]));
  const latest = known.at(-1) ?? null;
  const before = mean(totals.slice(0, -1));
  return {
    versions: rows.length,
    known: known.length,
    average: mean(totals),
    averagePulls: pulls.length ? Math.round((pulls.reduce((a, b) => a + b, 0) / pulls.length) * 10) / 10 : null,
    best: known.reduce<VersionRow | null>(
      (top, row) => (!top || row.record.currency.total! > top.record.currency.total! ? row : top),
      null,
    ),
    latest,
    latestVsAverage: latest && before !== null ? latest.record.currency.total! - before : null,
  };
}

/**
 * Moves events of ended versions into the archive. An event is archived when
 * its version has ended by `today`; it leaves the current feed once it also
 * ended more than `retentionMs` ago, which is when the importer forgets it.
 */
export function archiveEndedVersions(
  current: PublicFeedEvent[],
  history: VersionHistory,
  today: string,
  retentionMs: number,
): { current: PublicFeedEvent[]; archive: PublicFeedEvent[]; moved: number } {
  const archived = new Map(history.archive.map((event) => [event.sourceKey, event]));
  const cutoff = new Date(Date.parse(`${today}T00:00:00Z`) - retentionMs).toISOString().slice(0, 10);
  const byGame = new Map<string, VersionRecord[]>();
  const keep: PublicFeedEvent[] = [];
  let moved = 0;
  for (const event of current) {
    const versions = byGame.get(event.game) ?? versionsOf(history, event.game);
    byGame.set(event.game, versions);
    const version = versionAt(versions, eventDay(event));
    const ended = !!version?.end && version.end <= today;
    if (ended) {
      if (!archived.has(event.sourceKey)) moved += 1;
      archived.set(event.sourceKey, event);
    }
    if (!(ended && event.end.slice(0, 10) < cutoff)) keep.push(event);
  }
  const archive = [...archived.values()].sort(
    (a, b) => a.game.localeCompare(b.game) || a.start.localeCompare(b.start) || a.sourceKey.localeCompare(b.sourceKey),
  );
  return { current: keep, archive, moved };
}
