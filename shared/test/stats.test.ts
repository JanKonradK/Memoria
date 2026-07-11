import { describe, expect, it } from 'vitest';
import { dailyHeatmap, dailyStreak, projectWallet, sleepCheck, wastedRegen } from '../src/stats';
import { evaluateAlerts } from '../src/alerts';
import { dailyPeriodKey } from '../src/periods';
import { makeGame, makeResource, makeSnapshot, makeState, makeTask, utc } from './helpers';
import type { Wallet } from '../src/types';

const DAY = 86_400_000;
const HOUR = 3_600_000;

describe('wastedRegen', () => {
  const res = { cap: 200, regenMinutes: 8 };

  it('counts nothing while under cap', () => {
    const snaps = [makeSnapshot({ value: 0, takenAt: 0 })];
    // 200 points need 1600 minutes; look at the first 1000.
    expect(wastedRegen(res, snaps, 0, 1000 * 60_000)).toBe(0);
  });

  it('counts overflow after the cap is reached', () => {
    const snaps = [makeSnapshot({ value: 200, takenAt: 0 })];
    expect(wastedRegen(res, snaps, 0, 80 * 60_000)).toBe(10); // 80 min / 8 min per pt
  });

  it('stops the segment at the next snapshot (a spend resets the clock)', () => {
    const snaps = [
      makeSnapshot({ id: 'a', value: 200, takenAt: 0 }),
      makeSnapshot({ id: 'b', value: 40, takenAt: 80 * 60_000 }), // spent — regen resumes
    ];
    expect(wastedRegen(res, snaps, 0, 1000 * 60_000)).toBe(10);
  });

  it('clips to the window and ignores non-regen resources', () => {
    const snaps = [makeSnapshot({ value: 200, takenAt: 0 })];
    expect(wastedRegen(res, snaps, 40 * 60_000, 80 * 60_000)).toBe(5);
    expect(wastedRegen({ cap: 5, regenMinutes: 0 }, snaps, 0, DAY)).toBe(0);
  });
});

describe('heatmap + streak', () => {
  const game = makeGame(); // reset 04:00, Etc/GMT-1
  const now = utc('2026-07-05T12:00:00');

  function stateWithDays(doneDaysAgo: number[]) {
    const task = makeTask({ id: 't1', cadence: 'daily' });
    const completions = doneDaysAgo.map((k) => {
      const key = dailyPeriodKey(game, now - k * DAY);
      return { id: `t1|${key}`, taskId: 't1', periodKey: key, done: true, updatedAt: 1 };
    });
    return makeState({ games: [game], tasks: [task], completions });
  }

  it('maps completions onto trailing game-days', () => {
    const heat = dailyHeatmap(stateWithDays([0, 1, 3]), game, 5, now);
    expect(heat).toHaveLength(5);
    expect(heat.map((h) => h.done)).toEqual([0, 1, 0, 1, 1]); // oldest → newest
    expect(heat[4]!.total).toBe(1);
  });

  it('counts the streak, today in progress not breaking it', () => {
    expect(dailyStreak(stateWithDays([0, 1, 2]), game, now)).toBe(3);
    expect(dailyStreak(stateWithDays([1, 2]), game, now)).toBe(2); // today not done yet
    expect(dailyStreak(stateWithDays([1, 3]), game, now)).toBe(1);
    expect(dailyStreak(stateWithDays([]), game, now)).toBe(0);
    expect(dailyStreak(makeState({ games: [game] }), game, now)).toBe(0); // no daily tasks
  });
});

describe('projectWallet', () => {
  const base: Wallet = {
    id: 'g1',
    gameId: 'g1',
    balance: 8000,
    balanceAt: utc('2026-07-01T00:00:00'),
    dailyIncome: 60,
    pullCost: 160,
    nextPatchAt: utc('2026-07-21T00:00:00'),
    patchDays: 42,
    updatedAt: 1,
  };
  const now = utc('2026-07-06T00:00:00'); // 5 days after entry, 15 before patch

  it('accrues income since the balance was entered and projects to patch start', () => {
    const p = projectWallet(base, now);
    expect(p.current).toBe(8300); // 8000 + 5×60
    expect(p.daysToPatch).toBeCloseTo(15);
    expect(p.atPatch).toBe(9200); // 8300 + 15×60
    expect(p.pullsAtPatch).toBe(57); // 9200 / 160
  });

  it('rolls a past patch date forward by the cycle length', () => {
    const p = projectWallet(base, utc('2026-07-25T00:00:00'));
    expect(p.patchAt).toBe(utc('2026-07-21T00:00:00') + 42 * DAY);
  });

  it('handles no patch date and zero pull cost', () => {
    const p = projectWallet({ ...base, nextPatchAt: null, pullCost: 0 }, now);
    expect(p.current).toBe(8300);
    expect(p.atPatch).toBeNull();
    expect(p.pullsAtPatch).toBeNull();
  });
});

describe('purchase expiry alerts', () => {
  it('fires within 48h of expiry and re-arms via expiresAt in the dedupe key', () => {
    const now = utc('2026-07-06T00:00:00');
    const game = makeGame();
    const purchase = {
      id: 'p1',
      gameId: 'g1',
      name: 'Welkin Moon',
      cycleDays: 30,
      expiresAt: now + 24 * 3_600_000,
      notify: true,
      updatedAt: 1,
    };
    const state = makeState({ games: [game], purchases: [purchase] });
    const fired = evaluateAlerts(state, now).filter((a) => a.dedupeKey.startsWith('purchase:'));
    expect(fired).toHaveLength(1);
    expect(fired[0]!.title).toContain('Welkin Moon');
    expect(fired[0]!.dedupeKey).toBe(`purchase:p1:${purchase.expiresAt}`);

    // 5 days out → silent; notify off → silent
    expect(
      evaluateAlerts(makeState({ games: [game], purchases: [{ ...purchase, expiresAt: now + 5 * DAY }] }), now)
        .filter((a) => a.dedupeKey.startsWith('purchase:')),
    ).toHaveLength(0);
    expect(
      evaluateAlerts(makeState({ games: [game], purchases: [{ ...purchase, notify: false }] }), now)
        .filter((a) => a.dedupeKey.startsWith('purchase:')),
    ).toHaveLength(0);
  });
});

describe('sleepCheck', () => {
  const game = makeGame();
  const now = utc('2026-07-05T22:00:00');

  it('warns when a resource caps within the window', () => {
    // 180/200, 8 min per point → caps in 160 minutes, well within 8h.
    const state = makeState({
      games: [game],
      resources: [makeResource()],
      snapshots: [makeSnapshot({ value: 180, takenAt: now })],
    });
    const check = sleepCheck(state, game, 8, now);
    expect(check.caps).toBe(true);
    expect(check.fullAt).toBe(now + 160 * 60_000);
  });

  it('is calm when nothing caps and when already-full counts as capping now', () => {
    const safe = makeState({
      games: [game],
      resources: [makeResource()],
      snapshots: [makeSnapshot({ value: 10, takenAt: now })],
    });
    expect(sleepCheck(safe, game, 8, now).caps).toBe(false);

    const full = makeState({
      games: [game],
      resources: [makeResource()],
      snapshots: [makeSnapshot({ value: 200, takenAt: now - HOUR })],
    });
    expect(sleepCheck(full, game, 8, now)).toEqual({ caps: true, fullAt: now });
  });

  it('ignores games with no snapshots', () => {
    const state = makeState({ games: [game], resources: [makeResource()] });
    expect(sleepCheck(state, game, 8, now).caps).toBe(false);
  });
});
