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
    expect(items[0]).toMatchObject({ name: 'Dailies', done: true, periodKey });
  });

  it('never turns events into checklist items — they belong to the card event strip', () => {
    const event = makeEvent({
      id: 'evt1',
      dailyTouch: true,
      start: now - 60_000,
      end: now + 3_600_000,
      done: false,
    });
    const state = makeState({ games: [game], events: [event] });
    expect(checklistFor(state, game, now)).toEqual([]);
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

  describe('timeline-linked cycles', () => {
    const task = makeTask({ id: 'cyc', name: 'ToA Hazard Zone cycle', cadence: 'custom', intervalDays: 28 });

    it('follows the active matching window: resets when it ends, per-window period key', () => {
      const win = makeEvent({ id: 'w1', name: 'Hazard Zone 2.6', type: 'cycle', start: now - 1000, end: now + 5000 });
      const items = checklistFor(makeState({ games: [game], tasks: [task], events: [win] }), game, now);
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ periodKey: 'win:w1', resetAt: now + 5000 });
    });

    it('hides the task between windows (an upcoming window exists)', () => {
      const past = makeEvent({ id: 'w0', name: 'Hazard Zone 2.5', type: 'cycle', start: now - 9000, end: now - 1000 });
      const next = makeEvent({ id: 'wN', name: 'Hazard Zone 2.6', type: 'cycle', start: now + 5000, end: now + 9000 });
      expect(checklistFor(makeState({ games: [game], tasks: [task], events: [past, next] }), game, now)).toEqual([]);
    });

    it('falls back to the interval when matching windows are all past or degenerate', () => {
      const past = makeEvent({ id: 'w0', name: 'Hazard Zone 2.5', type: 'cycle', start: now - 9000, end: now - 1000 });
      const zero = makeEvent({ id: 'wz', name: 'Hazard Zone 2.6', type: 'cycle', start: now + 5000, end: now + 5000 });
      const items = checklistFor(makeState({ games: [game], tasks: [task], events: [past, zero] }), game, now);
      expect(items).toHaveLength(1);
      expect(items[0]!.periodKey.startsWith('win:')).toBe(false);
    });

    it('matches short task tokens as acronyms of event names (MoC ↔ Memory of Chaos)', () => {
      const endgame = makeTask({ id: 'eg', name: 'Endgame refresh (MoC/PF/AS/AA)', cadence: 'custom' });
      const moc = makeEvent({
        id: 'moc',
        name: 'Memory of Chaos 3.5',
        type: 'cycle',
        start: now - 1000,
        end: now + 5000,
      });
      const items = checklistFor(makeState({ games: [game], tasks: [endgame], events: [moc] }), game, now);
      expect(items[0]).toMatchObject({ periodKey: 'win:moc' });
    });

    it('falls back to the internal interval when no events match (personal cooldowns)', () => {
      const unrelated = makeEvent({ id: 'e9', name: 'Character Banner', start: now - 1000, end: now + 5000 });
      const cooldown = makeTask({ id: 'pt', name: 'Parametric Transformer', cadence: 'custom', intervalDays: 7 });
      const items = checklistFor(makeState({ games: [game], tasks: [cooldown], events: [unrelated] }), game, now);
      expect(items).toHaveLength(1);
      expect(items[0]!.periodKey.startsWith('win:')).toBe(false);
    });

    it('honors the keyword override and the timelineLinked=false opt-out', () => {
      const win = makeEvent({ id: 'w2', name: 'Endgame: Special Rerun', start: now - 1000, end: now + 5000 });
      const keyword = makeTask({ id: 'kw', name: 'Totally different name', cadence: 'custom', timelineMatch: 'rerun' });
      const linked = checklistFor(makeState({ games: [game], tasks: [keyword], events: [win] }), game, now);
      expect(linked[0]).toMatchObject({ periodKey: 'win:w2' });

      const optOut = makeTask({ ...task, timelineLinked: false });
      const win2 = makeEvent({ id: 'w3', name: 'Hazard Zone 2.6', type: 'cycle', start: now - 1000, end: now + 5000 });
      const items = checklistFor(makeState({ games: [game], tasks: [optOut], events: [win2] }), game, now);
      expect(items).toHaveLength(1);
      expect(items[0]!.periodKey.startsWith('win:')).toBe(false);
    });
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

    // A returned dispatch is work owed, not work done: the rewards are still
    // sitting in the game waiting to be collected and resent.
    const readyTask = { ...task, timerEndsAt: now - 1_000 };
    const ready = checklistFor(makeState({ games: [game], tasks: [readyTask] }), game, now)[0]!;
    expect(ready).toMatchObject({ timerRunning: false, timerReady: true, done: false });

    const collected = checklistFor(
      makeState({
        games: [game],
        tasks: [readyTask],
        completions: [
          {
            id: `exp|${ready.periodKey}`,
            taskId: 'exp',
            periodKey: ready.periodKey,
            done: true,
            updatedAt: now,
          },
        ],
      }),
      game,
      now,
    )[0]!;
    expect(collected).toMatchObject({ timerReady: true, done: true });
  });
});
