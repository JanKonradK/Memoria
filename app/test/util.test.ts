import { describe, expect, it } from 'vitest';
import { fmtDateTimeLocalInput, localResetLabel, parseDateTimeLocalInput } from '../src/util';

describe('datetime-local helpers', () => {
  it('round-trips the same epoch in a zone other than the test runner zone', () => {
    const runnerZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const zone = runnerZone === 'Pacific/Kiritimati' ? 'America/New_York' : 'Pacific/Kiritimati';
    const epoch = Date.UTC(2026, 6, 19, 12, 34);

    const input = fmtDateTimeLocalInput(epoch, zone);

    expect(parseDateTimeLocalInput(input, zone)).toBe(epoch);
  });
});

describe('local reset labels', () => {
  it('returns to the configured reset hour after a skipped DST hour', () => {
    const game = { tz: 'Europe/London', dailyResetHour: 1 };
    expect(localResetLabel(game, 'Europe/London', Date.parse('2026-03-29T12:00:00Z'))).toBe('01:00');
  });

  it('keeps the fallback label for an invalid saved timezone', () => {
    expect(localResetLabel({ tz: 'Invalid/Zone', dailyResetHour: 4 }, 'UTC', Date.now())).toBe('04:00');
  });
});
