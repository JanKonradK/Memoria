import { describe, expect, it } from 'vitest';
import { completionId, gameGlance, glanceLine, shortDuration, taskPeriodKey } from '../src';
import { makeGame, makeResource, makeSnapshot, makeState, makeTask, utc } from './helpers';

const now = utc('2026-10-06T12:00:00Z');

describe('game glance', () => {
  it('summarises energy and unfinished dailies and weeklies in one line', () => {
    const game = makeGame();
    const state = makeState({
      games: [game],
      resources: [makeResource({ name: 'Resin', cap: 200, regenMinutes: 8 })],
      snapshots: [makeSnapshot({ value: 140, takenAt: now })],
      tasks: [
        makeTask({ id: 'd1', cadence: 'daily' }),
        makeTask({ id: 'd2', cadence: 'daily' }),
        makeTask({ id: 'w1', cadence: 'weekly' }),
      ],
    });
    const glance = gameGlance(state, game, now);
    expect(glance.energy).toEqual([
      { name: 'Resin', value: 140, cap: 200, regenMinutes: 8, isFull: false, fullAt: now + 480 * 60_000 },
    ]);
    expect(glance.left).toEqual({ daily: 2, weekly: 1 });
    expect(glanceLine(glance, now)).toBe('Resin 140/200, full in 8h 00m · 2 dailies left · 1 weekly left');
  });

  it('skips meters without a reading and finished tasks', () => {
    const game = makeGame();
    const task = makeTask({ cadence: 'daily' });
    const state = makeState({
      games: [game],
      resources: [makeResource()],
      tasks: [task],
      completions: [
        {
          id: completionId(task.id, taskPeriodKey(game, task, now)),
          taskId: task.id,
          periodKey: taskPeriodKey(game, task, now),
          done: true,
          updatedAt: now,
        },
      ],
    });
    const glance = gameGlance(state, game, now);
    expect(glance.energy).toEqual([]);
    expect(glance.left).toEqual({ daily: 0, weekly: 0 });
    expect(glanceLine(glance, now)).toBe('All done for today.');
  });

  it('reports a capped meter as full', () => {
    const game = makeGame();
    const state = makeState({
      games: [game],
      resources: [makeResource({ cap: 100 })],
      snapshots: [makeSnapshot({ value: 100, takenAt: now - 60_000 })],
    });
    expect(glanceLine(gameGlance(state, game, now), now)).toBe('Resin 100/100, full');
  });

  it('formats short durations', () => {
    expect(shortDuration(30_000)).toBe('1m');
    expect(shortDuration(65 * 60_000)).toBe('1h 05m');
    expect(shortDuration(50 * 3_600_000)).toBe('2d 2h');
  });
});
