import { emptyState, latestSnapshots, mergeState, taskPeriodKey, type GameImportBatch } from '@memoria/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const idb = vi.hoisted(() => new Map<string, unknown>());
vi.mock('idb-keyval', () => ({
  get: vi.fn(async (key: string) => idb.get(key)),
  set: vi.fn(async (key: string, value: unknown) => {
    idb.set(key, value);
  }),
  del: vi.fn(async (key: string) => {
    idb.delete(key);
  }),
  keys: vi.fn(async () => [...idb.keys()]),
}));

import { flushPersist, useApp } from '../src/store';

beforeEach(async () => {
  await flushPersist();
  idb.clear();
  localStorage.clear();
  useApp.setState({ state: emptyState(), importHistory: [], loaded: false, loadError: '', saveError: '' });
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-06T12:00:00Z'));
});

afterEach(async () => {
  await flushPersist();
  vi.clearAllTimers();
  vi.useRealTimers();
});

function setup() {
  const gameId = useApp.getState().addBlankGame('Import test');
  const resource = useApp.getState().state.resources.find((item) => item.gameId === gameId)!;
  useApp.getState().addTask(gameId, 'Dailies', 'daily');
  const task = useApp.getState().state.tasks.find((item) => item.gameId === gameId)!;
  vi.advanceTimersByTime(1_000);
  useApp.getState().setEnergy(resource.id, 40);
  vi.advanceTimersByTime(1_000);
  const batch: GameImportBatch = {
    id: 'import-1',
    gameId,
    observedAt: Date.now(),
    source: { kind: 'account', provider: 'hoyolab' },
    resources: [{ resourceId: resource.id, value: 70 }],
    tasks: [{ taskId: task.id, done: true }],
  };
  return { gameId, resource, task, batch };
}

