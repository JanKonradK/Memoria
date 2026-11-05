import { describe, expect, it, vi } from 'vitest';
import {
  assertSyncProtocol,
  compareHlc,
  emptyHistory,
  mergeState,
  normalizeState,
  stampChanges,
  tickHlc,
  recordAction,
  undoAction,
  restoreCheckpoint,
  checkpoint,
  type AppState,
} from '../src';
import { makeGame, makeResource, makeSnapshot, makeState, makeTask } from './helpers';

const permutations = [
  [0, 1, 2],
  [0, 2, 1],
  [1, 0, 2],
  [1, 2, 0],
  [2, 0, 1],
  [2, 1, 0],
];
describe('HLC merge', () => {
  it('ticks after receive and rollback, with a stable device tie-break', () => {
    const ahead = tickHlc('a', 1_900_000_000_000);
    const rollback = tickHlc('a', 100, ahead);
    const received = tickHlc('b', 1, rollback);
    expect(compareHlc(rollback, ahead)).toBeGreaterThan(0);
    expect(compareHlc(received, rollback)).toBeGreaterThan(0);
    expect(compareHlc({ ...ahead, device: 'b' }, ahead)).toBeGreaterThan(0);
  });
  it('converges for three devices, random skew, rollback and every merge order', () => {
    let seed = 931;
    const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
    for (let trial = 0; trial < 30; trial++) {
      const initial = normalizeState(
        makeState({
          games: [makeGame()],
          resources: [makeResource()],
          snapshots: [makeSnapshot()],
          tasks: [makeTask()],
        }),
      );
      const states = [initial, initial, initial];
      const histories = ['a', 'b', 'c'].map(emptyHistory);
      for (let step = 0; step < 12; step++) {
        const device = Math.floor(random() * 3);
        const current = states[device]!;
        const at = Math.floor(random() * 4_000_000_000_000);
        const candidate: AppState = {
          ...current,
          games: current.games.map((game) => ({ ...game, name: `edit-${trial}-${step}`, deleted: random() < 0.2 })),
          settings: { ...current.settings, sleepHours: 1 + Math.floor(random() * 23) },
        };
        const stamped = stampChanges(current, candidate, histories[device]!, at);
        states[device] = stamped.state;
        histories[device] = { ...histories[device]!, clock: stamped.clock };
        if (random() < 0.4) {
          const peer = (device + 1) % 3;
          states[peer] = mergeState(states[peer]!, states[device]!);
        }
      }
      const expected = mergeState(mergeState(states[0]!, states[1]!), states[2]!);
      for (const [a, b, c] of permutations) {
        expect(mergeState(mergeState(states[a!]!, states[b!]!), states[c!]!)).toEqual(expected);
        expect(mergeState(states[a!]!, mergeState(states[b!]!, states[c!]!))).toEqual(expected);
      }
      expect(mergeState(expected, expected)).toEqual(expected);
    }
  }, 30_000);
  it('migrates the same legacy data identically on different devices', () => {
    const legacy = {
      ...makeState({ games: [makeGame({ updatedAt: 42 })], snapshots: [makeSnapshot({ takenAt: 12 })] }),
      schemaVersion: 9,
    };
    vi.useFakeTimers();
    let first;
    try {
      vi.setSystemTime(0);
      first = normalizeState(legacy);
      vi.setSystemTime(4_000_000_000_000);
      expect(normalizeState(legacy)).toEqual(first);
    } finally {
      vi.useRealTimers();
    }
    expect(normalizeState(legacy).games[0]).toMatchObject({
      hlc: { wall: 42, counter: 0, device: 'Unknown device' },
      deviceId: 'Unknown device',
    });
    expect(() => assertSyncProtocol(legacy)).toThrow(/Update Memoria/);
    expect(() => assertSyncProtocol(makeState())).not.toThrow();
  });
});

describe('local recovery', () => {
  it('restores a checkpoint with new clocks and tombstones that win the next peer sync', () => {
    const history = emptyHistory('a');
    const saved = normalizeState(
      makeState({ games: [makeGame()], resources: [makeResource()], snapshots: [makeSnapshot({ value: 20 })] }),
    );
    const peer = stampChanges(
      saved,
      {
        ...saved,
        games: [{ ...saved.games[0]!, name: 'Bad edit' }, makeGame({ id: 'new' })],
        snapshots: [...saved.snapshots, makeSnapshot({ id: 'new-reading', takenAt: 40, value: 99 })],
      },
      history,
      2_000_000_000_000,
    ).state;
    const restored = stampChanges(peer, restoreCheckpoint(peer, saved), history, 10).state;
    const merged = mergeState(peer, restored);
    expect(merged.games.find((game) => game.id === 'g1')?.name).toBe('Testland');
    expect(merged.games.find((game) => game.id === 'new')?.deleted).toBe(true);
    expect(merged.snapshots.find((reading) => reading.id === 'new-reading')?.deleted).toBe(true);
  });
  it('undoes per field and protects fields touched later even if set back to the same value', () => {
    const before = makeState({ games: [makeGame({ notes: 'Original' })] });
    const after = { ...before, games: [{ ...before.games[0]!, name: 'First', notes: 'First note' }] };
    let history = recordAction(emptyHistory('a'), before, after, 'Edit', 1, 'one');
    const later = { ...after, games: [{ ...after.games[0]!, notes: 'Later note', short: 'XX' }] };
    history = recordAction(history, after, later, 'Edit', 2, 'two');
    const back = { ...later, games: [{ ...later.games[0]!, notes: 'First note' }] };
    history = recordAction(history, later, back, 'Edit', 3, 'three');
    const result = undoAction(back, history.journal[0]!, history.journal.slice(1));
    expect(result.games[0]).toMatchObject({ name: 'Testland', notes: 'First note', short: 'XX' });
  });
  it('bounds journal entries and checkpoints', () => {
    let history = emptyHistory('a');
    const before = makeState();
    const after = makeState({ games: [makeGame()] });
    for (let i = 0; i < 520; i++) history = recordAction(history, before, after, 'Edit', i, String(i));
    expect(history.journal).toHaveLength(500);
    for (let i = 0; i < 20; i++) history = checkpoint(history, after, 'Daily', i, String(i));
    expect(history.checkpoints).toHaveLength(12);
  });
});
