import { describe, expect, it } from 'vitest';
import { nextGameStop } from '../src/gestures';
import { scrubStep, scrubValue } from '../src/scrub';
import { swipeCommitPx, swipeFollow, swipeOutcome } from '../src/swipe-row';
import { longAge, shortAge } from '../src/components/Ago';
import { BUZZ_PATTERN, canBuzz } from '../src/haptics';
import { useUI, type GameTab } from '../src/ui-store';

describe('row swipe', () => {
  it('commits at a third of the row, between 56 and 112px', () => {
    expect(swipeCommitPx(100)).toBe(56);
    expect(swipeCommitPx(240)).toBe(84);
    expect(swipeCommitPx(900)).toBe(112);
  });
  it('follows the finger to the point, then at a quarter of its speed', () => {
    expect(swipeFollow(50, 400, true)).toBe(50);
    expect(swipeFollow(-212, 400, true)).toBe(-(112 + 100 / 4));
  });
  it('resists a side with nothing to do', () => {
    expect(swipeFollow(200, 400, false)).toBe(28);
    expect(swipeFollow(-40, 400, false)).toBe(-10);
  });
  it('acts when far enough, or on a quick flick, and not on a wobble', () => {
    expect(swipeOutcome(120, 400, 0.1)).toBe('right');
    expect(swipeOutcome(-120, 400, -0.1)).toBe('left');
    expect(swipeOutcome(45, 400, 0.9)).toBe('right');
    expect(swipeOutcome(45, 400, -0.9)).toBeNull();
    expect(swipeOutcome(30, 400, 2)).toBeNull();
    expect(swipeOutcome(60, 400, 0.2)).toBeNull();
  });
});

describe('bar scrub', () => {
  it('ticks at a round step near a twentieth of the cap', () => {
    expect(scrubStep(200)).toBe(10);
    expect(scrubStep(240)).toBe(10);
    expect(scrubStep(5)).toBe(1);
    expect(scrubStep(2400)).toBe(100);
    expect(scrubStep(0)).toBe(1);
  });
  it('reads the finger along the bar, clamped to the range', () => {
    const bar = { cap: 200, start: 50, left: 100, width: 400, dx: 0 };
    expect(scrubValue('absolute', { ...bar, x: 300 })).toBe(100);
    expect(scrubValue('absolute', { ...bar, x: 40 })).toBe(0);
    expect(scrubValue('absolute', { ...bar, x: 900 })).toBe(200);
  });
  it('moves from the starting value by the drag, the width for the whole cap', () => {
    const row = { cap: 200, start: 136, left: 0, width: 400, x: 0 };
    expect(scrubValue('relative', { ...row, dx: 100 })).toBe(186);
    expect(scrubValue('relative', { ...row, dx: -400 })).toBe(0);
    expect(scrubValue('relative', { ...row, dx: 0 })).toBe(136);
  });
});

describe('swiping a game page', () => {
  const tabs: GameTab[] = ['track', 'events', 'pulls', 'notes'];
  const games = ['genshin', 'hsr', 'zzz'];
  it('steps through the tabs first', () => {
    expect(nextGameStop(tabs, 'events', games, 'hsr', 1)).toEqual({ kind: 'tab', tab: 'pulls' });
    expect(nextGameStop(tabs, 'events', games, 'hsr', -1)).toEqual({ kind: 'tab', tab: 'track' });
  });
  it('then moves to the next game, landing on its first tab, or back to the last game on Notes', () => {
    expect(nextGameStop(tabs, 'notes', games, 'hsr', 1)).toEqual({ kind: 'game', gameId: 'zzz', tab: 'track' });
    expect(nextGameStop(tabs, 'track', games, 'hsr', -1)).toEqual({ kind: 'game', gameId: 'genshin', tab: 'notes' });
  });
  it('leaves the games for the dock at either end', () => {
    expect(nextGameStop(tabs, 'notes', games, 'zzz', 1)).toEqual({ kind: 'place' });
    expect(nextGameStop(tabs, 'track', games, 'genshin', -1)).toEqual({ kind: 'place' });
  });
  it('treats a tab the game does not show as its first', () => {
    expect(nextGameStop(tabs, 'quests', games, 'hsr', 1)).toEqual({ kind: 'tab', tab: 'events' });
  });
});

describe('ages', () => {
  it('is short beside its mark', () => {
    expect(shortAge(10_000)).toBe('Now');
    expect(shortAge(13 * 60_000)).toBe('13m');
    expect(shortAge(5 * 3_600_000 + 59 * 60_000)).toBe('5h');
    expect(shortAge(3 * 86_400_000)).toBe('3d');
    expect(shortAge(-5)).toBe('Now');
  });
  it('says it in full otherwise', () => {
    expect(longAge('Updated', 10_000)).toBe('Updated just now');
    expect(longAge('Updated', 13 * 60_000)).toBe('Updated 13 min ago');
    expect(longAge('Last synced', 2 * 3_600_000)).toBe('Last synced 2 h ago');
    expect(longAge('Entered', 86_400_000)).toBe('Entered 1 day ago');
    expect(longAge('Entered', 4 * 86_400_000)).toBe('Entered 4 days ago');
  });
});

describe('haptics', () => {
  it('stays silent when the player turned vibration off', () => {
    useUI.getState().setVibration(false);
    expect(canBuzz()).toBe(false);
    useUI.getState().setVibration(true);
  });
  it('keeps every browser pulse short', () => {
    for (const pattern of Object.values(BUZZ_PATTERN)) {
      const pulses = Array.isArray(pattern) ? pattern : [pattern];
      expect(Math.max(...pulses)).toBeLessThanOrEqual(40);
    }
  });
});
