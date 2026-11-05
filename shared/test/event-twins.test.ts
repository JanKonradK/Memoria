import { describe, expect, it } from 'vitest';
import { collapseSourceTwins, sourceEventId } from '../src/event-twins';
import { mergeState } from '../src/merge';
import { emptyState, type AppState, type GameEvent } from '../src/types';

// In the past: merge drops rows clocked ahead of the real time.
const AT = Date.now() - 3_600_000;

function event(id: string, over: Partial<GameEvent> = {}): GameEvent {
  return {
    id,
    gameId: 'g1',
    name: 'Spiral Abyss',
    type: 'cycle',
    start: AT - 86_400_000,
    end: AT + 86_400_000,
    dailyTouch: false,
    notify: true,
    notes: '',
    sourceKey: 'genshin:1',
    updatedAt: AT - 1000,
    ...over,
  };
}

function withEvents(...events: GameEvent[]): AppState {
  return { ...emptyState(), events };
}

const live = (state: AppState) => state.events.filter((e) => !e.deleted);

describe('collapseSourceTwins', () => {
  it('keeps the smallest id and tombstones the rest', () => {
    const next = collapseSourceTwins(withEvents(event('c'), event('a'), event('b')), AT);
    expect(live(next).map((e) => e.id)).toEqual(['a']);
    expect(next.events.find((e) => e.id === 'b')).toMatchObject({ deleted: true, updatedAt: AT });
  });

  it('moves what the player did onto the survivor', () => {
    const next = collapseSourceTwins(
      withEvents(event('a'), event('b', { done: true, pinned: true, notes: 'mine', notify: false, partsDone: 2 })),
      AT,
    );
    expect(live(next)[0]).toMatchObject({
      id: 'a',
      done: true,
      pinned: true,
      notes: 'mine',
      notify: false,
      partsDone: 2,
      updatedAt: AT,
    });
  });

  it('leaves other games, other keys and hand-made events alone', () => {
    const state = withEvents(
      event('a'),
      event('b', { gameId: 'g2' }),
      event('c', { sourceKey: 'genshin:2' }),
      event('d', { sourceKey: undefined }),
      event('e', { sourceKey: undefined }),
    );
    expect(collapseSourceTwins(state, AT)).toBe(state);
  });

  it('converges when devices repair different subsets on their own', () => {
    const one = collapseSourceTwins(withEvents(event('b'), event('c', { done: true })), AT);
    const two = collapseSourceTwins(withEvents(event('a'), event('b')), AT + 5);
    const merged = collapseSourceTwins(mergeState(one, two), AT + 10);
    expect(live(merged).map((e) => e.id)).toEqual(['a']);
  });
});

describe('sourceEventId', () => {
  it('is stable, distinct and within the id limit', () => {
    expect(sourceEventId('g1', 'genshin:1')).toBe(sourceEventId('g1', 'genshin:1'));
    expect(sourceEventId('g1', 'genshin:1')).not.toBe(sourceEventId('g2', 'genshin:1'));
    expect(sourceEventId('g1:a', 'b')).not.toBe(sourceEventId('g1', 'a:b'));
    expect(sourceEventId('x'.repeat(160), 'y'.repeat(300)).length).toBeLessThanOrEqual(160);
  });
});
