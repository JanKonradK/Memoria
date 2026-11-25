import { describe, expect, it } from 'vitest';
import {
  defaultRedeemUrl,
  parseCodeList,
  redeemInstructionsFor,
  redeemPortalUrl,
  redemptionCodeStatus,
} from '../src/redemption';

describe('redemptionCodeStatus', () => {
  it('closes the redemption window at its absolute deadline', () => {
    const deadline = Date.parse('2026-09-20T23:59:00+08:00');
    expect(redemptionCodeStatus(deadline, Date.parse('2026-09-20T15:58:59Z'))).toBe('available');
    expect(redemptionCodeStatus(deadline, Date.parse('2026-09-20T15:59:00Z'))).toBe('expired');
  });
  it('does not promise availability without a valid deadline', () => {
    expect(redemptionCodeStatus(undefined, Date.now())).toBe('unknown');
    expect(redemptionCodeStatus(NaN, Date.now())).toBe('unknown');
  });
});

describe('defaultRedeemUrl', () => {
  it('builds the official page for HoYoverse games', () => {
    expect(defaultRedeemUrl('genshin', ' GENSHINGIFT ')).toBe('https://genshin.hoyoverse.com/en/gift?code=GENSHINGIFT');
    expect(defaultRedeemUrl('hsr', 'STARRAIL')).toBe('https://hsr.hoyoverse.com/gift?code=STARRAIL');
    expect(defaultRedeemUrl('zzz', 'A&B')).toBe('https://zenless.hoyoverse.com/redemption?code=A%26B');
  });
  it('has no link for other games or an empty code', () => {
    expect(defaultRedeemUrl('wuwa', 'CODE')).toBeUndefined();
    expect(defaultRedeemUrl(undefined, 'CODE')).toBeUndefined();
    expect(defaultRedeemUrl('genshin', '   ')).toBeUndefined();
  });
});

describe('redeemPortalUrl', () => {
  it('returns the official portal for HoYoverse games and undefined otherwise', () => {
    expect(redeemPortalUrl('genshin')).toBe('https://genshin.hoyoverse.com/en/gift');
    expect(redeemPortalUrl('hsr')).toBe('https://hsr.hoyoverse.com/gift');
    expect(redeemPortalUrl('zzz')).toBe('https://zenless.hoyoverse.com/redemption');
    expect(redeemPortalUrl('wuwa')).toBeUndefined();
    expect(redeemPortalUrl(undefined)).toBeUndefined();
  });
});

describe('redeemInstructionsFor', () => {
  it('gives per-game steps and a general fallback', () => {
    const keys = ['genshin', 'hsr', 'zzz', 'wuwa', 'nte', 'endfield'];
    const texts = keys.map(redeemInstructionsFor);
    expect(new Set(texts).size).toBe(keys.length);
    expect(redeemInstructionsFor('genshin')).toContain('Redeem Code');
    const general = redeemInstructionsFor(undefined);
    expect(general).toBeTruthy();
    expect(texts).not.toContain(general);
    expect(redeemInstructionsFor('custom-game')).toBe(general);
  });
});

describe('parseCodeList', () => {
  it('splits on lines, commas, semicolons and spaces', () => {
    expect(parseCodeList('AAA\nBBB, CCC;DDD  EEE\r\nFFF')).toEqual(['AAA', 'BBB', 'CCC', 'DDD', 'EEE', 'FFF']);
  });
  it('strips surrounding punctuation but keeps - and _ inside', () => {
    expect(parseCodeList('"GS-2026_X", (HSR_CODE). • ZZZ-1!')).toEqual(['GS-2026_X', 'HSR_CODE', 'ZZZ-1']);
  });
  it('drops empty and overlong tokens and duplicates in any case', () => {
    expect(parseCodeList(` , ;; -- ${'A'.repeat(81)} abc ABC Abc ${'B'.repeat(80)}`)).toEqual(['abc', 'B'.repeat(80)]);
    expect(parseCodeList('')).toEqual([]);
  });
});
