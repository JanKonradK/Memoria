import { describe, expect, it } from 'vitest';
import { makeGame } from '../../shared/test/helpers';
import { allCodes, liveCodes } from '../src/codes';

const now = Date.parse('2026-11-13T12:00:00Z');
const genshin = makeGame({ id: 'g', presetKey: 'genshin' });

describe('reward codes', () => {
  it('lists working codes for games on the roster, soonest to expire first, and hides redeemed ones', () => {
    const codes = [
      { game: 'genshin', code: 'LATER', rewards: '60 Primogems', expiresAt: '2026-11-20T00:00:00Z' },
      { game: 'genshin', code: 'SOON', rewards: '100 Primogems', expiresAt: '2026-11-14T00:00:00+08:00' },
      { game: 'genshin', code: 'GONE', rewards: '', expiresAt: '2026-11-01T00:00:00Z' },
      { game: 'genshin', code: 'UNKNOWN', rewards: '' },
      { game: 'hsr', code: 'NOTPLAYED', rewards: '', expiresAt: '2026-11-20T00:00:00Z' },
    ];
    expect(liveCodes([genshin], codes, [], now).map((item) => item.code)).toEqual(['SOON', 'LATER']);
    expect(liveCodes([genshin], codes, ['genshin:SOON'], now).map((item) => item.code)).toEqual(['LATER']);
  });

  it('lets the signed feed correct a code the build shipped', () => {
    const merged = allCodes([
      { game: 'genshin', code: 'hourofruin', rewards: 'Corrected', expiresAt: '2027-01-01T00:00:00Z' },
    ]);
    expect(merged.filter((item) => item.code.toUpperCase() === 'HOUROFRUIN')).toHaveLength(1);
    expect(merged.find((item) => item.code.toUpperCase() === 'HOUROFRUIN')?.rewards).toBe('Corrected');
  });
});
