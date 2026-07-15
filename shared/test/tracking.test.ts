import { describe, expect, it } from 'vitest';
import { projectEnergy } from '../src/energy';
import {
  effectiveCountTarget,
  effectiveResourceKind,
  effectiveTaskMode,
  inferLegacyResource,
  inferLegacyTask,
} from '../src/tracking';
import { makeGame, makeResource, makeTask } from './helpers';

describe('legacy tracking inference', () => {
  it('classifies built-in resources and tasks without losing user data', () => {
    expect(effectiveResourceKind(makeResource({ name: 'Condensed Resin', regenMinutes: 0 }))).toBe('counter');
    expect(effectiveResourceKind(makeResource({ name: 'City Stamina', regenMinutes: 0 }))).toBe('weekly');
    expect(
      inferLegacyResource(makeResource({ name: 'Trailblaze Power', reserveCap: 2400, regenMinutes: 6 })).reserveLabel,
    ).toBe('Reserve TB Power');

    const expedition = inferLegacyTask(makeTask({ name: 'Expeditions (collect + resend)', cadence: 'daily' }));
    expect(expedition.mode).toBe('timer');
    expect(expedition.timerDurationMinutes).toBe(20 * 60);

    const bosses = inferLegacyTask(makeTask({ name: 'Weekly Bosses ×3', cadence: 'weekly' }));
    expect(bosses.mode).toBe('count');
    expect(effectiveCountTarget(bosses)).toBe(3);
    expect(effectiveTaskMode(makeTask({ name: 'Daily Commissions' }))).toBe('check');
  });

  it('keeps explicit metadata when already present', () => {
    expect(effectiveResourceKind(makeResource({ name: 'Custom', regenMinutes: 6, kind: 'counter' }))).toBe('counter');
    expect(effectiveTaskMode(makeTask({ name: 'Custom', mode: 'timer' }))).toBe('timer');
  });
});

describe('weekly refill projection', () => {
  it('refills to cap after the server week turns over', () => {
    const game = makeGame({ tz: 'Etc/GMT-1', weeklyResetDay: 1, dailyResetHour: 4 });
    const res = makeResource({ name: 'City Stamina', regenMinutes: 0, cap: 100, kind: 'weekly' });
    const now = Date.parse('2026-07-13T12:00:00Z');
    const beforeWeek = projectEnergy(res, { value: 12, takenAt: Date.parse('2026-07-06T10:00:00Z') }, now, game);
    expect(beforeWeek.value).toBe(100);
  });

  it('respects America server timezone boundaries', () => {
    const game = makeGame({ tz: 'Etc/GMT+5', weeklyResetDay: 1, dailyResetHour: 4 });
    const res = makeResource({ name: 'City Stamina', regenMinutes: 0, cap: 80, kind: 'weekly' });
    const now = Date.parse('2026-07-14T10:00:00Z'); // Monday after reset in UTC-5
    const projected = projectEnergy(res, { value: 15, takenAt: Date.parse('2026-07-07T12:00:00Z') }, now, game);
    expect(projected.value).toBe(80);
    expect(projected.weeklyResetAt).toBeTruthy();
  });
});
