import { describe, expect, it } from 'vitest';
import { compactState, mergeState, normalizeState, pruneCompletions } from '../src/merge';
import { MAX_GAME_IMAGE_LENGTH } from '../src/types';
import { FUTURE_CLOCK_SKEW_TOLERANCE_MS, safeParseAppState } from '../src/validation';
import { makeEvent, makeGame, makeResource, makeSnapshot, makeState, makeTask } from './helpers';

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
    expect(mergeState(once, once)).toEqual(once);
  });

  it('resolves equal-timestamp conflicts deterministically', () => {
    const left = makeState({ games: [makeGame({ name: 'Alpha', updatedAt: 10 })] });
    const right = makeState({ games: [makeGame({ name: 'Omega', updatedAt: 10 })] });
    expect(mergeState(left, right)).toEqual(mergeState(right, left));
  });

  it('drops a poisoned future row before LWW instead of letting it beat sane local data', () => {
    const now = Date.now();
    const local = makeState({ games: [makeGame({ name: 'Local', updatedAt: now })] });
    const future = makeState({
      games: [
        makeGame({
          name: 'Future',
          updatedAt: now + FUTURE_CLOCK_SKEW_TOLERANCE_MS + 60_000,
        }),
      ],
    });

    expect(mergeState(local, future).games[0]!.name).toBe('Local');
    expect(mergeState(local, future)).toEqual(mergeState(future, local));
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
        telegramChatId: '123456789',
      },
    });
    expect(state.settings).not.toHaveProperty('discordWebhook');
    expect(state.settings).not.toHaveProperty('telegramToken');
    expect(state.settings).not.toHaveProperty('telegramChatId');
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

  it('drops one irreparable row without losing its siblings or other collections', () => {
    const state = normalizeState(
      makeState({
        games: [makeGame({ id: '', name: 'Broken identity' }), makeGame({ id: 'good-game', name: 'Keep game' })],
        resources: [makeResource({ id: 'keep-resource', gameId: 'good-game' })],
        tasks: [makeTask({ id: 'keep-task', gameId: 'good-game' })],
        events: [makeEvent({ id: 'keep-event', gameId: 'good-game' })],
      }),
    );

    expect(state.games.map((game) => game.id)).toEqual(['good-game']);
    expect(state.resources.map((resource) => resource.id)).toEqual(['keep-resource']);
    expect(state.tasks.map((task) => task.id)).toEqual(['keep-task']);
    expect(state.events.map((event) => event.id)).toEqual(['keep-event']);
    expect(safeParseAppState(state).success).toBe(true);
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

describe('normalizeState clamps out-of-range game fields', () => {
  // The offline path (IndexedDB load, JSON import, the launcher's user-editable
  // state.json) never ran zod — normalizeState was the only gate and it gated
  // nothing. These are the values that actually broke scheduling.
  it('pulls reset fields back into their documented ranges', () => {
    const state = makeState({
      games: [makeGame({ id: 'g1', dailyResetHour: 25, weeklyResetDay: 0, monthlyResetDay: 31 })],
      resources: [makeResource({ id: 'r1', gameId: 'g1' })],
      tasks: [makeTask({ id: 't1', gameId: 'g1' })],
      events: [makeEvent({ id: 'e1', gameId: 'g1' })],
    });

    const normalized = normalizeState(state);
    const game = normalized.games[0]!;

    expect(game.dailyResetHour).toBe(23);
    expect(game.weeklyResetDay).toBe(1);
    // 31 used to make monthlyPeriodKey require `day >= 31` while the reset
    // timestamp clamped to 28, so monthly tasks silently stopped resetting.
    expect(game.monthlyResetDay).toBe(28);
    expect(normalized.resources).toHaveLength(1);
    expect(normalized.tasks).toHaveLength(1);
    expect(normalized.events).toHaveLength(1);
    expect(safeParseAppState(normalized).success).toBe(true);
  });

  it('substitutes a sane default for values that are not numbers at all', () => {
    const state = makeState({
      games: [
        makeGame({
          id: 'g1',
          dailyResetHour: Number.NaN,
          weeklyResetDay: 'monday' as unknown as number,
          monthlyResetDay: undefined as unknown as number,
        }),
      ],
    });

    const game = normalizeState(state).games[0]!;

    expect(game.dailyResetHour).toBe(4);
    expect(game.weeklyResetDay).toBe(1);
    expect(game.monthlyResetDay).toBe(1);
  });

  it('clamps rather than dropping the game, so its resources keep their owner', () => {
    // A game row carries the user's resources, tasks and history by id. Dropping
    // it because one number is out of range would orphan all of that.
    const state = makeState({ games: [makeGame({ id: 'keep-me', monthlyResetDay: 99 })] });

    const games = normalizeState(state).games;

    expect(games).toHaveLength(1);
    expect(games[0]!.id).toBe('keep-me');
  });
});
