import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { emptyState, mergeState, normalizeState, PRESETS, latestSnapshots } from '@memoria/shared';
const disk = vi.hoisted(() => new Map<string, unknown>());
vi.mock('idb-keyval', () => ({
  get: vi.fn(async (key: string) => disk.get(key)),
  set: vi.fn(async (key: string, value: unknown) => {
    disk.set(key, structuredClone(value));
  }),
  del: vi.fn(async (key: string) => {
    disk.delete(key);
  }),
  keys: vi.fn(async () => [...disk.keys()]),
}));
import { set as idbSet } from 'idb-keyval';
import { flushPersist, useApp } from '../src/store';
import { mergeCloudDocument } from '../src/cloud-sync';
beforeEach(async () => {
  await flushPersist();
  disk.clear();
  useApp.setState({ state: emptyState(), loaded: false });
  await useApp.getState().load();
  vi.useFakeTimers();
});
afterEach(async () => {
  await flushPersist();
  vi.useRealTimers();
});

it('completes only daily checkboxes as one action and undo keeps later edits', () => {
  const gameId = useApp.getState().addGameFromPreset(
    PRESETS.find((preset) => preset.key === 'genshin')!,
    {},
  );
  useApp.getState().addTask(gameId, 'Daily counter', 'daily');
  const counter = useApp.getState().state.tasks.at(-1)!;
  useApp.getState().updateTask(counter.id, { mode: 'count', countTarget: 5 });
  const id = useApp.getState().completeDailies(gameId)!;
  const action = useApp.getState().history.journal.find((entry) => entry.id === id)!;
  expect(action.changes.length).toBeGreaterThan(0);
  expect(action.changes.every((change) => change.collection === 'completions')).toBe(true);
  expect(useApp.getState().state.completions.some((item) => item.taskId === counter.id)).toBe(false);
  const completion = useApp.getState().state.completions[0]!;
  useApp.getState().setTaskDone(completion.taskId, completion.periodKey, false);
  useApp.getState().updateGame(gameId, { notes: 'Keep this note' });
  useApp.getState().undoActivity(id);
  expect(useApp.getState().state.games[0]?.notes).toBe('Keep this note');
  expect(useApp.getState().state.completions.filter((item) => item.done && !item.deleted)).toHaveLength(0);
});
it('restores a deleted game with its tasks, readings, events and completions, then wins sync', () => {
  const gameId = useApp.getState().addGameFromPreset(PRESETS[0]!, {});
  useApp.getState().completeDailies(gameId);
  const original = useApp.getState().state;
  expect(original.events.length).toBeGreaterThan(0);
  useApp.getState().deleteGame(gameId);
  const id = useApp.getState().history.journal.at(-1)!.id;
  const deleted = useApp.getState().state;
  useApp.getState().undoActivity(id);
  const restored = mergeState(deleted, useApp.getState().state);
  for (const key of ['games', 'resources', 'tasks', 'snapshots', 'events', 'completions'] as const)
    expect(restored[key].filter((row) => !row.deleted)).toHaveLength(original[key].length);
  expect(latestSnapshots(restored.snapshots).size).toBeGreaterThan(0);
});
it('saves state and history together; a failed write preserves both old copies', async () => {
  const gameId = useApp.getState().addBlankGame('Original');
  await flushPersist();
  const original = disk.get('memoria-state');
  useApp.getState().updateGame(gameId, { name: 'Updated' });
  vi.mocked(idbSet).mockRejectedValueOnce(new Error('disk full'));
  await expect(flushPersist()).rejects.toThrow('disk full');
  expect(disk.get('memoria-state')).toEqual(original);
  await flushPersist();
  const saved = disk.get('memoria-state') as { localHistory: ReturnType<typeof useApp.getState>['history'] };
  expect(saved.localHistory.journal.at(-1)?.changes[0]?.after?.name).toBe('Updated');
  expect(normalizeState(saved).games[0]?.name).toBe('Updated');
  expect(JSON.stringify(useApp.getState().state)).not.toContain('localHistory');
});
it('journals migrations, sync arrivals and feed imports, with automatic checkpoints', async () => {
  useApp.getState().addGameFromPreset(PRESETS[0]!, {});
  await flushPersist();
  const legacy = { ...useApp.getState().state, schemaVersion: 9 };
  disk.set('memoria-state', legacy);
  await useApp.getState().load();
  expect(useApp.getState().history.journal.some((entry) => entry.label === 'Migration')).toBe(true);
  const remote = {
    ...useApp.getState().state,
    games: useApp.getState().state.games.map((game) => ({
      ...game,
      name: 'Remote',
      hlc: { wall: Date.now() + 9999, counter: 0, device: 'phone' },
      deviceId: 'phone',
    })),
  };
  useApp.getState().replaceState(mergeState(useApp.getState().state, remote));
  expect(useApp.getState().history.journal.at(-1)?.label).toBe('Sync arrivals');
  expect(useApp.getState().history.checkpoints.map((item) => item.label)).toEqual(
    expect.arrayContaining(['Before migration', 'Before sync', 'Daily checkpoint']),
  );
});
it('refuses an old sync peer but still imports an old backup file', () => {
  const old = { ...emptyState(), schemaVersion: 9 };
  const before = useApp.getState().state;
  expect(() => mergeCloudDocument(before, JSON.stringify(old))).toThrow(/Update Memoria/);
  expect(useApp.getState().state).toBe(before);
  expect(useApp.getState().importJson(JSON.stringify(old))).toBe(true);
  expect(useApp.getState().importJson(JSON.stringify({ ...emptyState(), schemaVersion: 99 }))).toBe(false);
});
it('checkpoint restore survives the next peer sync and removes later additions', () => {
  const gameId = useApp.getState().addBlankGame('Keep');
  const checkpoint = useApp.getState().history.checkpoints.find((item) => item.label === 'Daily checkpoint')!;
  useApp.getState().updateGame(gameId, { name: 'Bad' });
  const peer = useApp.getState().state;
  useApp.getState().restoreSavedCheckpoint(checkpoint.id);
  expect(mergeState(peer, useApp.getState().state).games.find((game) => game.id === gameId)?.deleted).toBe(true);
});
