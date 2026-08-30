import { describe, expect, it } from 'vitest';
import {
  buildChecklistIndex,
  checklistFor,
  gameActions,
  latestSnapshots,
  urgencyOrder,
  type UrgencyContext,
} from '../src';
import { makeEvent, makeGame, makeResource, makeSnapshot, makeState, makeTask, utc } from './helpers';

function explicitContext(state: ReturnType<typeof makeState>, now: number): UrgencyContext {
  const checklistIndex = buildChecklistIndex(state);
  const checklistByGame = new Map(
    state.games
      .filter((game) => !game.deleted)
      .map((game) => [game.id, checklistFor(state, game, now, checklistIndex)]),
  );
  const eventsByGame = new Map<string, typeof state.events>();
  for (const event of state.events) {
    const events = eventsByGame.get(event.gameId);
    if (events) events.push(event);
    else eventsByGame.set(event.gameId, [event]);
  }
  return { snaps: latestSnapshots(state.snapshots), checklistByGame, eventsByGame };
}

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
    expect(gameActions(state, game, now, explicitContext(state, now))).toEqual(actions);
  });

  it('returns no actions for paused games and sorts them last', () => {
    const active = makeGame({ id: 'active', sort: 5 });
    const paused = makeGame({ id: 'paused', paused: true, sort: 0 });
    const state = makeState({ games: [paused, active] });

    const order = urgencyOrder(state, now);
    expect(order.map((entry) => entry.game.id)).toEqual(['active', 'paused']);
    expect(order[1]!.actions).toEqual([]);
    expect(urgencyOrder(state, now, explicitContext(state, now))).toEqual(order);
  });

  it('breaks equal-deadline ties by game sort', () => {
    const laterSort = makeGame({ id: 'later-sort', sort: 9 });
    const earlierSort = makeGame({ id: 'earlier-sort', sort: 2 });
    const state = makeState({ games: [laterSort, earlierSort] });

    const order = urgencyOrder(state, now);
    expect(order.map((entry) => entry.game.id)).toEqual(['earlier-sort', 'later-sort']);
    expect(urgencyOrder(state, now, explicitContext(state, now))).toEqual(order);
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

    const context = explicitContext(state, now);
    expect(gameActions(state, game, now, context)).toEqual(actions);
    expect(urgencyOrder(state, now, context)).toEqual(urgencyOrder(state, now));
  });
});
