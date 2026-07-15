import { describe, expect, it } from 'vitest';
import { checklistFor, completionId } from '../src/checklist';
import { taskPeriodKey } from '../src/periods';
import { makeEvent, makeGame, makeState, makeTask, utc } from './helpers';

describe('checklistFor', () => {
  const game = makeGame({ id: 'g1', tz: 'Etc/GMT-1', dailyResetHour: 4 });
  const now = utc('2026-07-13T12:00:00Z');

  it('lists open tasks with their current period key and completion state', () => {
    const task = makeTask({ id: 'daily', name: 'Dailies' });
    const periodKey = taskPeriodKey(game, task, now);
    const state = makeState({
      games: [game],
      tasks: [task],
      completions: [{ id: completionId('daily', periodKey), taskId: 'daily', periodKey, done: true, updatedAt: 1 }],
    });
    const items = checklistFor(state, game, now);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ name: 'Dailies', done: true, fromEvent: false, periodKey });
  });

  it('includes active daily-touch events as pseudo-tasks', () => {
    const event = makeEvent({
      id: 'evt1',
      dailyTouch: true,
      start: now - 60_000,
      end: now + 3_600_000,
      done: false,
    });
    const state = makeState({ games: [game], events: [event] });
    const items = checklistFor(state, game, now);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ name: 'Banner', fromEvent: true, done: false });
  });

  it('ignores deleted tasks and finished daily-touch events', () => {
    const state = makeState({
      games: [game],
      tasks: [makeTask({ deleted: true })],
      events: [makeEvent({ dailyTouch: true, start: now - 60_000, end: now + 60_000, done: true })],
    });
    expect(checklistFor(state, game, now)).toEqual([]);
  });

  it('tracks count progress and completion for weekly boss tasks', () => {
    const task = makeTask({
      id: 'wb',
      name: 'Weekly Bosses ×3',
      cadence: 'weekly',
      mode: 'count',
      countTarget: 3,
    });
    const periodKey = taskPeriodKey(game, task, now);
    const partial = makeState({
      games: [game],
      tasks: [task],
      completions: [
        { id: completionId('wb', periodKey), taskId: 'wb', periodKey, done: false, countDone: 2, updatedAt: 1 },
      ],
    });
    const items = checklistFor(partial, game, now);
    expect(items[0]).toMatchObject({ countDone: 2, countTarget: 3, done: false, mode: 'count' });

    const complete = makeState({
      games: [game],
      tasks: [task],
      completions: [
        { id: completionId('wb', periodKey), taskId: 'wb', periodKey, done: false, countDone: 3, updatedAt: 1 },
      ],
    });
    expect(checklistFor(complete, game, now)[0]!.done).toBe(true);
  });

  it('exposes timer running, ready, and done states for expedition tasks', () => {
    const task = makeTask({
      id: 'exp',
      name: 'Expeditions (collect + resend)',
      cadence: 'daily',
      mode: 'timer',
      timerDurationMinutes: 20 * 60,
      timerEndsAt: now + 3_600_000,
    });
    const running = checklistFor(makeState({ games: [game], tasks: [task] }), game, now)[0]!;
    expect(running).toMatchObject({ timerRunning: true, timerReady: false, done: false, mode: 'timer' });

    const readyTask = { ...task, timerEndsAt: now - 1_000 };
    const ready = checklistFor(makeState({ games: [game], tasks: [readyTask] }), game, now)[0]!;
    expect(ready).toMatchObject({ timerRunning: false, timerReady: true, done: true });
  });
});
