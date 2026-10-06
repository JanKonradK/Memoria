import { describe, expect, it } from 'vitest';
import { moveLayoutItem, resolveGameLayout } from '../src/card-layout';
import { mergeState, normalizeState } from '../src/merge';
import { safeParseAppState } from '../src/validation';
import { makeGame, makeResource, makeState, makeTask } from './helpers';

describe('game card layouts', () => {
  it('keeps saved order and inactive tasks, removes foreign/deleted references, and appends new widgets', () => {
    const game = makeGame({
      cardLayout: [
        { id: 'task:cycle', hidden: true },
        { id: 'resource:foreign' },
        { id: 'task:deleted' },
        { id: 'task:cycle' },
        { id: 'resource:r1' },
      ],
    });
    const result = resolveGameLayout(
      game,
      [
        makeResource(),
        makeResource({ id: 'foreign', gameId: 'other' }),
        makeResource({ id: 'counter', kind: 'counter', regenMinutes: 0 }),
      ],
      [
        makeTask({ id: 'cycle', cadence: 'custom', anchorAt: Date.now() + 86400000 }),
        makeTask({ id: 'deleted', deleted: true }),
        makeTask(),
      ],
    );
    expect(result.slice(0, 2)).toEqual([{ id: 'task:cycle', hidden: true }, { id: 'resource:r1' }]);
    expect(result.map((item) => item.id)).toEqual([
      'task:cycle',
      'resource:r1',
      'resource:counter',
      'quick-spend',
      'task:t1',
      'events',
    ]);
    expect(result.find((item) => item.id === 'resource:counter')?.hidden).toBe(true);
    expect(game.cardLayout).toHaveLength(5);
  });

  it('moves a widget without changing its visibility or the input array', () => {
    const items = [{ id: 'task:one' }, { id: 'resource:two', hidden: true }, { id: 'events' }];
    expect(moveLayoutItem(items, 'events', 0)).toEqual([items[2], items[0], items[1]]);
    expect(items[0]?.id).toBe('task:one');
    expect(moveLayoutItem(items, 'missing', 0)).toBe(items);
  });

  it('preserves layout through validation, JSON backup, normalization, and sync merge', () => {
    const cardLayout = [{ id: 'task:t1', hidden: true }, { id: 'resource:r1' }];
    const state = makeState({ games: [makeGame({ cardLayout, updatedAt: 2 })] });
    expect(safeParseAppState(state).success).toBe(true);
    const restored = normalizeState(JSON.parse(JSON.stringify(state)));
    expect(restored.games[0]?.cardLayout).toEqual(cardLayout);
    expect(mergeState(makeState({ games: [makeGame()] }), restored).games[0]?.cardLayout).toEqual(cardLayout);
    expect(
      mergeState(restored, makeState({ games: [makeGame({ updatedAt: 3 })] })).games[0]?.cardLayout,
    ).toBeUndefined();
  });

  it('repairs malformed optional layouts without dropping the game or tracking data', () => {
    const state = normalizeState({
      ...makeState({ resources: [makeResource()], tasks: [makeTask()] }),
      games: [
        {
          ...makeGame(),
          cardLayout: [
            null,
            { id: 'bad', width: 2 },
            { id: 'task:t1', width: 7 },
            { id: 'events', width: 1 },
            { id: 'events', width: 2 },
          ],
        },
      ],
    });
    expect(state.games[0]?.cardLayout).toEqual([{ id: 'task:t1' }, { id: 'events' }]);
    expect(state.tasks).toHaveLength(1);
    expect(state.resources).toHaveLength(1);
    expect(
      normalizeState({ ...state, games: [{ ...makeGame(), cardLayout: 'broken' }] }).games[0]?.cardLayout,
    ).toBeUndefined();
  });

  it('imports old half-width layouts as full rows while keeping order, visibility and progress', () => {
    const raw = makeState({ resources: [makeResource()], tasks: [makeTask()] });
    const legacy = {
      ...raw,
      games: [
        {
          ...makeGame(),
          cardLayout: [
            { id: 'task:t1', width: 1, hidden: true },
            { id: 'resource:r1', width: 2 },
          ],
        },
      ],
    };
    expect(safeParseAppState(legacy).success).toBe(true);
    const restored = normalizeState(legacy);
    expect(restored.games[0]?.cardLayout).toEqual([{ id: 'task:t1', hidden: true }, { id: 'resource:r1' }]);
    const baseline = normalizeState(raw);
    expect(restored.tasks).toEqual(baseline.tasks);
    expect(restored.resources).toEqual(baseline.resources);
    expect(restored.completions).toEqual(baseline.completions);
  });
});
