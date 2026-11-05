import { describe, expect, it } from 'vitest';
import { mergeState, normalizeState } from '../src/merge';
import { emptyState, type AppState } from '../src/types';

const withSeen = (catchUpSeen: AppState['settings']['catchUpSeen']): AppState => ({
  ...emptyState(),
  settings: { ...emptyState().settings, catchUpSeen },
});

describe('catch-up read state', () => {
  it('merges by union per game, in either order', () => {
    const phone = withSeen({ genshin: ['genshin-7.2@1'], hsr: ['hsr-4.6@1'] });
    const pc = withSeen({ genshin: ['genshin-7.1@1'] });
    const expected = { genshin: ['genshin-7.1@1', 'genshin-7.2@1'], hsr: ['hsr-4.6@1'] };
    expect(mergeState(phone, pc).settings.catchUpSeen).toEqual(expected);
    expect(mergeState(pc, phone).settings.catchUpSeen).toEqual(expected);
  });

  it('survives a peer that does not know the field', () => {
    const mine = withSeen({ zzz: ['zzz-3.3@1'] });
    expect(mergeState(mine, emptyState()).settings.catchUpSeen).toEqual({ zzz: ['zzz-3.3@1'] });
  });

  it('drops malformed entries without losing other settings', () => {
    const raw = {
      ...withSeen(undefined),
      settings: { ...emptyState().settings, sleepHours: 6, catchUpSeen: { wuwa: [1, 'wuwa-3.7@1'], '': ['x'] } },
    };
    const settings = normalizeState(raw).settings;
    expect(settings.catchUpSeen).toEqual({ wuwa: ['wuwa-3.7@1'] });
    expect(settings.sleepHours).toBe(6);
  });
});
