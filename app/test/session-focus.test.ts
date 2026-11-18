import { describe, expect, it } from 'vitest';
import { makeGame, makeResource, makeSnapshot, makeState, makeTask } from '../../shared/test/helpers';
import { nudgeLine, sessionNeed, type PlaySession } from '../src/session-focus';

const NOW = Date.parse('2026-11-18T16:00:00Z');
const game = makeGame({ id: 'hsr', name: 'Honkai: Star Rail' });
const power = makeResource({
  id: 'power',
  gameId: 'hsr',
  name: 'Trailblaze Power',
  cap: 300,
  regenMinutes: 6,
  reserveCap: 2400,
  reserveLabel: 'Reserved Trailblaze Power',
});
const daily = makeTask({ id: 'daily', gameId: 'hsr', name: 'Daily Training', cadence: 'daily' });
const session = (passed: PlaySession['passed'] = {}): PlaySession => ({
  gameId: 'hsr',
  startedAt: NOW - 60_000,
  passed,
  nudged: false,
});

describe('a running game puts one thing forward at a time', () => {
  it('asks for the reading first, while the last one predates the game', () => {
    const state = makeState({
      games: [game],
      resources: [power],
      tasks: [daily],
      snapshots: [makeSnapshot({ resourceId: 'power', value: 100, takenAt: NOW - 3_600_000 })],
    });
    expect(sessionNeed(state, game, session(), NOW)).toBe('energy');
    expect(nudgeLine(state, game, session(), NOW)).toBe('Trailblaze Power? · 1 daily left');
  });

  it('moves to the reserve once a reading is taken during the game, then to the dailies', () => {
    const state = makeState({
      games: [game],
      resources: [power],
      tasks: [daily],
      snapshots: [makeSnapshot({ resourceId: 'power', value: 150, takenAt: NOW - 10_000 })],
    });
    expect(sessionNeed(state, game, session(), NOW)).toBe('reserve');
    expect(sessionNeed(state, game, session({ reserve: true }), NOW)).toBe('dailies');
  });

  it('needs nothing once the dailies are done and the reading is in', () => {
    const state = makeState({ games: [game], resources: [], tasks: [] });
    expect(sessionNeed(state, game, session(), NOW)).toBeNull();
    expect(nudgeLine(state, game, session(), NOW)).toBe('');
  });
});
