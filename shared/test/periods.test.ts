import { describe, expect, it } from 'vitest';
import {
  currentMonthlyPeriodStart,
  customPeriodKey,
  dailyPeriodKey,
  monthlyPeriodKey,
  nextCustomReset,
  nextDailyReset,
  nextMonthlyReset,
  nextWeeklyReset,
  weeklyPeriodKey,
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

describe.each([
  {
    monthlyResetDay: 31,
    effectiveDay: 28,
    boundaries: [
      {
        name: 'a 30-day month',
        before: '2026-04-28T02:59:00',
        boundary: '2026-04-28T03:00:00',
        previousKey: 'M2026-03',
        currentKey: 'M2026-04',
        previousStart: '2026-03-28T03:00:00',
        next: '2026-05-28T03:00:00',
      },
      {
        name: 'a 31-day month',
        before: '2026-05-28T02:59:00',
        boundary: '2026-05-28T03:00:00',
        previousKey: 'M2026-04',
        currentKey: 'M2026-05',
        previousStart: '2026-04-28T03:00:00',
        next: '2026-06-28T03:00:00',
      },
      {
        name: 'a year boundary',
        before: '2026-12-28T02:59:00',
        boundary: '2026-12-28T03:00:00',
        previousKey: 'M2026-11',
        currentKey: 'M2026-12',
        previousStart: '2026-11-28T03:00:00',
        next: '2027-01-28T03:00:00',
      },
    ],
  },
  {
    monthlyResetDay: 0,
    effectiveDay: 1,
    boundaries: [
      {
        name: 'a 30-day month',
        before: '2026-04-01T02:59:00',
        boundary: '2026-04-01T03:00:00',
        previousKey: 'M2026-03',
        currentKey: 'M2026-04',
        previousStart: '2026-03-01T03:00:00',
        next: '2026-05-01T03:00:00',
      },
      {
        name: 'a 31-day month',
        before: '2026-05-01T02:59:00',
        boundary: '2026-05-01T03:00:00',
        previousKey: 'M2026-04',
        currentKey: 'M2026-05',
        previousStart: '2026-04-01T03:00:00',
        next: '2026-06-01T03:00:00',
      },
      {
        name: 'a year boundary',
        before: '2027-01-01T02:59:00',
        boundary: '2027-01-01T03:00:00',
        previousKey: 'M2026-12',
        currentKey: 'M2027-01',
        previousStart: '2026-12-01T03:00:00',
        next: '2027-02-01T03:00:00',
      },
    ],
  },
  {
    monthlyResetDay: -5,
    effectiveDay: 1,
    boundaries: [
      {
        name: 'a 30-day month',
        before: '2026-04-01T02:59:00',
        boundary: '2026-04-01T03:00:00',
        previousKey: 'M2026-03',
        currentKey: 'M2026-04',
        previousStart: '2026-03-01T03:00:00',
        next: '2026-05-01T03:00:00',
      },
      {
        name: 'a 31-day month',
        before: '2026-05-01T02:59:00',
        boundary: '2026-05-01T03:00:00',
        previousKey: 'M2026-04',
        currentKey: 'M2026-05',
        previousStart: '2026-04-01T03:00:00',
        next: '2026-06-01T03:00:00',
      },
      {
        name: 'a year boundary',
        before: '2027-01-01T02:59:00',
        boundary: '2027-01-01T03:00:00',
        previousKey: 'M2026-12',
        currentKey: 'M2027-01',
        previousStart: '2026-12-01T03:00:00',
        next: '2027-02-01T03:00:00',
      },
    ],
  },
])('monthly periods with out-of-range reset day $monthlyResetDay', ({ monthlyResetDay, effectiveDay, boundaries }) => {
  const invalidGame = makeGame({ ...game, monthlyResetDay });

  it.each(boundaries)(`uses day ${effectiveDay} consistently through $name`, (boundary) => {
    const before = utc(boundary.before);
    const atBoundary = utc(boundary.boundary);

    expect(monthlyPeriodKey(invalidGame, before)).toBe(boundary.previousKey);
    expect(currentMonthlyPeriodStart(invalidGame, before)).toBe(utc(boundary.previousStart));
    expect(nextMonthlyReset(invalidGame, before)).toBe(atBoundary);

    expect(monthlyPeriodKey(invalidGame, atBoundary)).toBe(boundary.currentKey);
    expect(currentMonthlyPeriodStart(invalidGame, atBoundary)).toBe(atBoundary);
    expect(nextMonthlyReset(invalidGame, atBoundary)).toBe(utc(boundary.next));
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

describe('DST-safe game-day boundaries (Europe/Warsaw, 04:00 reset)', () => {
  const warsaw = makeGame({
    tz: 'Europe/Warsaw',
    dailyResetHour: 4,
    weeklyResetDay: 7,
    monthlyResetDay: 1,
  });

  it('rolls the daily key at 04:00 local on the fall-back day, not 03:00', () => {
    // 03:00 CET = 02:00Z; 04:00 CET = 03:00Z.
    expect(dailyPeriodKey(warsaw, utc('2026-10-25T02:00:00'))).toBe('D2026-10-24');
    expect(dailyPeriodKey(warsaw, utc('2026-10-25T02:59:59'))).toBe('D2026-10-24');
    expect(dailyPeriodKey(warsaw, utc('2026-10-25T03:00:00'))).toBe('D2026-10-25');
  });

  it('rolls the daily key at 04:00 local on the spring-forward day, not 03:00', () => {
    // 03:00 CEST = 01:00Z; 04:00 CEST = 02:00Z.
    expect(dailyPeriodKey(warsaw, utc('2026-03-29T01:00:00'))).toBe('D2026-03-28');
    expect(dailyPeriodKey(warsaw, utc('2026-03-29T01:59:59'))).toBe('D2026-03-28');
    expect(dailyPeriodKey(warsaw, utc('2026-03-29T02:00:00'))).toBe('D2026-03-29');
  });

  it('keeps the weekly boundary at 04:00 local through fall-back', () => {
    expect(weeklyPeriodKey(warsaw, utc('2026-10-25T02:00:00'))).toBe('W2026-10-18');
    expect(nextWeeklyReset(warsaw, utc('2026-10-25T02:00:00'))).toBe(utc('2026-10-25T03:00:00'));
    expect(weeklyPeriodKey(warsaw, utc('2026-10-25T03:00:00'))).toBe('W2026-10-25');
    expect(nextWeeklyReset(warsaw, utc('2026-10-25T03:00:00'))).toBe(utc('2026-11-01T03:00:00'));
  });

  it('keeps custom-cadence keys and reset timestamps at 04:00 local through fall-back', () => {
    const task = makeTask({
      cadence: 'custom',
      intervalDays: 7,
      anchorAt: utc('2026-10-18T02:00:00'),
    });

    expect(customPeriodKey(warsaw, task, utc('2026-10-25T02:00:00'))).toBe('C0');
    expect(nextCustomReset(warsaw, task, utc('2026-10-25T02:00:00'))).toBe(utc('2026-10-25T03:00:00'));
    expect(customPeriodKey(warsaw, task, utc('2026-10-25T03:00:00'))).toBe('C1');
  });
});

describe('fixed-offset game-day boundaries', () => {
  it('remain at 04:00 UTC+1 on both seasonal-transition dates', () => {
    for (const [date, previousDate] of [
      ['2026-03-29', '2026-03-28'],
      ['2026-10-25', '2026-10-24'],
    ] as const) {
      expect(dailyPeriodKey(game, utc(`${date}T02:59:59`))).toBe(`D${previousDate}`);
      expect(dailyPeriodKey(game, utc(`${date}T03:00:00`))).toBe(`D${date}`);
      expect(nextDailyReset(game, utc(`${date}T02:59:59`))).toBe(utc(`${date}T03:00:00`));
    }
  });
});
