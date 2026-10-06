import { describe, expect, it } from 'vitest';
import { emptyState } from '@memoria/shared';
import { makeGame, makeEvent } from '../../shared/test/helpers';
import { planSeedImport } from '../src/data/seed-events';
import { calendarSchedule } from '../src/event-schedule';

describe('confirmed calendar dates', () => {
  it.each(['UTC+1', 'UTC+8', 'UTC-5'])('keeps UTC+8 calendar dates on the %s server', (tz) => {
    const game = makeGame({ presetKey: 'genshin', tz });
    const plans = planSeedImport({ ...emptyState(), games: [game] }, Date.parse('2026-10-03T12:00:00Z'));
    for (const [key, label] of [
      ['predictive-victory', '12–20 Oct'],
      ['snowball', '21 Oct–2 Nov'],
      ['overflowing-favor', '26 Oct–2 Nov'],
    ]) {
      const plan = plans.find((row) => row.seed?.sourceKey === `seed:genshin:7.1-${key}`)!;
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
