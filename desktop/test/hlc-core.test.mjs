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
it('keeps PC history in the atomic disk document and strips it from reads', () => {
  const state = JSON.parse(core.read(null));
  state.reminders = [
    {
      id: 'r',
      gameId: null,
      message: 'Test',
      at: 100,
      updatedAt: 1,
      hlc: { wall: 1, counter: 0, device: 'phone' },
      deviceId: 'phone',
    },
  ];
  const result = core.merge(null, JSON.stringify({ state }));
  expect(result.status).toBe(200);
  expect(JSON.parse(result.json).localHistory.journal.at(-1).changes[0].after.deviceId).toBe('phone');
  expect(JSON.parse(core.read(result.json)).localHistory).toBeUndefined();
});
