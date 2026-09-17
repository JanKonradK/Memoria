import { describe, expect, it } from 'vitest';
import { redemptionCodeStatus } from '../src/redemption';

describe('redemptionCodeStatus', () => {
  it('closes the redemption window at its absolute deadline', () => {
    const deadline = Date.parse('2026-09-20T23:59:00+08:00');
    expect(redemptionCodeStatus(deadline, Date.parse('2026-09-20T15:58:59Z'))).toBe('available');
    expect(redemptionCodeStatus(deadline, Date.parse('2026-09-20T15:59:00Z'))).toBe('expired');
  });
  it('does not promise availability without a valid deadline', () => {
    expect(redemptionCodeStatus(undefined, Date.now())).toBe('unknown');
    expect(redemptionCodeStatus(NaN, Date.now())).toBe('unknown');
  });
});
