import { DEFAULT_SETTINGS, detectLocalTz, emptyState } from '../src/index';
import { IANAZone } from 'luxon';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => vi.restoreAllMocks());

describe('local timezone defaults', () => {
  it('keeps the exported compatibility default neutral', () => {
    expect(DEFAULT_SETTINGS.localTz).toBe('UTC');
  });

  it('detects a valid IANA zone in this host', () => {
    expect(IANAZone.isValidZone(detectLocalTz())).toBe(true);
  });

  it('resolves each empty state from the host instead of a hardcoded city', () => {
    // Only resolvedOptions is stubbed, deliberately. Replacing the whole
    // Intl.DateTimeFormat constructor also breaks luxon's IANAZone.isValidZone,
    // which validates a zone by constructing a real formatter and calling
    // format() on it — so detectLocalTz would reject its own mocked answer and
    // fall back to UTC, failing this test against correct production code.
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
      timeZone: 'Pacific/Auckland',
    } as Intl.ResolvedDateTimeFormatOptions);

    expect(emptyState().settings.localTz).toBe('Pacific/Auckland');
  });
});
