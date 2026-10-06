import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as core from '@memoria/shared';
import { createLanSync, createStateAccess } from '../lan-sync.mjs';

let service;
let origin;
let disk;
let clock;
let writes;
const post = (path, body, headers = {}) =>
  fetch(`${origin}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
const credentials = async () => {
  const response = await post('/pair', { code: service.status().code });
  expect(response.status).toBe(200);
  return response.json();
};
const game = (id, updatedAt = 1, deleted = false) => ({
  id,
  name: id,
  short: id,
  color: '#ffffff',
  icon: '',
  platform: 'pc',
  tz: 'UTC',
  dailyResetHour: 4,
  weeklyResetDay: 1,
  monthlyResetDay: 1,
  paused: false,
  sort: 0,
  updatedAt,
  deleted,
});

beforeEach(async () => {
  disk = core.emptyState();
  clock = 100_000;
  writes = 0;
  const state = createStateAccess({
    loadCore: async () => core,
    read: () => disk,
    write: (next) => {
      disk = next;
      writes++;
    },
  });
  service = createLanSync({ state, port: 0, now: () => clock });
  const status = await service.control({ action: 'start' });
  origin = `http://127.0.0.1:${status.port}`;
});
afterEach(async () => {
  await service.control({ action: 'stop' });
});

