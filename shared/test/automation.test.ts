import { describe, expect, it } from 'vitest';
import {
  completionId,
  GameImportBatchSchema,
  importProvenance,
  mergeState,
  normalizeState,
  planGameImport,
  safeParseAppState,
  taskPeriodKey,
  type GameImportBatch,
} from '../src';
import { makeGame, makeResource, makeSnapshot, makeState, makeTask, utc } from './helpers';

const at = utc('2026-10-06T12:00:00');
const game = makeGame();
const task = makeTask();
const state = () =>
  makeState({
    games: [{ ...game }],
    resources: [makeResource()],
    tasks: [{ ...task }],
    snapshots: [makeSnapshot({ takenAt: at - 60_000, value: 90 })],
  });
const batch = (over: Partial<GameImportBatch> = {}): GameImportBatch => ({
  id: 'import-1',
  gameId: game.id,
  source: { kind: 'account', provider: 'hoyolab' },
  observedAt: at,
  resources: [{ resourceId: 'r1', value: 123 }],
  tasks: [{ taskId: 't1', done: true }],
  ...over,
});

describe('game observation import planning', () => {
  it('plans concrete readings and derives the task period from capture time', () => {
    const plan = planGameImport(state(), batch(), at);
    expect(plan.issues).toEqual([]);
    expect(plan.resources).toEqual([{ resourceId: 'r1', value: 123 }]);
    expect(plan.tasks).toEqual([{ taskId: 't1', periodKey: taskPeriodKey(game, task, at), done: true }]);
  });

  it('does not turn unknown observations into zeros or incomplete tasks', () => {
    const plan = planGameImport(
      state(),
      batch({ resources: [{ resourceId: 'r1', value: null }], tasks: [{ taskId: 't1', done: null }] }),
      at,
    );
    expect(plan.resources).toEqual([]);
    expect(plan.tasks).toEqual([]);
    expect(plan.issues.map((issue) => issue.reason)).toEqual(['unknown', 'unknown']);
  });

  it('rejects future observations before making any changes', () => {
    const plan = planGameImport(state(), batch({ observedAt: at + 1 }), at);
    expect(plan.issues[0]?.reason).toBe('invalid');
    expect(plan.resources.length + plan.tasks.length).toBe(0);
  });

  it('rejects negative, non-finite and oversized inputs', () => {
    for (const value of [-1, NaN, Infinity]) {
      expect(GameImportBatchSchema.safeParse(batch({ resources: [{ resourceId: 'r1', value }] })).success).toBe(false);
    }
    expect(
      GameImportBatchSchema.safeParse(
        batch({ resources: Array.from({ length: 101 }, () => ({ resourceId: 'r1', value: 1 })) }),
      ).success,
    ).toBe(false);
  });

  it('strips fields that must not enter state or history', () => {
    const parsed = GameImportBatchSchema.parse({
      ...batch(),
      cookie: 'private',
      image: 'data:image/png;base64,private',
      source: { kind: 'account', provider: 'hoyolab', password: 'private' },
    });
    expect(parsed).not.toHaveProperty('cookie');
    expect(parsed).not.toHaveProperty('image');
    expect(parsed.source).not.toHaveProperty('password');
  });

  it('rejects another account even when the game title is the same', () => {
    const current = state();
    current.games.push(makeGame({ id: 'other-account' }));
    const plan = planGameImport(current, batch({ gameId: 'other-account' }), at);
    expect(plan.resources.length + plan.tasks.length).toBe(0);
    expect(plan.issues.map((issue) => issue.reason)).toEqual(['wrong-game', 'wrong-game']);
  });

  it('rejects deleted accounts, resources and tasks', () => {
    const current = state();
    current.resources[0]!.deleted = true;
    current.tasks[0]!.deleted = true;
    expect(planGameImport(current, batch(), at).issues).toHaveLength(2);
    current.games[0] = { ...game, deleted: true };
    expect(planGameImport(current, batch(), at).issues[0]?.reason).toBe('wrong-game');
  });

  it('keeps newer manual readings and completion edits', () => {
    const current = state();
    current.snapshots = [makeSnapshot({ takenAt: at + 1, value: 22 })];
    const periodKey = taskPeriodKey(game, task, at);
    current.completions = [
      { id: completionId(task.id, periodKey), taskId: task.id, periodKey, done: false, updatedAt: at + 1 },
    ];
    const plan = planGameImport(current, batch(), at + 10);
    expect(plan.resources.length + plan.tasks.length).toBe(0);
    expect(plan.issues.map((issue) => issue.reason)).toEqual(['stale', 'stale']);
  });

  it('requires review for uncertain screenshots, including missing confidence', () => {
    const screenshot = batch({
      source: { kind: 'screenshot', provider: 'ocr' },
      resources: [{ resourceId: 'r1', value: 123, confidence: 0.7 }],
      tasks: [{ taskId: 't1', done: true }],
    });
    expect(planGameImport(state(), screenshot, at).issues.map((issue) => issue.reason)).toEqual([
      'needs-review',
      'needs-review',
    ]);
    screenshot.resources![0]!.confirmed = true;
    screenshot.tasks![0]!.confirmed = true;
    expect(planGameImport(state(), screenshot, at).issues).toEqual([]);
  });

  it('accepts high-confidence screenshots and rejects values above local capacity', () => {
    const screenshot = batch({
      source: { kind: 'screenshot', provider: 'ocr' },
      resources: [{ resourceId: 'r1', value: 123, confidence: 0.95 }],
      tasks: [],
    });
    expect(planGameImport(state(), screenshot, at).resources).toHaveLength(1);
    screenshot.resources![0]!.value = 201;
    expect(planGameImport(state(), screenshot, at).issues[0]?.reason).toBe('invalid');
  });

  it('rejects replayed batches using syncable provenance', () => {
    const current = state();
    current.snapshots[0]!.provenance = importProvenance(batch(), at);
    expect(planGameImport(current, batch(), at).issues[0]?.reason).toBe('duplicate');
  });

  it('does not apply yesterday’s completion to today', () => {
    const plan = planGameImport(state(), batch({ observedAt: at - 86_400_000, resources: [] }), at);
    expect(plan.tasks).toEqual([]);
    expect(plan.issues[0]?.reason).toBe('stale');
  });

  it('derives count completion without guessing unknown partial progress', () => {
    const current = state();
    current.tasks = [makeTask({ mode: 'count', countTarget: 3 })];
    expect(planGameImport(current, batch({ tasks: [{ taskId: 't1', done: false }] }), at).issues[0]?.reason).toBe(
      'unknown',
    );
    expect(
      planGameImport(current, batch({ tasks: [{ taskId: 't1', done: null, countDone: 2 }] }), at).tasks[0],
    ).toMatchObject({ countDone: 2, done: false });
    expect(planGameImport(current, batch({ tasks: [{ taskId: 't1', done: true }] }), at).tasks[0]).toMatchObject({
      countDone: 3,
      done: true,
    });
  });

  it('does not infer running timers or custom timeline windows from a checkbox', () => {
    const current = state();
    for (const patch of [{ mode: 'timer' as const }, { cadence: 'custom' as const }]) {
      current.tasks = [makeTask(patch)];
      expect(planGameImport(current, batch(), at).issues[0]?.reason).toBe('unsupported');
    }
  });

  it('preserves provenance through validation, normalization and merge', () => {
    const current = state();
    current.snapshots[0]!.provenance = importProvenance(batch(), at);
    expect(safeParseAppState(current).success).toBe(true);
    expect(normalizeState(current).snapshots[0]!.provenance).toEqual(current.snapshots[0]!.provenance);
    expect(mergeState(makeState(), current).snapshots[0]!.provenance).toEqual(current.snapshots[0]!.provenance);
  });

  it('salvages readings when optional provenance is damaged', () => {
    const current = state();
    const corrupted = { ...current, snapshots: [{ ...current.snapshots[0], provenance: { kind: 'bad' } }] };
    expect(normalizeState(corrupted).snapshots).toHaveLength(1);
    expect(normalizeState(corrupted).snapshots[0]).not.toHaveProperty('provenance');
  });
});
