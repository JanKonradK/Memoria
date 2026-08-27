import { describe, expect, it } from 'vitest';
import { fmtDateTimeLocalInput, parseDateTimeLocalInput } from '../src/util';

describe('datetime-local helpers', () => {
  it('round-trips the same epoch in a zone other than the test runner zone', () => {
    const runnerZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const zone = runnerZone === 'Pacific/Kiritimati' ? 'America/New_York' : 'Pacific/Kiritimati';
    const epoch = Date.UTC(2026, 6, 19, 12, 34);

    const input = fmtDateTimeLocalInput(epoch, zone);

    expect(parseDateTimeLocalInput(input, zone)).toBe(epoch);
  });
});
