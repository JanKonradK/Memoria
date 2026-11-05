import { describe, expect, it } from 'vitest';
import {
  archiveEndedVersions,
  summarizeVersions,
  versionAt,
  VersionHistorySchema,
  versionRows,
  versionsOf,
  type PublicFeedEvent,
  type VersionHistory,
} from '../src';

const event = (sourceKey: string, start: string, end: string, type: PublicFeedEvent['type'] = 'event') =>
  ({
    game: 'genshin',
    name: sourceKey,
    type,
    start: `${start} 10:00`,
    end: `${end} 03:59`,
    sourceKey,
  }) as PublicFeedEvent;

const history = (overrides: Partial<VersionHistory> = {}): VersionHistory =>
  VersionHistorySchema.parse({
    reviewed: '2026-11-05',
    games: { genshin: { currency: 'Primogems', pullCost: 160 } },
    archiveSince: '2026-08-01',
    archive: [],
    versions: [
      // Out of order on purpose: everything sorts by release date.
      {
        game: 'genshin',
        version: '7.1',
        start: '2026-09-24',
        end: '2026-11-04',
        currency: { total: 9600, basis: 'community-estimate' },
      },
      {
        game: 'genshin',
        version: '7.0',
        start: '2026-08-12',
        end: '2026-09-24',
        currency: { total: 12_800, basis: 'community-estimate' },
      },
      {
        game: 'genshin',
        version: '6.7',
        start: '2026-07-01',
        end: '2026-08-12',
        currency: { total: null, basis: 'community-estimate' },
      },
      { game: 'genshin', version: '7.2', start: '2026-11-04', currency: { total: 8000, basis: 'community-estimate' } },
    ],
    ...overrides,
  });

describe('version history', () => {
  it('finds the version a date belongs to, release day included and next release excluded', () => {
    const versions = versionsOf(history(), 'genshin');
    expect(versions.map((v) => v.version)).toEqual(['6.7', '7.0', '7.1', '7.2']);
    expect(versionAt(versions, '2026-08-12')?.version).toBe('7.0');
    expect(versionAt(versions, '2026-09-23')?.version).toBe('7.0');
    expect(versionAt(versions, '2027-01-01')?.version).toBe('7.2');
    expect(versionAt(versions, '2026-06-01')).toBeUndefined();
  });

  it('works out pulls, daily rate and change, and skips versions without a sourced total', () => {
    const rows = versionRows(history(), 'genshin');
    const [v67, v70, v71] = rows;
    expect(v67!.pulls).toBeNull();
    expect(v70!.pulls).toBe(80);
    expect(v70!.days).toBe(43);
    expect(v70!.perDay).toBe(298);
    // 6.7 has no total, so 7.0 has nothing to compare against.
    expect(v70!.change).toBeNull();
    expect(v71!.change).toBe(-3200);
  });

  it('counts events only for versions the archive fully covers', () => {
    const rows = versionRows(
      history({
        archive: [
          event('a', '2026-08-20', '2026-09-01'),
          event('b', '2026-08-25', '2026-09-10', 'banner'),
          event('c', '2026-09-30', '2026-10-10'),
          event('c', '2026-09-30', '2026-10-10'),
          event('m', '2026-09-24', '2026-09-24', 'maintenance'),
        ],
      }),
      'genshin',
    );
    expect(rows.map((row) => [row.record.version, row.events, row.banners])).toEqual([
      ['6.7', null, null],
      ['7.0', 1, 1],
      ['7.1', 1, 0],
      // Still running: its count would only be a partial one.
      ['7.2', null, null],
    ]);
  });

  it('summarises the average and compares the latest version with the ones before it', () => {
    const summary = summarizeVersions(versionRows(history(), 'genshin'));
    expect(summary.known).toBe(3);
    expect(summary.average).toBe(10_133);
    expect(summary.best?.record.version).toBe('7.0');
    expect(summary.latest?.record.version).toBe('7.2');
    expect(summary.latestVsAverage).toBe(8000 - 11_200);
  });

  it('archives events of ended versions and drops them from the current feed after the retention period', () => {
    const current = [
      event('old', '2026-08-20', '2026-09-01'),
      event('recent', '2026-10-01', '2026-11-03'),
      event('live', '2026-11-05', '2026-12-01'),
    ];
    const result = archiveEndedVersions(current, history(), '2026-11-05', 60 * 86_400_000);
    expect(result.archive.map((e) => e.sourceKey)).toEqual(['old', 'recent']);
    expect(result.current.map((e) => e.sourceKey)).toEqual(['recent', 'live']);
    expect(result.moved).toBe(2);
    // Running it again moves nothing new.
    const again = archiveEndedVersions(
      result.current,
      history({ archive: result.archive }),
      '2026-11-05',
      60 * 86_400_000,
    );
    expect(again.moved).toBe(0);
  });

  it('rejects non-HTTPS source links', () => {
    const parsed = VersionHistorySchema.safeParse({
      ...history(),
      versions: [{ ...history().versions[0], sources: [{ label: 'x', url: 'javascript:alert(1)' }] }],
    });
    expect(parsed.success).toBe(false);
  });
});
