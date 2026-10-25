import { describe, expect, it, vi } from 'vitest';
import { emptyState } from '@memoria/shared';
import { makeGame, makeEvent } from '../../shared/test/helpers';
import { planSeedImport } from '../src/data/seed-events';
import { calendarSchedule } from '../src/event-schedule';

// The bundle has no date-only rows once every notice prints an hour, so these
// fixtures keep the calendar-date path covered.
vi.mock('../src/data/seed-feed', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/data/seed-feed')>();
  const fixture = (key: string, name: string, start: string, end: string) => ({
    game: 'genshin',
    name,
    type: 'event' as const,
    start: `${start} 00:00`,
    end: `${end} 23:59`,
    timezone: 'UTC+8',
    notify: false,
    dateOnly: true,
    notes: 'Estimated dates.',
    sourceKey: `seed:genshin:test-${key}`,
  });
  return {
    ...actual,
    SEED_EVENTS: [
      ...actual.SEED_EVENTS,
      fixture('snowball', 'Calendar fixture A', '2026-10-21', '2026-11-02'),
      fixture('overflowing-favor', 'Calendar fixture B', '2026-10-26', '2026-11-02'),
    ],
  };
});

describe('confirmed calendar dates', () => {
  it.each(['UTC+1', 'UTC+8', 'UTC-5'])('keeps UTC+8 calendar dates on the %s server', (tz) => {
    const game = makeGame({ presetKey: 'genshin', tz });
    const plans = planSeedImport({ ...emptyState(), games: [game] }, Date.parse('2026-10-03T12:00:00Z'));
    for (const [key, label] of [
      ['snowball', '21 Oct–2 Nov'],
      ['overflowing-favor', '26 Oct–2 Nov'],
    ]) {
      const plan = plans.find((row) => row.seed?.sourceKey === `seed:genshin:test-${key}`)!;
      const event = makeEvent({
        sourceKey: plan.seed!.sourceKey,
        name: plan.seed!.name,
        start: plan.start!,
        end: plan.end!,
      });
      expect(event.name).not.toContain('TBC');
      expect(plan.seed?.notify).toBe(false);
      expect(calendarSchedule(event)).toMatchObject({ label, zone: 'UTC+8' });
      expect(calendarSchedule({ ...event, name: 'My title' })?.label).toBe(label);
      expect(calendarSchedule({ ...event, end: event.end - 3_600_000 })).toBeUndefined();
    }
  });

  it('keeps exact selector deadlines and personal schedules on the clock', () => {
    expect(calendarSchedule(makeEvent({ sourceKey: 'seed:genshin:7.1-standard-selector' }))).toBeUndefined();
    expect(calendarSchedule(makeEvent({ name: 'Predictive Victory Dynamics' }))).toBeUndefined();
  });
});
