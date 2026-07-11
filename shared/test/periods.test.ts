import { describe, expect, it } from 'vitest';
import {
  dailyPeriodKey,
  monthlyPeriodKey,
  nextCustomReset,
  nextDailyReset,
  nextMonthlyReset,
  nextWeeklyReset,
  weeklyPeriodKey,
  customPeriodKey,
} from '../src/periods';
import { makeGame, makeTask, utc } from './helpers';

// Europe server: fixed UTC+1, daily reset 04:00 server time = 03:00 UTC.
const game = makeGame({ tz: 'Etc/GMT-1', dailyResetHour: 4, weeklyResetDay: 1, monthlyResetDay: 1 });

describe('daily periods (UTC+1 server, 04:00 reset)', () => {
  it('assigns pre-reset time to the previous game day', () => {
    expect(dailyPeriodKey(game, utc('2026-07-02T02:59:00'))).toBe('D2026-07-01');
  });
  it('rolls over exactly at reset', () => {
    expect(dailyPeriodKey(game, utc('2026-07-02T03:00:00'))).toBe('D2026-07-02');
  });
  it('computes next reset before and after the boundary', () => {
    expect(nextDailyReset(game, utc('2026-07-02T02:59:00'))).toBe(utc('2026-07-02T03:00:00'));
    expect(nextDailyReset(game, utc('2026-07-02T03:00:00'))).toBe(utc('2026-07-03T03:00:00'));
  });
});

describe('weekly periods (Monday reset)', () => {
  it('keys the week by its Monday', () => {
    // 2026-07-02 is a Thursday.
    expect(weeklyPeriodKey(game, utc('2026-07-02T12:00:00'))).toBe('W2026-06-29');
  });
  it('keeps Monday pre-reset in the previous week', () => {
    // Monday 2026-07-06 at 03:00 server (02:00 UTC) — one hour before reset.
    expect(weeklyPeriodKey(game, utc('2026-07-06T02:00:00'))).toBe('W2026-06-29');
    expect(weeklyPeriodKey(game, utc('2026-07-06T03:00:00'))).toBe('W2026-07-06');
  });
  it('finds the next weekly reset', () => {
    expect(nextWeeklyReset(game, utc('2026-07-02T12:00:00'))).toBe(utc('2026-07-06T03:00:00'));
    // On Monday just before reset → today's reset.
    expect(nextWeeklyReset(game, utc('2026-07-06T02:00:00'))).toBe(utc('2026-07-06T03:00:00'));
    // On Monday right at reset → next Monday.
    expect(nextWeeklyReset(game, utc('2026-07-06T03:00:00'))).toBe(utc('2026-07-13T03:00:00'));
  });
});

describe('monthly periods (1st reset)', () => {
  it('keeps the 1st pre-reset in the previous month', () => {
    expect(monthlyPeriodKey(game, utc('2026-07-01T02:00:00'))).toBe('M2026-06');
    expect(monthlyPeriodKey(game, utc('2026-07-01T03:00:00'))).toBe('M2026-07');
  });
  it('finds the next monthly reset', () => {
    expect(nextMonthlyReset(game, utc('2026-07-15T00:00:00'))).toBe(utc('2026-08-01T03:00:00'));
    expect(nextMonthlyReset(game, utc('2026-07-01T02:00:00'))).toBe(utc('2026-07-01T03:00:00'));
  });
});

describe('custom interval periods', () => {
  const task = makeTask({ cadence: 'custom', intervalDays: 2, anchorAt: utc('2026-07-01T10:00:00') });
  it('groups days into interval buckets', () => {
    expect(customPeriodKey(game, task, utc('2026-07-01T12:00:00'))).toBe('C0');
    expect(customPeriodKey(game, task, utc('2026-07-02T12:00:00'))).toBe('C0');
    expect(customPeriodKey(game, task, utc('2026-07-03T12:00:00'))).toBe('C1');
  });
  it('computes the next period boundary at the reset hour', () => {
    expect(nextCustomReset(game, task, utc('2026-07-02T12:00:00'))).toBe(utc('2026-07-03T03:00:00'));
  });
});

describe('DST-aware server timezone', () => {
  // Dokkan-style: US Pacific, 17:00 reset. US DST starts 2026-03-08.
  const dokkan = makeGame({ tz: 'America/Los_Angeles', dailyResetHour: 17 });
  it('tracks the local reset hour across the DST switch', () => {
    // 2026-03-07 17:00 PST = 2026-03-08T01:00Z
    expect(nextDailyReset(dokkan, utc('2026-03-07T20:00:00'))).toBe(utc('2026-03-08T01:00:00'));
    // 2026-03-08 17:00 PDT (after spring forward) = 2026-03-09T00:00Z
    expect(nextDailyReset(dokkan, utc('2026-03-08T02:00:00'))).toBe(utc('2026-03-09T00:00:00'));
  });
});