describe('paired LAN listener', () => {
  it('keeps pairing controls and authorization unchanged when config writes fail', async () => {
    let saved = { enabled: false, devices: [] };
    let failing = true;
    const transactional = createLanSync({
      port: 0,
      load: () => saved,
      save: (config) => {
        if (failing) throw new Error('Disk write failed');
        saved = structuredClone(config);
      },
      state: { merge: async (state) => state },
    });
    try {
      await expect(transactional.control({ action: 'start' })).rejects.toThrow('Disk write failed');
      expect(transactional.status().enabled).toBe(false);
      expect(saved.enabled).toBe(false);
      failing = false;
      await transactional.control({ action: 'start' });
      const address = `http://127.0.0.1:${transactional.status().port}`;
      const call = (path, body, token) =>
        fetch(`${address}${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify(body),
        });
      const code = transactional.status().code;
      failing = true;
      expect((await call('/pair', { code })).status).toBe(500);
      expect(transactional.status().code).toBe(code);
      expect(transactional.status().devices).toHaveLength(0);
      expect(saved.devices).toHaveLength(0);
      failing = false;
      const { token, deviceId } = await (await call('/pair', { code })).json();
      failing = true;
      await expect(transactional.control({ action: 'revoke', id: deviceId })).rejects.toThrow('Disk write failed');
      expect(transactional.status().devices).toHaveLength(1);
      expect(saved.devices).toHaveLength(1);
      expect((await call('/disconnect', {}, token)).status).toBe(500);
      expect(transactional.status().devices).toHaveLength(1);
      expect((await call('/sync', { state: core.emptyState() }, token)).status).toBe(200);
      await expect(transactional.control({ action: 'stop' })).rejects.toThrow('Disk write failed');
      expect(transactional.status().enabled).toBe(true);
      expect(saved.enabled).toBe(true);
      expect((await call('/sync', { state: core.emptyState() }, token)).status).toBe(200);
      failing = false;
      await transactional.control({ action: 'revoke', id: deviceId });
      expect(saved.devices).toHaveLength(0);
      expect((await call('/sync', { state: core.emptyState() }, token)).status).toBe(401);
    } finally {
      failing = false;
      await transactional.control({ action: 'stop' });
    }
    expect(saved.enabled).toBe(false);
  });

  it.each([{ devices: [null] }, { enabled: 'yes' }, [], 'corrupt', null])(
    'isolates invalid pairing metadata until explicit recovery: %j',
    async (saved) => {
      let stored = saved;
      let backedUp;
      const recovering = createLanSync({
        state: {},
        port: 0,
        load: () => stored,
        save: (value) => {
          stored = value;
        },
        reset: () => {
          backedUp = stored;
        },
      });
      expect((await recovering.restore()).enabled).toBe(false);
      expect(recovering.status().error).toContain('Saved phone connections could not be read');
      await expect(recovering.control({ action: 'start' })).rejects.toMatchObject({ status: 409 });
      expect(stored).toEqual(saved);
      await recovering.control({ action: 'reset' });
      expect(backedUp).toEqual(saved);
      expect(stored).toEqual({ enabled: false, devices: [] });
      expect(recovering.status().error).toBeNull();
    },
  );

  it('reports collection overflow without replacing the PC document', async () => {
    const { token } = await credentials();
    disk = { ...disk, games: Array.from({ length: 100 }, (_, i) => game(`z${i}`)) };
    const before = structuredClone(disk);
    const response = await post(
      '/sync',
      { state: { ...core.emptyState(), games: [game('a-new')] } },
      { authorization: `Bearer ${token}` },
    );
    expect(response.status).toBe(413);
    expect((await response.json()).error).toContain('combined games exceed the 100 item limit');
    expect(disk).toEqual(before);
    expect(writes).toBe(0);
  });

  it('does not promote an impossible phone snapshot over the current PC reading', async () => {
    const { token } = await credentials();
    const reading = { id: 'pc-reading', resourceId: 'energy', value: 20, takenAt: Date.now() - 60_000 };
    disk = { ...disk, snapshots: [reading] };
    const response = await post(
      '/sync',
      {
        state: {
          ...core.emptyState(),
          games: [game('phone')],
          snapshots: [{ id: 'future-reading', resourceId: 'energy', value: 100, takenAt: Date.now() + 86_400_000 }],
        },
      },
      { authorization: `Bearer ${token}` },
    );

    expect(response.status).toBe(200);
    expect(disk.snapshots).toEqual([reading]);
    expect(disk.games.map((item) => item.id)).toEqual(['phone']);
  });

  it('rejects browsers and unauthenticated sync, consumes code once, and revokes tokens', async () => {
    const code = service.status().code;
    expect((await post('/pair', { code }, { origin: 'https://untrusted.example' })).status).toBe(403);
    expect((await post('/sync', { state: disk })).status).toBe(401);
    const { token, deviceId } = await credentials();
    expect((await post('/pair', { code })).status).toBe(401);
    expect((await post('/sync', { state: disk }, { authorization: `Bearer ${token}` })).status).toBe(200);
    expect(JSON.stringify(service.status())).not.toContain(token);
    await service.control({ action: 'revoke', id: deviceId });
    expect((await post('/sync', { state: disk }, { authorization: `Bearer ${token}` })).status).toBe(401);
  });

  it('expires pairing codes and rate limits guesses including malformed codes', async () => {
    const code = service.status().code;
    clock += 300_001;
    expect((await post('/pair', { code })).status).toBe(401);
    for (let attempt = 0; attempt < 4; attempt++) expect((await post('/pair', { code: 'éééééééé' })).status).toBe(401);
    expect((await post('/pair', { code })).status).toBe(429);
    clock += 60_001;
    await service.control({ action: 'code' });
    await credentials();
  });

  it('rejects invalid and oversized documents before writes and preserves tombstones', async () => {
    const { token } = await credentials();
    const headers = { authorization: `Bearer ${token}` };
    expect((await post('/sync', null, headers)).status).toBe(400);
    expect((await post('/sync', { state: {} }, headers)).status).toBe(400);
    expect((await post('/sync', { state: 'x'.repeat(1_000_001) }, headers)).status).toBe(413);
    expect(writes).toBe(0);
    disk = { ...disk, games: [game('deleted', 30, true)] };
    const response = await post(
      '/sync',
      { state: { ...core.emptyState(), games: [game('deleted', 20), game('new', 20)] } },
      headers,
    );
    expect(response.status).toBe(200);
    expect(disk.games.find((item) => item.id === 'deleted').deleted).toBe(true);
    expect(disk.games.some((item) => item.id === 'new')).toBe(true);
  });

  it('stops the LAN listener and retains devices for later opt-in', async () => {
    await credentials();
    const stopped = await service.control({ action: 'stop' });
    expect(stopped.enabled).toBe(false);
    expect(stopped.code).toBeNull();
    expect(stopped.devices).toHaveLength(1);
    await expect(post('/sync', {})).rejects.toThrow();
  });
});

it('serializes PC and phone merges and rechecks revocation after queued work', async () => {
  let unblock;
  const gate = new Promise((resolve) => {
    unblock = resolve;
  });
  let authorized = true;
  const access = createStateAccess({
    loadCore: async () => {
      await gate;
      return core;
    },
    read: () => disk,
    write: (state) => {
      disk = state;
    },
  });
  const first = access.merge({ ...core.emptyState(), games: [game('pc')] });
  const second = access.merge({ ...core.emptyState(), games: [game('phone')] });
  const revoked = access.merge(core.emptyState(), () => authorized);
  authorized = false;
  const rejection = expect(revoked).rejects.toMatchObject({ status: 401 });
  unblock();
  await Promise.all([first, second, rejection]);
  expect(disk.games.map((item) => item.id).sort()).toEqual(['pc', 'phone']);
});
