import { describe, expect, it } from 'vitest';
import { buildUrgencyContext, gameActions, urgencyOrder } from '../src';
import { makeEvent, makeGame, makeResource, makeSnapshot, makeState, makeTask, utc } from './helpers';

// The app builds one UrgencyContext per render and hands it to every reader, so
// each case below also asserts that the shared context and the internally built
// one produce identical actions.

describe('urgency', () => {
  const now = utc('2026-07-24T12:00:00Z');

  it('orders game actions by deadline and pins full energy to now', () => {
    const game = makeGame();
    const state = makeState({
      games: [game],
      resources: [makeResource({ cap: 200 })],
      snapshots: [makeSnapshot({ value: 200, takenAt: now - 60_000 })],
      tasks: [makeTask({ cadence: 'daily' })],
      events: [makeEvent({ start: now - 60_000, end: now + 30_000, notify: true })],
    });

    const actions = gameActions(state, game, now);
    expect(actions[0]).toMatchObject({ kind: 'energy_full', at: now });
    expect(actions.map((action) => action.at)).toEqual([...actions].map((action) => action.at).sort((a, b) => a - b));
    expect(gameActions(state, game, now, buildUrgencyContext(state, now))).toEqual(actions);
  });

  it('returns no actions for paused games and sorts them last', () => {
    const active = makeGame({ id: 'active', sort: 5 });
    const paused = makeGame({ id: 'paused', paused: true, sort: 0 });
    const state = makeState({ games: [paused, active] });

    const order = urgencyOrder(state, now);
    expect(order.map((entry) => entry.game.id)).toEqual(['active', 'paused']);
    expect(order[1]!.actions).toEqual([]);
    expect(urgencyOrder(state, now, buildUrgencyContext(state, now))).toEqual(order);
  });

  it('breaks equal-deadline ties by game sort', () => {
    const laterSort = makeGame({ id: 'later-sort', sort: 9 });
    const earlierSort = makeGame({ id: 'earlier-sort', sort: 2 });
    const state = makeState({ games: [laterSort, earlierSort] });

    const order = urgencyOrder(state, now);
    expect(order.map((entry) => entry.game.id)).toEqual(['earlier-sort', 'later-sort']);
    expect(urgencyOrder(state, now, buildUrgencyContext(state, now))).toEqual(order);
  });

  it('keeps another account’s capped resource out of this game’s actions', () => {
    // The shared context indexes every resource once; the lookup, not a per-game
    // scan, is now what keeps two accounts of the same game apart.
    const mine = makeGame({ id: 'mine' });
    const theirs = makeGame({ id: 'theirs' });
    const state = makeState({
      games: [mine, theirs],
      resources: [
        makeResource({ id: 'mine-resin', gameId: 'mine', cap: 200 }),
        makeResource({ id: 'theirs-resin', gameId: 'theirs', cap: 200 }),
      ],
      snapshots: [
        makeSnapshot({ id: 'sm', resourceId: 'mine-resin', value: 10, takenAt: now }),
        makeSnapshot({ id: 'st', resourceId: 'theirs-resin', value: 200, takenAt: now }),
      ],
    });

    const context = buildUrgencyContext(state, now);
    expect(gameActions(state, mine, now, context).map((action) => action.kind)).toEqual(['energy_soon']);
    expect(gameActions(state, theirs, now, context).map((action) => action.kind)).toEqual(['energy_full']);
  });

  it('excludes events with notify disabled and preserves context parity for mixed actions', () => {
    const game = makeGame();
    const state = makeState({
      games: [game],
      resources: [makeResource({ cap: 200 })],
      snapshots: [makeSnapshot({ value: 199, takenAt: now })],
      tasks: [makeTask({ cadence: 'weekly' })],
      events: [
        makeEvent({ id: 'silent', start: now - 1, end: now + 1_000, notify: false }),
        makeEvent({ id: 'loud', start: now - 1, end: now + 2_000, notify: true }),
      ],
    });

    const actions = gameActions(state, game, now);
    expect(actions.some((action) => action.label === 'Banner ends')).toBe(true);
    expect(actions.filter((action) => action.kind === 'event')).toHaveLength(1);

    const context = buildUrgencyContext(state, now);
    expect(gameActions(state, game, now, context)).toEqual(actions);
    expect(urgencyOrder(state, now, context)).toEqual(urgencyOrder(state, now));
  });
});
