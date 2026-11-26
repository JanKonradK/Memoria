import { describe, expect, it, vi } from 'vitest';
import {
  assertSyncProtocol,
  compactState,
  compareHlc,
  emptyHistory,
  mergeState,
  normalizeState,
  stampChanges,
  tickHlc,
  recordAction,
  TOMBSTONE_RETENTION_MS,
  undoAction,
  restoreCheckpoint,
  boundHistory,
  checkpoint,
  localDayKey,
  MAX_CHECKPOINTS,
  MAX_CHECKPOINT_BYTES,
  MAX_JOURNAL_BYTES,
  MAX_JOURNAL_ENTRIES,
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
    expect(MAX_JOURNAL_ENTRIES).toBe(300);
    expect(history.journal).toHaveLength(300);
    expect(history.journal[0]!.id).toBe('220');
    for (let i = 0; i < 20; i++) history = checkpoint(history, after, 'Daily', i, String(i));
    expect(MAX_CHECKPOINTS).toBe(6);
    expect(history.checkpoints).toHaveLength(6);
    expect(history.checkpoints.map((item) => item.id)).toEqual(['14', '15', '16', '17', '18', '19']);
  });
  it('bounds by bytes in one pass, keeping the newest entries that fit', () => {
    const before = makeState();
    // About 100 KB per action: ten fit in the 1 MB journal, not eleven.
    const big = (i: number) => makeState({ games: [makeGame({ notes: `${i}`.padEnd(100_000, 'x') })] });
    let history = emptyHistory('a');
    for (let i = 0; i < 40; i++) history = recordAction(history, before, big(i), 'Edit', i, String(i));
    const size = new TextEncoder().encode(JSON.stringify(history.journal)).length;
    expect(size).toBeLessThanOrEqual(MAX_JOURNAL_BYTES);
    expect(history.journal.length).toBeGreaterThan(5);
    expect(history.journal.length).toBeLessThan(11);
    expect(history.journal.at(-1)!.id).toBe('39');
    // Ids stay contiguous and newest-last: only the oldest were dropped.
    const ids = history.journal.map((entry) => Number(entry.id));
    expect(ids).toEqual(ids.map((_, index) => 40 - ids.length + index));
    // Multi-byte text is counted as UTF-8, not UTF-16 code units.
    const wide = makeState({ games: [makeGame({ notes: 'ż'.repeat(400_000) })] });
    let utf = emptyHistory('b');
    for (let i = 0; i < 3; i++) utf = recordAction(utf, before, wide, 'Edit', i, String(i));
    expect(utf.journal).toHaveLength(1);
    // A single entry larger than the whole budget is not kept.
    const huge = makeState({ games: [makeGame({ notes: 'x'.repeat(MAX_CHECKPOINT_BYTES) })] });
    expect(checkpoint(emptyHistory('c'), huge, 'Daily', 1, 'huge').checkpoints).toEqual([]);
  });
  it('cuts a history saved under larger limits down to the current ones', () => {
    const state = makeState();
    const old = {
      ...emptyHistory('a'),
      checkpoints: Array.from({ length: 12 }, (_, i) => ({ id: String(i), at: i, label: 'Daily', state })),
      journal: Array.from({ length: 500 }, (_, i) => ({ id: String(i), at: i, label: 'Edit', changes: [] })),
    };
    const cut = boundHistory(old);
    expect(cut.checkpoints.map((item) => item.id)).toEqual(['6', '7', '8', '9', '10', '11']);
    expect(cut.journal).toHaveLength(MAX_JOURNAL_ENTRIES);
    expect(boundHistory(cut)).toBe(cut);
  });
  it('bounds a large history quickly (linear, not quadratic)', () => {
    const entries = Array.from({ length: 5_000 }, (_, i) => ({
      id: String(i),
      at: i,
      label: 'Edit',
      changes: [{ collection: 'games' as const, id: 'g', after: { notes: 'x'.repeat(20_000) } }],
    }));
    const history = { ...emptyHistory('a'), journal: entries };
    const started = performance.now();
    const next = recordAction(history, makeState(), makeState({ games: [makeGame()] }), 'Edit', 9, 'last');
    expect(performance.now() - started).toBeLessThan(2_000);
    // 300 recent entries of ~20 KB each: only the newest ~50 fit in 1 MB.
    expect(next.journal.length).toBeGreaterThan(40);
    expect(next.journal.length).toBeLessThan(MAX_JOURNAL_ENTRIES);
    expect(next.journal.at(-1)!.id).toBe('last');
  });
  it('keys days in the given time zone, falling back to the device day', () => {
    const at = Date.parse('2026-11-21T23:30:00Z');
    expect(localDayKey(at, 'UTC')).toBe('2026-11-21');
    expect(localDayKey(at, 'Asia/Tokyo')).toBe('2026-11-22');
    expect(localDayKey(at, 'America/Los_Angeles')).toBe('2026-11-21');
    expect(localDayKey(Date.parse('2026-01-05T00:30:00Z'), 'Pacific/Honolulu')).toBe('2026-01-04');
    const local = new Date(at);
    const device = `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}`;
    expect(localDayKey(at, 'Not/AZone')).toBe(device);
    expect(localDayKey(at)).toBe(device);
  });
  it('restores a deletion in full even after its tombstone was slimmed past 90 days', () => {
    const deletedAt = 1_000_000;
    const before = normalizeState(
      makeState({
        notes: [
          {
            id: 'n1',
            gameId: 'g1',
            title: 'Save plan',
            body: 'Keep 16000 for rerun',
            sort: 0,
            updatedAt: 500_000,
          },
        ],
      }),
    );
    const deleted = stampChanges(
      before,
      { ...before, notes: [{ ...before.notes[0]!, deleted: true }] },
      emptyHistory('a'),
      deletedAt,
    ).state;
    const history = recordAction(emptyHistory('a'), before, deleted, 'Edit', deletedAt, 'del-note');
    const later = deletedAt + 100 * 86_400_000;
    const slimmed = compactState(deleted, later - TOMBSTONE_RETENTION_MS);
    expect(slimmed.notes[0]!.deleted).toBe(true);
    expect(slimmed.notes[0]!.title).toBe('');
    expect(slimmed.notes[0]!.body).toBe('');

    const restored = undoAction(slimmed, history.journal[0]!, []);
    expect(restored.notes[0]).toMatchObject({
      id: 'n1',
      title: 'Save plan',
      body: 'Keep 16000 for rerun',
    });
    expect(restored.notes[0]!.deleted).toBeUndefined();
  });
});
