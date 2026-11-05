import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import { timelineWindow, weekResetLines } from '../src/timeline-window';

const NOW = Date.parse('2026-11-05T11:30:00Z'); // a Thursday
const hoyo = { tz: 'Etc/GMT-1', dailyResetHour: 4, weeklyResetDay: 1, monthlyResetDay: 1 };
const nte = { tz: 'Europe/Warsaw', dailyResetHour: 5, weeklyResetDay: 1, monthlyResetDay: 1 };

describe('timelineWindow', () => {
  it('runs from midnight a week ago to the end of the 21st day ahead', () => {
    const { start, end } = timelineWindow(NOW, 'Europe/London');
    expect(new Date(start).toISOString()).toBe('2026-10-29T00:00:00.000Z');
    expect(new Date(end).toISOString()).toBe('2026-11-27T00:00:00.000Z');
  });
});

describe('weekResetLines', () => {
  const { start, end } = timelineWindow(NOW, 'Europe/London');

  it('follows the weekly reset most games share', () => {
    const lines = weekResetLines([hoyo, hoyo, nte], start, end, 'Europe/London');
    expect(lines.map((line) => new Date(line).toISOString())).toEqual([
      '2026-11-02T03:00:00.000Z',
      '2026-11-09T03:00:00.000Z',
      '2026-11-16T03:00:00.000Z',
      '2026-11-23T03:00:00.000Z',
    ]);
  });

  it('keeps the reset hour in the game zone across a DST change', () => {
    const march = timelineWindow(Date.parse('2027-03-20T12:00:00Z'), 'Europe/London');
    const lines = weekResetLines([nte], march.start, march.end, 'Europe/London');
    for (const line of lines) {
      expect(DateTime.fromMillis(line, { zone: 'Europe/Warsaw' }).toFormat('ccc HH:mm')).toBe('Mon 05:00');
    }
  });

  it('falls back to Monday midnight with no games', () => {
    const lines = weekResetLines([], start, end, 'Europe/London');
    expect(DateTime.fromMillis(lines[0]!, { zone: 'Europe/London' }).toFormat('ccc HH:mm')).toBe('Mon 00:00');
  });
});
