import { describe, expect, it } from 'vitest';
import { endsOvernight, lastPlayDay, morningOf, MORNING_MINUTES, playEnd, shownEnd } from '../src/play-day';
import { todaySteps } from '../src/today-steps';
import { makeEvent, makeGame, makeState, utc } from './helpers';

const TZ = 'Europe/Warsaw';
// 04:00 on Tuesday 24 November in Warsaw (UTC+1).
const TUESDAY_4AM = utc('2026-11-24T03:00:00Z');
const MONDAY_NOON = utc('2026-11-23T11:00:00Z');
const TUESDAY_MIDNIGHT = utc('2026-11-23T23:00:00Z');

describe('the play day', () => {
  it('counts an end in the small hours as the night before', () => {
    expect(endsOvernight(TUESDAY_4AM, TZ)).toBe(true);
    expect(playEnd(TUESDAY_4AM, TZ)).toBe(TUESDAY_MIDNIGHT);
    expect(lastPlayDay(TUESDAY_4AM, MONDAY_NOON, TZ).toISODate()).toBe('2026-11-23');
  });

  it('leaves a daytime end, and one at midnight itself, on their own day', () => {
    const afternoon = utc('2026-11-24T15:59:00Z');
    expect(endsOvernight(afternoon, TZ)).toBe(false);
    expect(playEnd(afternoon, TZ)).toBe(afternoon);
    expect(endsOvernight(TUESDAY_MIDNIGHT, TZ)).toBe(false);
    expect(lastPlayDay(TUESDAY_MIDNIGHT, MONDAY_NOON, TZ).toISODate()).toBe('2026-11-23');
  });

  it('starts the day when quiet hours end, or at 09:00 without them', () => {
    const base = { localTz: TZ, quietStart: null, quietEnd: null };
    expect(morningOf(base)).toBe(MORNING_MINUTES);
    expect(morningOf({ ...base, quietStart: 23 * 60, quietEnd: 3 * 60 })).toBe(180);
    // A quiet stretch ending in the afternoon is no morning.
    expect(morningOf({ ...base, quietStart: 9 * 60, quietEnd: 17 * 60 })).toBe(MORNING_MINUTES);
    expect(endsOvernight(TUESDAY_4AM, TZ, 180)).toBe(false);
  });

  it('shows the real end to a player still up past midnight', () => {
    const late = utc('2026-11-24T00:30:00Z');
    expect(shownEnd(TUESDAY_4AM, MONDAY_NOON, TZ)).toBe(TUESDAY_MIDNIGHT);
    expect(shownEnd(TUESDAY_4AM, late, TZ)).toBe(TUESDAY_4AM);
    expect(lastPlayDay(TUESDAY_4AM, late, TZ).toISODate()).toBe('2026-11-24');
  });

  it('asks for an overnight event on Today by midnight', () => {
    const state = makeState({
      games: [makeGame({ id: 'nikke', name: 'NIKKE', tz: 'UTC', dailyResetHour: 20 })],
      events: [makeEvent({ id: 'volt', gameId: 'nikke', type: 'event', start: MONDAY_NOON - 1, end: TUESDAY_4AM })],
    });
    state.settings = { ...state.settings, localTz: TZ, quietStart: null, quietEnd: null };
    const step = todaySteps(state, MONDAY_NOON)
      .groups.flatMap((group) => group.steps)
      .find((item) => item.kind === 'event')!;
    expect(step.at).toBe(TUESDAY_4AM);
    expect(step.actBy).toBe(TUESDAY_MIDNIGHT);
  });
});
