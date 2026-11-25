import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { gachaTrackFor, importGachaHistory, parseGachaExport, parseGachaTime } from '../src/connectors';
import type { RawGachaPull } from '../src/connectors';
import type { GamePity } from '../src/pity';

const EU = 'Etc/GMT-1';

function pulls(gachaType: string, list: Array<[name: string, rank: number]>, start = 0): RawGachaPull[] {
  return list.map(([name, rank], i) => ({
    id: String(1000 + start + i),
    time: DateTime.fromMillis(Date.UTC(2026, 0, 1) + (start + i) * 60_000, { zone: EU }).toFormat(
      'yyyy-MM-dd HH:mm:ss',
    ),
    name,
    rank,
    gachaType,
  }));
}

const filler = (n: number): Array<[string, number]> => Array.from({ length: n }, () => ['Cool Steel', 3]);

describe('parseGachaTime', () => {
  it('reads server wall clock in the game timezone, not the device', () => {
    expect(parseGachaTime('2026-01-01 05:00:00', 'Etc/GMT-1')).toBe(Date.UTC(2026, 0, 1, 4));
    expect(parseGachaTime('2026-01-01 05:00:00', 'Etc/GMT+5')).toBe(Date.UTC(2026, 0, 1, 10));
    expect(parseGachaTime('2026-01-01T05:00:00', 'Etc/GMT-8')).toBe(Date.UTC(2026, 0, 0, 21));
    expect(parseGachaTime(1_700_000_000_000, EU)).toBe(1_700_000_000_000);
    expect(parseGachaTime('garbage', EU)).toBeUndefined();
  });
});

describe('gachaTrackFor', () => {
  it('maps banner codes strictly', () => {
    expect(gachaTrackFor('genshin', '400')).toBe('character');
    expect(gachaTrackFor('genshin', '100')).toBeUndefined();
    expect(gachaTrackFor('hsr', '12')).toBe('weapon');
    expect(gachaTrackFor('zzz', '5001')).toBe('bangboo');
    expect(gachaTrackFor('wuwa', '4')).toBe('standard');
    expect(gachaTrackFor('wuwa', '5')).toBeUndefined();
  });
});

describe('importGachaHistory', () => {
  it('counts pity per track and tracks lost 50/50s', () => {
    const list = [
      ...pulls('301', [...filler(9), ['Qiqi', 5]], 0),
      ...pulls('400', [...filler(4), ['Furina', 5]], 10),
      ...pulls('301', filler(7), 15),
      ...pulls('200', [...filler(2), ['Diluc', 5], ...filler(3)], 30),
      ...pulls('100', filler(5), 40),
    ];
    const summary = importGachaHistory('genshin', list, EU);
    expect(summary.ignoredBannerTypes).toEqual(['100']);
    expect(summary.totalPulls).toBe(28);
    expect(summary.fiveStarsImported).toBe(3);
    expect(summary.tracksUpdated).toEqual(['character', 'standard']);
    const character = summary.pity.tracks.character!;
    expect(character.count).toBe(7);
    expect(character.guaranteed).toBe(false);
    expect(character.log.map((e) => [e.pity, e.outcome, e.name])).toEqual([
      [10, 'lost', 'Qiqi'],
      [5, 'guaranteed', 'Furina'],
    ]);
    expect(character.log[0]!.id).toBe('gacha:genshin:1009');
    const standard = summary.pity.tracks.standard!;
    expect(standard).toMatchObject({ count: 3, guaranteed: false });
    expect(standard.log[0]).toMatchObject({ pity: 3, outcome: 'standard' });
  });

  it('sorts pulls chronologically before counting', () => {
    const list = pulls('11', [...filler(3), ['Acheron', 5], ...filler(2)]).reverse();
    const summary = importGachaHistory('hsr', list, EU);
    expect(summary.pity.tracks.character).toMatchObject({ count: 2 });
    expect(summary.pity.tracks.character!.log[0]).toMatchObject({ pity: 4, outcome: 'won' });
  });

  it('keeps older manual entries and untouched tracks', () => {
    const existing: GamePity = {
      tracks: {
        character: {
          count: 50,
          guaranteed: true,
          log: [
            { id: 'manual-old', at: Date.UTC(2025, 5, 1), pity: 70, outcome: 'won' },
            { id: 'manual-new', at: Date.UTC(2026, 5, 1), pity: 30, outcome: 'won' },
          ],
        },
        weapon: { count: 12, guaranteed: false, log: [] },
      },
    };
    const summary = importGachaHistory('genshin', pulls('301', [...filler(2), ['Mavuika', 5]]), EU, existing, '7001');
    expect(summary.uid).toBe('7001');
    expect(summary.pity.tracks.weapon).toEqual(existing.tracks.weapon);
    expect(summary.pity.tracks.character!.log.map((e) => e.id)).toEqual(['manual-old', 'gacha:genshin:1002']);
    expect(summary.pity.tracks.character!.count).toBe(0);
  });

  it('treats always-featured tracks as guaranteed', () => {
    const summary = importGachaHistory('zzz', pulls('5001', [...filler(1), ['Butler', 5]]), EU);
    expect(summary.pity.tracks.bangboo!.log[0]!.outcome).toBe('guaranteed');
  });
});

