import { describe, expect, it } from 'vitest';
import {
  addPulls,
  EMPTY_TRACK,
  expectedPullsToFiveStar,
  GamePitySchema,
  PITY_RULES,
  pityRulesFor,
  pityStats,
  pullsForFeatured,
  rateAt,
  recordFiveStar,
  removeFiveStar,
  ruleForBanner,
} from '../src/pity';
import { normalizeState, type GamePity } from '../src';
import { makeGame } from './helpers';

const rule = (game: string, id: string) => PITY_RULES[game]!.find((r) => r.id === id)!;
const genshinChar = rule('genshin', 'character');
const genshinWeapon = rule('genshin', 'weapon');
const genshinStandard = rule('genshin', 'standard');

describe('pity rules', () => {
  it('every rule is consistent and its curve reaches certainty at hard pity', () => {
    for (const rules of Object.values(PITY_RULES)) {
      expect(new Set(rules.map((r) => r.id)).size).toBe(rules.length);
      for (const r of rules) {
        expect(r.id).toMatch(/^[a-z]{1,16}$/);
        expect(r.soft).toBeLessThan(r.hard);
        expect(rateAt(r, r.hard)).toBe(1);
        expect(rateAt(r, 1)).toBe(r.base);
        const expected = expectedPullsToFiveStar(r);
        expect(expected).toBeGreaterThan(r.soft * 0.7);
        expect(expected).toBeLessThan(r.hard);
      }
    }
  });

  it('matches the measured Genshin average of about 62 pulls per 5★', () => {
    expect(expectedPullsToFiveStar(genshinChar)).toBeGreaterThan(61);
    expect(expectedPullsToFiveStar(genshinChar)).toBeLessThan(64);
  });

  it('expected pulls shrink as pity builds and end at one pull before hard pity', () => {
    expect(expectedPullsToFiveStar(genshinChar, 80)).toBeLessThan(expectedPullsToFiveStar(genshinChar, 10));
    expect(expectedPullsToFiveStar(genshinChar, 89)).toBe(1);
  });

  it('knows no rules for a game without a tracker', () => {
    expect(pityRulesFor('nikke')).toEqual([]);
    expect(pityRulesFor(undefined)).toEqual([]);
  });

  it('maps calendar banners to the track they spend', () => {
    const rules = pityRulesFor('genshin');
    expect(ruleForBanner(rules, 'character')?.id).toBe('character');
    expect(ruleForBanner(rules, 'weapon')?.id).toBe('weapon');
    expect(ruleForBanner(rules, 'other')).toBeUndefined();
    expect(ruleForBanner(rules, undefined)).toBeUndefined();
  });
});

describe('recording pulls', () => {
  it('adds pulls and never goes below zero or past the stored limit', () => {
    expect(addPulls(EMPTY_TRACK, 10).count).toBe(10);
    expect(addPulls({ ...EMPTY_TRACK, count: 5 }, -9).count).toBe(0);
    expect(addPulls({ ...EMPTY_TRACK, count: 195 }, 10).count).toBe(200);
  });

  it('a lost 50/50 makes the next 5★ guaranteed, and the guaranteed one clears it', () => {
    const lost = recordFiveStar({ ...EMPTY_TRACK, count: 76 }, genshinChar, { id: 'a', at: 1, pity: 76, won: false });
    expect(lost).toMatchObject({ count: 0, guaranteed: true });
    expect(lost.log[0]).toMatchObject({ pity: 76, outcome: 'lost' });
    const next = recordFiveStar({ ...lost, count: 40 }, genshinChar, { id: 'b', at: 2, pity: 40, won: false });
    expect(next.guaranteed).toBe(false);
    expect(next.log[1]!.outcome).toBe('guaranteed');
  });

  it('keeps pulls made after the 5★ in the same ten-pull', () => {
    const track = recordFiveStar({ ...EMPTY_TRACK, count: 80 }, genshinChar, { id: 'a', at: 1, pity: 74, won: true });
    expect(track.count).toBe(6);
    expect(track.log[0]!.outcome).toBe('won');
  });

  it('clamps the recorded pull to the banner’s hard pity', () => {
    const track = recordFiveStar(EMPTY_TRACK, genshinWeapon, { id: 'a', at: 1, pity: 500, won: true });
    expect(track.log[0]!.pity).toBe(80);
  });

  it('a standard or always-featured banner has no 50/50', () => {
    const standard = recordFiveStar(EMPTY_TRACK, genshinStandard, { id: 'a', at: 1, pity: 70, won: false });
    expect(standard).toMatchObject({ guaranteed: false });
    expect(standard.log[0]!.outcome).toBe('standard');
    const wuwaWeapon = recordFiveStar(EMPTY_TRACK, rule('wuwa', 'weapon'), { id: 'a', at: 1, pity: 70, won: false });
    expect(wuwaWeapon.log[0]!.outcome).toBe('guaranteed');
    expect(wuwaWeapon.guaranteed).toBe(false);
  });

  it('keeps only the newest log entries and trims names', () => {
    let track = EMPTY_TRACK;
    for (let i = 0; i < 205; i++)
      track = recordFiveStar(track, genshinStandard, { id: `e${i}`, at: i + 1, pity: 1, name: `  ${'x'.repeat(90)} ` });
    expect(track.log).toHaveLength(200);
    expect(track.log[0]!.id).toBe('e5');
    expect(track.log[0]!.name).toHaveLength(80);
    expect(removeFiveStar(track, 'e5').log).toHaveLength(199);
  });
});

