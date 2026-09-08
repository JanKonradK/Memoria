import { describe, expect, it } from 'vitest';
import { checklistFor, completionId } from '../src/checklist';
import { migrateState } from '../src/migrations';
import { taskPeriodKey } from '../src/periods';
import { type AppState } from '../src/types';
import { makeGame, makeState, makeTask } from './helpers';

describe('routine upgrade', () => {
  it('updates existing defaults, keeps custom timers and deleted routines, and is idempotent', () => {
    const state = makeState({
      schemaVersion: 7,
      games: ['genshin', 'nte', 'wuwa', 'uma'].map((presetKey) => makeGame({ id: presetKey, presetKey })),
      tasks: [
        makeTask({
          id: 'commissions',
          gameId: 'genshin',
          presetTaskKey: 'genshin-commissions',
          mode: 'count',
          countTarget: 4,
        }),
        makeTask({
          id: 'random',
          gameId: 'genshin',
          presetTaskKey: 'genshin-random-events',
          mode: 'count',
          countTarget: 10,
        }),
        makeTask({
          id: 'parametric',
          gameId: 'genshin',
          presetTaskKey: 'genshin-parametric',
          cadence: 'custom',
          mode: 'check',
        }),
        makeTask({
          id: 'crystal',
          gameId: 'genshin',
          presetTaskKey: 'genshin-crystalfly',
          cadence: 'custom',
          mode: 'check',
        }),
        makeTask({
          id: 'custom',
          gameId: 'genshin',
          presetTaskKey: 'genshin-parametric',
          mode: 'timer',
          timerDurationMinutes: 90,
        }),
        makeTask({ id: 'mews', gameId: 'nte', presetTaskKey: 'nte-mews-flash', name: 'Mews Flash lottery' }),
        makeTask({ id: 'deleted', gameId: 'uma', presetTaskKey: 'uma-independent-training', deleted: true }),
      ],
      completions: [{ id: 'used', taskId: 'parametric', periodKey: 'old', done: true, updatedAt: 1000 }],
    });
    const migrated = migrateState(state) as AppState;
    expect(migrated.tasks.find((task) => task.id === 'commissions')).toMatchObject({ mode: 'check' });
    expect(migrated.tasks.find((task) => task.id === 'random')?.countTarget).toBeUndefined();
    expect(migrated.tasks.find((task) => task.id === 'parametric')).toMatchObject({
      mode: 'timer',
      timerDurationMinutes: 9960,
      timerEndsAt: 1000 + 9960 * 60_000,
    });
    expect(migrated.tasks.find((task) => task.id === 'crystal')).toMatchObject({
      mode: 'timer',
      timerDurationMinutes: 10080,
      timerEndsAt: null,
    });
    expect(migrated.tasks.find((task) => task.id === 'custom')?.timerDurationMinutes).toBe(90);
    expect(migrated.tasks.find((task) => task.id === 'mews')?.deleted).toBe(true);
    expect(migrated.tasks.filter((task) => task.presetTaskKey === 'uma-independent-training')).toHaveLength(1);
    expect(migrated.tasks.find((task) => task.presetTaskKey === 'wuwa-tacet-fields')).toMatchObject({
      cadence: 'daily',
      mode: 'count',
      countTarget: 4,
    });
    expect(migrated.chips.find((chip) => chip.gameId === 'uma')).toMatchObject({
      label: 'Independent Training',
      delta: -30,
    });
    expect(migrateState(migrated)).toEqual(migrated);
  });

  it('unticks personal cooldowns at the exact expiry, even after reload or a period change', () => {
    const game = makeGame();
    const now = Date.parse('2026-09-07T12:00:00Z');
    const task = makeTask({
      cadence: 'custom',
      mode: 'timer',
      timelineLinked: false,
      intervalDays: 1,
      timerEndsAt: now + 1000,
      timerDurationMinutes: 50,
    });
    const periodKey = taskPeriodKey(game, task, now);
    const state = makeState({
      games: [game],
      tasks: [task],
      completions: [{ id: completionId(task.id, periodKey), taskId: task.id, periodKey, done: true, updatedAt: now }],
    });
    expect(checklistFor(state, game, now)[0]).toMatchObject({ done: true, timerRunning: true });
    expect(checklistFor(JSON.parse(JSON.stringify(state)), game, now + 1000)[0]).toMatchObject({
      done: false,
      timerReady: true,
    });
    expect(checklistFor(state, game, now + 86_400_000)[0]).toMatchObject({ done: false, timerReady: true });
  });
});