describe('parseGachaExport', () => {
  it('reads UIGF v4 with several accounts', () => {
    const raw = {
      info: { version: 'v4.0' },
      hk4e: [
        {
          uid: '700000001',
          list: [
            {
              id: '1',
              time: '2026-01-01 00:00:00',
              name: 'Qiqi',
              rank_type: '5',
              gacha_type: '301',
              item_type: 'Character',
            },
          ],
        },
        { uid: '600000002', list: [] },
      ],
      nap: [
        {
          uid: '1500000001',
          list: [{ id: '9', time: '2026-01-01 00:00:00', name: 'Ellen', rank_type: '4', gacha_type: '2001' }],
        },
      ],
    };
    const first = parseGachaExport(raw, 'genshin');
    expect(first).toMatchObject({
      sourceFormat: 'uigf-v4',
      uid: '700000001',
      availableUids: ['700000001', '600000002'],
    });
    expect(first.pulls).toEqual([
      { id: '1', time: '2026-01-01 00:00:00', name: 'Qiqi', rank: 5, gachaType: '301', itemType: 'Character' },
    ]);
    expect(parseGachaExport(raw, 'genshin', '600000002').pulls).toEqual([]);
    // ZZZ S rank (4) becomes 5★.
    expect(parseGachaExport(raw, 'zzz').pulls[0]!.rank).toBe(5);
    expect(() => parseGachaExport(raw, 'hsr')).toThrow();
  });

  it('reads the older single-account UIGF shape', () => {
    const raw = {
      info: { uid: '800000003', uigf_version: 'v3.0' },
      list: [{ id: 5, time: '2026-01-01 00:00:00', name: 'Keqing', rank_type: 5, gacha_type: '200' }],
    };
    const parsed = parseGachaExport(raw, 'genshin');
    expect(parsed).toMatchObject({ sourceFormat: 'uigf-v3', uid: '800000003', availableUids: ['800000003'] });
    expect(parsed.pulls[0]).toMatchObject({ id: '5', rank: 5, gachaType: '200' });
  });

  it('reads WuWa Tracker JSON with stable ids', () => {
    const row = { cardPoolType: 1, qualityLevel: 5, name: 'Jinhsi', time: '2026-01-01 00:00:00' };
    const parsed = parseGachaExport({ pulls: [row, { ...row, qualityLevel: 3, name: 'Sword' }] }, 'wuwa');
    expect(parsed.sourceFormat).toBe('wuwa-json');
    expect(parsed.pulls.map((p) => p.id)).toEqual(['w1-20260101000000-0', 'w1-20260101000000-1']);
    expect(parseGachaExport([row], 'wuwa').pulls).toHaveLength(1);
    expect(() => parseGachaExport({ nope: 1 }, 'wuwa')).toThrow();
  });
});