describe('pulls for the featured 5★', () => {
  it('worst case is the rest of this pity plus a full one when the 50/50 is open', () => {
    expect(pullsForFeatured(genshinChar, { ...EMPTY_TRACK, count: 20 }).worst).toBe(70 + 90);
    expect(pullsForFeatured(genshinChar, { ...EMPTY_TRACK, count: 20, guaranteed: true }).worst).toBe(70);
    expect(pullsForFeatured(genshinStandard, { ...EMPTY_TRACK, count: 20 }).worst).toBe(70);
  });

  it('typical sits between the first 5★ and the worst case', () => {
    const open = pullsForFeatured(genshinChar, EMPTY_TRACK);
    expect(open.typical).toBeGreaterThan(expectedPullsToFiveStar(genshinChar));
    expect(open.typical).toBeLessThan(open.worst);
    const guaranteed = pullsForFeatured(genshinChar, { ...EMPTY_TRACK, guaranteed: true });
    expect(guaranteed.typical).toBe(Math.round(expectedPullsToFiveStar(genshinChar)));
  });

  it('a count logged past hard pity still needs at least one pull', () => {
    expect(pullsForFeatured(genshinChar, { ...EMPTY_TRACK, count: 150, guaranteed: true }).worst).toBe(1);
  });
});

describe('stats', () => {
  it('averages the logged pity and counts 50/50s, ignoring guarantees', () => {
    let track = recordFiveStar(EMPTY_TRACK, genshinChar, { id: 'a', at: 1, pity: 80, won: false });
    track = recordFiveStar(track, genshinChar, { id: 'b', at: 2, pity: 60 });
    track = recordFiveStar(track, genshinChar, { id: 'c', at: 3, pity: 70, won: true });
    expect(pityStats(track)).toEqual({ fiveStars: 3, averagePity: 70, won: 1, lost: 1 });
    expect(pityStats(EMPTY_TRACK).averagePity).toBeNull();
  });
});

describe('stored pity', () => {
  it('drops track keys that could reach the object prototype, and out-of-range counts', () => {
    const bad = JSON.parse('{"tracks":{"__proto__":{"count":1,"guaranteed":false,"log":[]}}}');
    const parsed = GamePitySchema.parse(bad);
    expect(Object.keys(parsed.tracks)).toEqual([]);
    expect(Object.getPrototypeOf(parsed.tracks)).toBe(Object.prototype);
    expect(GamePitySchema.safeParse({ tracks: { character: { count: 999 } } }).success).toBe(false);
    expect(GamePitySchema.safeParse({ tracks: { Character: { count: 1 } } }).success).toBe(false);
  });

  it('a damaged tracker is dropped on its own and the game survives', () => {
    const state = normalizeState({
      games: [
        makeGame({ id: 'ok', pity: { tracks: { character: { count: 12, guaranteed: true, log: [] } } } }),
        makeGame({ id: 'bad', pity: { tracks: { character: { count: -4 } } } as unknown as GamePity }),
      ],
    });
    expect(state.games.find((g) => g.id === 'ok')?.pity?.tracks.character?.count).toBe(12);
    const bad = state.games.find((g) => g.id === 'bad');
    expect(bad).toBeDefined();
    expect(bad).not.toHaveProperty('pity');
  });
});
