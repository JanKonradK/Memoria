import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it } from 'vitest';
const core = runInNewContext(`${readFileSync(new URL('../dist/core.js', import.meta.url), 'utf8')}; MemoriaCore;`, {
  Intl,
});
it('rejects old protocol before changing the PC file', () => {
  const state = JSON.parse(core.read(null));
  const old = { ...state, schemaVersion: 9 };
  const result = core.merge(null, JSON.stringify({ state: old }));
  expect(result.status).toBe(426);
  expect(result.error).toMatch(/Update Memoria/);
  expect(result.json).toBeUndefined();
});
const reminder = (id, extra = {}) => ({
  id,
  gameId: null,
  message: 'Test',
  at: 100,
  updatedAt: 1,
  hlc: { wall: 1, counter: 0, device: 'phone' },
  deviceId: 'phone',
  ...extra,
});
it('keeps PC history in its own file and never inside the state', () => {
  const state = JSON.parse(core.read(null));
  state.reminders = [reminder('r')];
  const result = core.merge(null, null, JSON.stringify({ state }));
  expect(result.status).toBe(200);
  expect(result.changed).toBe(true);
  expect(result.historyChanged).toBe(true);
  expect(result.json).toBe(result.stateJson);
  expect(JSON.parse(result.stateJson).localHistory).toBeUndefined();
  expect(JSON.parse(result.stateJson).reminders[0].id).toBe('r');
  const history = JSON.parse(result.historyJson);
  expect(history.journal.at(-1).changes[0].after.deviceId).toBe('phone');
  expect(history.checkpoints.map((item) => item.label)).toEqual(['Daily checkpoint']);

  // A second sync the same day adds no checkpoint, in particular no "Before sync" copy.
  state.reminders = [reminder('r'), reminder('s')];
  const next = core.merge(result.stateJson, result.historyJson, JSON.stringify({ state }));
  expect(next.changed).toBe(true);
  const nextHistory = JSON.parse(next.historyJson);
  expect(nextHistory.checkpoints).toHaveLength(1);
  expect(nextHistory.journal).toHaveLength(2);
  expect(JSON.parse(next.stateJson).localHistory).toBeUndefined();

  // Nothing new: neither file needs writing.
  const same = core.merge(next.stateJson, next.historyJson, JSON.stringify({ state }));
  expect(same.changed).toBe(false);
  expect(same.historyChanged).toBe(false);
});
it('moves a legacy localHistory out of state.json into history.json', () => {
  const state = JSON.parse(core.read(null));
  const legacy = {
    deviceId: 'PC core',
    journal: [{ id: 'old', at: 1, label: 'Edit: Old', changes: [] }],
    checkpoints: [],
  };
  const raw = JSON.stringify({ ...state, localHistory: legacy });
  expect(JSON.parse(core.read(raw)).localHistory).toBeUndefined();
  const result = core.merge(raw, null, JSON.stringify({ state }));
  expect(result.status).toBe(200);
  expect(result.changed).toBe(true);
  expect(result.historyChanged).toBe(true);
  expect(JSON.parse(result.stateJson).localHistory).toBeUndefined();
  expect(JSON.parse(result.historyJson).journal[0].id).toBe('old');
  // The earlier two-argument call still works and still strips history.
  const old = core.merge(raw, JSON.stringify({ state }));
  expect(old.status).toBe(200);
  expect(JSON.parse(old.json).localHistory).toBeUndefined();
});
it('drops tombstones past the retention window on the PC too, and slims them before that', () => {
  const state = JSON.parse(core.read(null));
  const deleted = (id, days) => {
    const at = Date.now() - days * 86_400_000;
    return reminder(id, { deleted: true, updatedAt: at, hlc: { wall: at, counter: 0, device: 'phone' } });
  };
  state.reminders = [deleted('gone', 366), deleted('slim', 91), deleted('fresh', 1)];
  const result = core.merge(null, null, JSON.stringify({ state }));
  const reminders = JSON.parse(result.stateJson).reminders;
  expect(reminders.map((row) => [row.id, row.message])).toEqual([
    ['fresh', 'Test'],
    ['slim', ''],
  ]);

  // The phone has not compacted yet and sends its full copy again: the PC
  // keeps the slimmed one and has nothing to write.
  const again = core.merge(result.stateJson, result.historyJson, JSON.stringify({ state }));
  expect(again.changed).toBe(false);
  expect(again.historyChanged).toBe(false);
});
