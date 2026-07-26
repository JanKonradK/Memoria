import { describe, expect, it } from 'vitest';
import { compactState, mergeState, normalizeState, pruneCompletions } from '../src/merge';
import { MAX_GAME_IMAGE_LENGTH } from '../src/types';
import { makeGame, makeSnapshot, makeState } from './helpers';

describe('mergeState', () => {
  it('keeps the newer row per id (LWW)', () => {
    const a = makeState({ games: [makeGame({ name: 'Old', updatedAt: 1 })] });
    const b = makeState({ games: [makeGame({ name: 'New', updatedAt: 2 })] });
    expect(mergeState(a, b).games[0]!.name).toBe('New');
    expect(mergeState(b, a).games[0]!.name).toBe('New'); // commutative
  });

  it('propagates newer tombstones over older edits', () => {
    const edited = makeState({ games: [makeGame({ name: 'Edited', updatedAt: 5 })] });
    const deleted = makeState({ games: [makeGame({ deleted: true, updatedAt: 9 })] });
    expect(mergeState(edited, deleted).games[0]!.deleted).toBe(true);
  });

  it('unions snapshots and trims to the most recent 200 per resource', () => {
    const a = makeState({
      snapshots: Array.from({ length: 150 }, (_, i) => makeSnapshot({ id: `a${i}`, takenAt: i })),
    });
    const b = makeState({
      snapshots: Array.from({ length: 150 }, (_, i) => makeSnapshot({ id: `b${i}`, takenAt: 1000 + i })),
    });
    const merged = mergeState(a, b);
    expect(merged.snapshots).toHaveLength(200);
    // All the newer "b" snapshots survive.
    expect(merged.snapshots.filter((s) => s.id.startsWith('b'))).toHaveLength(150);
  });

  it('uses the newer legacy settings clock when field clocks are absent', () => {
    const a = makeState();
    a.settings = { ...a.settings, localTz: 'Europe/Warsaw', updatedAt: 10 };
    const b = makeState();
    b.settings = { ...b.settings, localTz: 'UTC', updatedAt: 3 };
    expect(mergeState(a, b).settings.localTz).toBe('Europe/Warsaw');
  });

  it('merges unrelated settings fields without losing either device edit', () => {
    const a = makeState();
    a.settings = {
      ...a.settings,
      localTz: 'Europe/Warsaw',
      fieldUpdatedAt: { localTz: 20, sleepHours: 1 },
      updatedAt: 20,
    };
    const b = makeState();
    b.settings = {
      ...b.settings,
      localTz: 'UTC',
      sleepHours: 10,
      fieldUpdatedAt: { localTz: 1, sleepHours: 30 },
      updatedAt: 30,
    };
    const merged = mergeState(a, b);
    expect(merged.settings.localTz).toBe('Europe/Warsaw');
    expect(merged.settings.sleepHours).toBe(10);
  });

  it('is idempotent', () => {
    const a = makeState({ games: [makeGame()] });
    const once = mergeState(a, a);
    expect(once.games).toHaveLength(1);
  });

  it('resolves equal-timestamp conflicts deterministically', () => {
    const left = makeState({ games: [makeGame({ name: 'Alpha', updatedAt: 10 })] });
    const right = makeState({ games: [makeGame({ name: 'Omega', updatedAt: 10 })] });
    expect(mergeState(left, right)).toEqual(mergeState(right, left));
  });
});

describe('normalizeState', () => {
  it('fills missing collections and settings defaults', () => {
    const s = normalizeState({ games: [makeGame()] });
    expect(s.games).toHaveLength(1);
    expect(s.tasks).toEqual([]);
    expect(s.settings.localTz).toBeTruthy();
  });

  it('strips legacy credentials from normalized sync state', () => {
    const state = normalizeState({
      settings: {
        ...makeState().settings,
        discordWebhook: 'https://discord.com/api/webhooks/secret',
        telegramToken: '12345:secret',
      },
    });
    expect(state.settings).not.toHaveProperty('discordWebhook');
    expect(state.settings).not.toHaveProperty('telegramToken');
  });
  it('tolerates garbage', () => {
    expect(normalizeState(null).games).toEqual([]);
    expect(normalizeState('x').events).toEqual([]);
  });

  it('normalizes legacy resources and tasks with inferred tracking metadata', () => {
    const state = normalizeState({
      resources: [
        {
          id: 'r1',
          gameId: 'g1',
          name: 'Condensed Resin',
          cap: 5,
          regenMinutes: 0,
          reserveCap: 0,
          sort: 0,
          updatedAt: 1,
        },
      ],
      tasks: [
        {
          id: 't1',
          gameId: 'g1',
          name: 'Weekly Bosses ×3',
          cadence: 'weekly',
          intervalDays: 1,
          anchorAt: 0,
          sort: 0,
          updatedAt: 1,
        },
      ],
    });
    expect(state.resources[0]!.kind).toBe('counter');
    expect(state.tasks[0]!.mode).toBe('count');
    expect(state.tasks[0]!.countTarget).toBe(3);
  });

  it('drops oversized images so imported documents self-heal before validation', () => {
    const state = normalizeState({
      games: [makeGame({ image: 'x'.repeat(MAX_GAME_IMAGE_LENGTH + 1) })],
    });
    expect(state.games[0]).not.toHaveProperty('image');
  });
});

describe('compactState', () => {
  it('drops tombstones older than the retention cutoff', () => {
    const cutoff = 1_000_000;
    const state = makeState({
      games: [
        makeGame({ id: 'live', updatedAt: cutoff }),
        makeGame({ id: 'old-tombstone', deleted: true, updatedAt: cutoff - 1 }),
        makeGame({ id: 'fresh-tombstone', deleted: true, updatedAt: cutoff }),
      ],
    });
    const compacted = compactState(state, cutoff);
    expect(compacted.games.map((game) => game.id)).toEqual(['live', 'fresh-tombstone']);
  });

  it('keeps completions at the retention boundary and prunes older rows', () => {
    const cutoff = 1_000_000;
    const state = makeState({
      completions: [
        { id: 'old', taskId: 'task', periodKey: 'old', done: true, updatedAt: cutoff - 1 },
        { id: 'boundary', taskId: 'task', periodKey: 'boundary', done: true, updatedAt: cutoff },
      ],
    });
    expect(pruneCompletions(state, cutoff).completions.map((completion) => completion.id)).toEqual(['boundary']);
  });

  it('prunes after merge because a stale device can resurrect a row pruned without a tombstone', () => {
    const cutoff = 1_000_000;
    const stale = makeState({
      completions: [{ id: 'stale', taskId: 'task', periodKey: 'old', done: true, updatedAt: cutoff - 1 }],
    });
    const alreadyPruned = pruneCompletions(stale, cutoff);

    expect(mergeState(alreadyPruned, stale).completions.map((completion) => completion.id)).toEqual(['stale']);
    expect(compactState(mergeState(alreadyPruned, stale), 0, cutoff).completions).toEqual([]);
  });
});