describe('game imports in the store', () => {
  it('lets a real reading replace a newer synthetic initial estimate without changing capture time', () => {
    const capturedAt = Date.now() - 60_000;
    const gameId = useApp.getState().addBlankGame('Fresh account');
    const resource = useApp.getState().state.resources.find((item) => item.gameId === gameId)!;
    const result = useApp.getState().applyGameImport({
      id: 'before-onboarding',
      gameId,
      observedAt: capturedAt,
      source: { kind: 'screenshot', provider: 'test' },
      resources: [{ resourceId: resource.id, value: 34, confirmed: true }],
    });
    expect(result.applied).toBe(1);
    expect(latestSnapshots(useApp.getState().state.snapshots).get(resource.id)).toMatchObject({
      value: 34,
      takenAt: capturedAt,
      provenance: { kind: 'screenshot' },
    });
    expect(latestSnapshots(mergeState(emptyState(), useApp.getState().state).snapshots).get(resource.id)?.value).toBe(
      34,
    );
  });
  it('records evidence once, persists it and keeps history outside synced state', async () => {
    const { resource, batch } = setup();
    expect(useApp.getState().applyGameImport(batch)).toMatchObject({ applied: 2, skipped: 0 });
    expect(latestSnapshots(useApp.getState().state.snapshots).get(resource.id)).toMatchObject({
      value: 70,
      takenAt: batch.observedAt,
      provenance: { kind: 'account', provider: 'hoyolab', batchId: batch.id },
    });
    expect(useApp.getState().state.completions[0]).toMatchObject({ done: true, updatedAt: batch.observedAt });
    expect(useApp.getState().applyGameImport(batch)).toMatchObject({ applied: 0, skipped: 1 });
    await flushPersist();
    expect(idb.get('memoria-state')).not.toHaveProperty('importHistory');
    useApp.setState({ importHistory: [] });
    await useApp.getState().load();
    expect(useApp.getState().importHistory).toHaveLength(1);
  });

  it('undoes an import with syncable corrections and cannot replay the undone batch', () => {
    const { resource, batch } = setup();
    useApp.getState().applyGameImport(batch);
    const imported = useApp.getState().state;
    vi.advanceTimersByTime(1_000);
    expect(useApp.getState().undoGameImport(batch.id)).toMatchObject({ applied: 2, skipped: 0 });
    const undone = useApp.getState().state;
    expect(latestSnapshots(undone.snapshots).get(resource.id)).toMatchObject({
      value: 40,
      provenance: { kind: 'manual' },
    });
    expect(undone.completions[0]).toMatchObject({ done: false, deleted: true });
    const synced = mergeState(imported, undone);
    expect(latestSnapshots(synced.snapshots).get(resource.id)?.value).toBe(40);
    expect(synced.completions[0]?.deleted).toBe(true);
    expect(useApp.getState().applyGameImport(batch).applied).toBe(0);
    expect(useApp.getState().importHistory[0]?.status).toBe('undone');
  });

  it('does not undo newer manual resource or task changes', () => {
    const { resource, task, batch } = setup();
    useApp.getState().applyGameImport(batch);
    vi.advanceTimersByTime(1_000);
    const game = useApp.getState().state.games[0]!;
    useApp.getState().setEnergy(resource.id, 55);
    useApp.getState().setTaskDone(task.id, taskPeriodKey(game, task, Date.now()), false);
    expect(useApp.getState().undoGameImport(batch.id)).toMatchObject({ applied: 0, skipped: 2 });
    expect(latestSnapshots(useApp.getState().state.snapshots).get(resource.id)?.value).toBe(55);
    expect(useApp.getState().state.completions[0]?.done).toBe(false);
  });

  it('does not overwrite a newer manual reading with a delayed import', () => {
    const { resource, batch } = setup();
    vi.advanceTimersByTime(1_000);
    useApp.getState().setEnergy(resource.id, 33);
    expect(useApp.getState().applyGameImport(batch)).toMatchObject({ applied: 1, skipped: 1 });
    expect(latestSnapshots(useApp.getState().state.snapshots).get(resource.id)?.value).toBe(33);
  });

  it('preserves a known reserve when the provider does not report it', () => {
    const { resource, batch, gameId } = setup();
    useApp.getState().upsertResource({ id: resource.id, gameId, reserveCap: 100 });
    vi.advanceTimersByTime(1_000);
    useApp.getState().setEnergy(resource.id, 40, 25);
    vi.advanceTimersByTime(1_000);
    batch.observedAt = Date.now();
    useApp.getState().applyGameImport(batch);
    expect(latestSnapshots(useApp.getState().state.snapshots).get(resource.id)?.reserve).toBe(25);
  });

  it('restores previous partial task progress and preserves it across sync', () => {
    const { task, batch } = setup();
    useApp.getState().updateTask(task.id, { mode: 'count', countTarget: 3 });
    vi.advanceTimersByTime(1_000);
    const game = useApp.getState().state.games[0]!;
    const key = taskPeriodKey(game, task, Date.now());
    useApp.getState().setTaskCount(task.id, key, 1);
    vi.advanceTimersByTime(1_000);
    batch.observedAt = Date.now();
    batch.tasks = [{ taskId: task.id, done: true, countDone: 3 }];
    useApp.getState().applyGameImport(batch);
    const imported = useApp.getState().state;
    vi.advanceTimersByTime(1_000);
    useApp.getState().undoGameImport(batch.id);
    expect(mergeState(imported, useApp.getState().state).completions[0]).toMatchObject({ done: false, countDone: 1 });
  });

  it('rejects unchanged imports without announcing a state mutation', () => {
    const { batch } = setup();
    const announce = vi.fn();
    document.addEventListener('tg-mutated', announce);
    try {
      batch.resources![0]!.value = null;
      batch.tasks![0]!.done = null;
      expect(useApp.getState().applyGameImport(batch).applied).toBe(0);
      expect(announce).not.toHaveBeenCalled();
      expect(useApp.getState().importHistory).toEqual([]);
    } finally {
      document.removeEventListener('tg-mutated', announce);
    }
  });

  it('clears device-local import receipts when clearing local data', async () => {
    const { batch } = setup();
    useApp.getState().applyGameImport(batch);
    await useApp.getState().clearLocalData();
    expect(useApp.getState().importHistory).toEqual([]);
    expect(localStorage.getItem('memoria-import-history')).toBeNull();
  });
});
