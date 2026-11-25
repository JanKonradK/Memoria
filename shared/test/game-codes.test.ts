import { describe, expect, it } from 'vitest';
import { normalizeState } from '../src/merge';
import { CURRENT_SCHEMA_VERSION } from '../src/types';
import { GameCodeSchema, safeParseAppState } from '../src/validation';
import { makeGame, makeResource, makeState, makeTask } from './helpers';

const code = (over: Record<string, unknown> = {}) => ({ id: 'c1', code: 'GENSHINGIFT', addedAt: 1, ...over });

describe('GameCodeSchema', () => {
  it('accepts a full code and trims it', () => {
    const parsed = GameCodeSchema.parse(
      code({
        code: '  GENSHINGIFT ',
        rewards: '60 Primogems',
        expiresAt: 2,
        redeemUrl: 'https://genshin.hoyoverse.com/en/gift?code=GENSHINGIFT',
        redeemed: true,
      }),
    );
    expect(parsed.code).toBe('GENSHINGIFT');
  });

  it('rejects empty, overlong and non-https entries', () => {
    expect(GameCodeSchema.safeParse(code({ code: '   ' })).success).toBe(false);
    expect(GameCodeSchema.safeParse(code({ code: 'A'.repeat(81) })).success).toBe(false);
    expect(GameCodeSchema.safeParse(code({ redeemUrl: 'http://example.com' })).success).toBe(false);
    expect(GameCodeSchema.safeParse(code({ redeemUrl: 'javascript:alert(1)' })).success).toBe(false);
    expect(GameCodeSchema.safeParse(code({ rewards: 'x'.repeat(201) })).success).toBe(false);
    expect(GameCodeSchema.safeParse({ id: 'c1', code: 'X' }).success).toBe(false);
  });
});

describe('game codes in state', () => {
  it('validates without a schema bump and survives a backup round trip', () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(13);
    const codes = [code(), code({ id: 'c2', code: 'STARRAILGIFT', redeemed: true })];
    const state = makeState({ games: [makeGame({ codes })] });
    expect(safeParseAppState(state).success).toBe(true);
    expect(normalizeState(JSON.parse(JSON.stringify(state))).games[0]?.codes).toEqual(codes);
  });

  it('drops damaged and duplicate codes without dropping the game', () => {
    const state = normalizeState({
      ...makeState({ resources: [makeResource()], tasks: [makeTask()] }),
      games: [
        {
          ...makeGame(),
          codes: [
            null,
            code(),
            code({ code: 'DUPLICATE' }),
            code({ id: 'c2', redeemUrl: 'http://x' }),
            code({ id: 'c3' }),
          ],
        },
      ],
    });
    expect(state.games).toHaveLength(1);
    expect(state.games[0]?.codes?.map((row) => row.id)).toEqual(['c1', 'c3']);
    expect(state.tasks).toHaveLength(1);
    expect(normalizeState({ ...state, games: [{ ...makeGame(), codes: 'broken' }] }).games[0]?.codes).toBeUndefined();
  });

  it('keeps at most 200 valid codes', () => {
    const many = Array.from({ length: 250 }, (_, i) => code({ id: `c${i}` }));
    const state = normalizeState({ ...makeState(), games: [{ ...makeGame(), codes: many }] });
    expect(state.games[0]?.codes).toHaveLength(200);
  });
});
