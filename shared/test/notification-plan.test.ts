import { describe, expect, it } from 'vitest';
import { buildNotificationPlan, completionId, taskPeriodKey } from '../src';
import { makeGame, makeResource, makeSnapshot, makeState, makeTask, utc } from './helpers';

const now = utc('2026-10-06T12:00:00Z');
const quietOff = { quietStart: null, quietEnd: null, localTz: 'UTC', sleepHours: 8, updatedAt: 0 };
function energyState() {
  return makeState({
    games: [makeGame()],
    resources: [makeResource({ cap: 100, regenMinutes: 6 })],
    snapshots: [makeSnapshot({ value: 80, takenAt: now })],
    settings: quietOff,
  });
}

describe('notification planning', () => {
  it('schedules a cap estimate thirty minutes before a freshly read resource fills', () => {
    const plan = buildNotificationPlan(energyState(), now);
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({ at: now + 90 * 60_000, gameId: 'g1' });
    expect(plan[0]?.body).toContain('Estimate from your last reading');
  });

  it('does not let one recent resource make a different stale reading eligible', () => {
    const state = energyState();
    state.resources[0]!.regenMinutes = 30;
    state.snapshots[0] = makeSnapshot({ value: 47, takenAt: now - 25 * 3_600_000 });
    state.resources.push(makeResource({ id: 'fresh', cap: 200, regenMinutes: 60 }));
    state.snapshots.push(makeSnapshot({ id: 'fresh-snapshot', resourceId: 'fresh', value: 1, takenAt: now }));
    expect(buildNotificationPlan(state, now)).toEqual([]);
  });

  it('does not alert from synthetic estimates, future readings or already-full meters', () => {
    const state = energyState();
    state.snapshots[0]!.provenance = { kind: 'estimate', observedAt: now, importedAt: now };
    expect(buildNotificationPlan(state, now)).toEqual([]);
    state.snapshots[0] = makeSnapshot({ value: 80, takenAt: now + 1 });
    expect(buildNotificationPlan(state, now)).toEqual([]);
    state.snapshots[0] = makeSnapshot({ value: 100, takenAt: now });
    expect(buildNotificationPlan(state, now)).toEqual([]);
  });

  it('respects same-day and overnight quiet hours in the selected timezone', () => {
    const state = energyState();
    state.settings = { ...quietOff, quietStart: 13 * 60, quietEnd: 15 * 60 };
    expect(buildNotificationPlan(state, now)).toEqual([]);
    state.settings = { ...quietOff, quietStart: 21 * 60, quietEnd: 7 * 60, localTz: 'Asia/Tokyo' };
    expect(buildNotificationPlan(state, now)).toEqual([]);
  });

  it('uses the next eligible action when the first deadline falls within quiet hours', () => {
    const state = energyState();
    state.settings = { ...quietOff, quietStart: 13 * 60, quietEnd: 14 * 60 };
    state.events = [
      {
        id: 'event',
        gameId: 'g1',
        name: 'Event',
        type: 'event',
        start: now - 1000,
        end: now + 4 * 3_600_000,
        dailyTouch: false,
        notify: true,
        notes: '',
        updatedAt: 1,
      },
    ];
    const plan = buildNotificationPlan(state, now);
    expect(plan).toHaveLength(1);
    expect(plan[0]?.at).toBe(now + 3.5 * 3_600_000);
    expect(plan[0]?.body).toContain('Event ends');
  });

  it('uses server task deadlines and skips completed tasks', () => {
    const game = makeGame({ tz: 'UTC', dailyResetHour: 16 });
    const task = makeTask();
    const state = makeState({ games: [game], tasks: [task], settings: quietOff });
    expect(buildNotificationPlan(state, now)[0]?.at).toBe(now + 3.5 * 3_600_000);
    const periodKey = taskPeriodKey(game, task, now);
    state.completions = [
      { id: completionId(task.id, periodKey), taskId: task.id, periodKey, done: true, updatedAt: now },
    ];
    expect(buildNotificationPlan(state, now)).toEqual([]);
  });

  it('skips paused and deleted games and their reminders, but keeps global reminders', () => {
    const state = energyState();
    state.games[0]!.paused = true;
    state.reminders = [
      { id: 'local', gameId: 'g1', message: 'Local', at: now + 60_000, updatedAt: now },
      { id: 'global', gameId: null, message: 'Global', at: now + 60_000, updatedAt: now },
    ];
    expect(buildNotificationPlan(state, now).map((item) => item.body)).toEqual(['Global']);
    state.games[0]!.paused = false;
    state.games[0]!.deleted = true;
    expect(buildNotificationPlan(state, now).map((item) => item.body)).toEqual(['Global']);
  });

  it('keeps IDs stable and limits notifications to 24 hours and 32 entries', () => {
    const state = makeState({
      settings: quietOff,
      reminders: Array.from({ length: 40 }, (_, index) => ({
        id: `r${index}`,
        gameId: null,
        message: `Reminder ${index}`,
        at: now + (index + 1) * 60_000,
        updatedAt: now,
      })),
    });
    const plan = buildNotificationPlan(state, now);
    expect(plan).toHaveLength(32);
    expect(new Set(plan.map((item) => item.id)).size).toBe(32);
    expect(buildNotificationPlan(state, now + 100).map((item) => item.id)).toEqual(plan.map((item) => item.id));
    state.reminders = [{ id: 'late', gameId: null, message: 'Later', at: now + 24 * 3_600_000 + 1, updatedAt: now }];
    expect(buildNotificationPlan(state, now)).toEqual([]);
  });

  it('creates at most one upcoming-action alert per game', () => {
    const state = energyState();
    state.tasks = [makeTask(), makeTask({ id: 'task2', cadence: 'weekly' })];
    expect(buildNotificationPlan(state, now)).toHaveLength(1);
  });
});
