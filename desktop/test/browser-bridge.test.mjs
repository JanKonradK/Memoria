import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { browserRequestHeaders, createBrowserConnections, publishBrowserSnapshot } from '../browser-bridge.mjs';

const directories = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});
const current = 1_790_000_000_000;
const account = { provider: 'genshin', uid: '712345678', server: 'os_euro', nickname: 'Traveler' };
const snapshot = (at = current, data = { current_resin: 120 }) => ({
  version: 1,
  fetchedAt: at,
  accounts: [{ ...account, reading: { observedAt: at, data } }],
});
function make() {
  const directory = mkdtempSync(join(tmpdir(), 'memoria-browser-test-'));
  directories.push(directory);
  let clock = current;
  const games = [{ id: 'game-one', presetKey: 'genshin', paused: false }];
  return {
    directory,
    games,
    setTime(value) {
      clock = value;
    },
    service: createBrowserConnections({ directory, getGames: async () => games, now: () => clock }),
  };
}
const connect = { action: 'connect', gameId: 'game-one', ...account, autoRefresh: true };

describe('browser account store', () => {
  it.each([
    ['genshin', 'os_euro', 'sg-public-api.hoyolab.com', 'hk4e_global'],
    ['hsr', 'prod_official_eur', 'bbs-api-os.hoyolab.com', 'hkrpg_global'],
    ['zzz', 'prod_gf_eu', 'sg-act-public-api.hoyolab.com', 'nap_global'],
  ])('limits %s account headers to publisher endpoints', (provider, server, host, business) => {
    const notes = browserRequestHeaders(
      { provider, server, uid: account.uid, kind: 'notes', url: 'https://attacker.invalid' },
      current,
    );
    expect(new URL(notes.url).hostname).toBe(host);
    expect(new URL(notes.url).searchParams.get('role_id')).toBe(account.uid);
    expect(notes.headers.DS).toMatch(/^1790000000,[a-zA-Z]{6},[a-f0-9]{32}$/);
    expect(Object.keys(notes.headers).sort()).toEqual([
      'DS',
      'x-rpc-app_version',
      'x-rpc-client_type',
      'x-rpc-lang',
      'x-rpc-language',
    ]);
    expect(
      new URL(browserRequestHeaders({ provider, kind: 'accounts' }, current).url).searchParams.get('game_biz'),
    ).toBe(business);
    expect(() => browserRequestHeaders({ provider, server: 'invalid', uid: account.uid, kind: 'notes' })).toThrow(
      'supported',
    );
  });
  it('starts disconnected and returns account metadata without publisher extras', async () => {
    const { service, directory } = make();
    expect(service.status()).toEqual({ receivedAt: null, accounts: 0 });
    expect(await service.request()).toEqual({ connections: [] });
    await publishBrowserSnapshot(
      directory,
      snapshot(current, { current_resin: 120, profile: 'private-extra' }),
      current,
    );
    expect(await service.listAccounts({ provider: 'genshin' })).toEqual({ accounts: [account] });
    const result = await service.request(connect);
    expect(result.connections[0]).toEqual({
      gameId: 'game-one',
      provider: account.provider,
      uid: account.uid,
      server: account.server,
      autoRefresh: true,
      transport: 'browser',
      lastCheckedAt: current,
    });
    expect(result.reading).toEqual({
      gameId: 'game-one',
      provider: 'genshin',
      uid: account.uid,
      observedAt: current,
      data: { current_resin: 120 },
    });
    expect(readFileSync(join(directory, 'browser-readings.json'), 'utf8')).not.toContain('private-extra');
  });
  it('rejects credentials anywhere without writing them', async () => {
    const { directory, service } = make();
    await expect(
      publishBrowserSnapshot(
        directory,
        snapshot(current, { current_resin: 1, daily_task: { cookie: 'private' } }),
        current,
      ),
    ).rejects.toThrow('sign-in data');
    expect(service.status()).toEqual({ receivedAt: null, accounts: 0 });
    expect(() => browserRequestHeaders({ provider: 'genshin', kind: 'accounts', Cookie: 'private' })).toThrow(
      'sign-in data',
    );
    await expect(service.request({ ...connect, token: 'private' })).rejects.toThrow('sign-in data');
  });
  it('retains only fields used by the shared game mapping', async () => {
    const { directory } = make();
    await publishBrowserSnapshot(
      directory,
      {
        version: 1,
        fetchedAt: current,
        accounts: [
          {
            ...account,
            reading: {
              observedAt: current,
              data: {
                current_resin: 42,
                daily_task: { finished_num: 4, total_num: 4, claimed_commission_reward: true, profile: 'drop' },
              },
            },
          },
          {
            ...account,
            provider: 'hsr',
            server: 'prod_official_eur',
            reading: {
              observedAt: current,
              data: {
                current_stamina: 50,
                current_reserve_stamina: 60,
                current_train_score: 500,
                max_train_score: 500,
                profile: 'drop',
              },
            },
          },
          {
            ...account,
            provider: 'zzz',
            server: 'prod_gf_eu',
            reading: {
              observedAt: current,
              data: {
                energy: { progress: { current: 100, max: 240 }, reward: 'drop' },
                vitality: { current: 400, max: 400 },
                profile: 'drop',
              },
            },
          },
        ],
      },
      current,
    );
    const stored = JSON.parse(readFileSync(join(directory, 'browser-readings.json'), 'utf8'));
    expect(JSON.stringify(stored)).not.toContain('drop');
    expect(stored.accounts[0].reading.data.daily_task.claimed_commission_reward).toBe(true);
    expect(stored.accounts[1].reading.data.current_reserve_stamina).toBe(60);
    expect(stored.accounts[2].reading.data.energy).toEqual({ progress: { current: 100 } });
  });
  it('refuses stale and failing account readings without inventing a current observation', async () => {
    const { directory, service, setTime } = make();
    await publishBrowserSnapshot(directory, snapshot(), current);
    await service.request(connect);
    setTime(current + 15 * 60_000 + 1);
    await expect(service.request({ action: 'refresh', gameId: 'game-one' })).rejects.toThrow('read accounts again');
    expect((await service.request()).connections[0].lastCheckedAt).toBe(current);
    const failed = snapshot(current + 1000);
    failed.accounts[0].error = 'upstream private bearer content';
    delete failed.accounts[0].reading;
    await publishBrowserSnapshot(directory, failed, current + 1000);
    setTime(current + 1000);
    await expect(service.request({ action: 'refresh', gameId: 'game-one' })).rejects.toThrow('read accounts again');
    expect(readFileSync(join(directory, 'browser-readings.json'), 'utf8')).not.toContain('private bearer');
  });
  it('preserves a newer observation when a later account list has older notes', async () => {
    const { directory, service } = make();
    await publishBrowserSnapshot(directory, snapshot(), current);
    const later = snapshot(current + 1000, { current_resin: 1 });
    later.accounts[0].reading.observedAt = current - 1000;
    await publishBrowserSnapshot(directory, later, current + 1000);
    expect((await service.request(connect)).reading.data.current_resin).toBe(120);
    await publishBrowserSnapshot(directory, snapshot(current - 1000, { current_resin: 2 }), current + 1000);
    expect((await service.request({ action: 'refresh', gameId: 'game-one' })).reading.observedAt).toBe(current);
  });
  it('keeps the latest snapshot with separate concurrent host processes', async () => {
    const { directory } = make();
    const module = new URL('../browser-bridge.mjs', import.meta.url).href;
    const script =
      'const {publishBrowserSnapshot}=await import(process.argv[1]);await publishBrowserSnapshot(process.argv[2],JSON.parse(process.argv[3]),Number(process.argv[4]));';
    const publish = (value) =>
      new Promise((resolve, reject) => {
        const child = spawn(
          process.execPath,
          ['--input-type=module', '-e', script, module, directory, JSON.stringify(value), String(current + 10_000)],
          { windowsHide: true, stdio: 'pipe' },
        );
        let stderr = '';
        child.stderr.on('data', (chunk) => {
          stderr += chunk;
        });
        child.on('error', reject);
        child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(stderr))));
      });
    await Promise.all([
      publish(snapshot(current + 1000, { current_resin: 1 })),
      publish(snapshot(current + 3000, { current_resin: 3 })),
      publish(snapshot(current + 2000, { current_resin: 2 })),
    ]);
    const stored = JSON.parse(readFileSync(join(directory, 'browser-readings.json'), 'utf8'));
    expect(stored.fetchedAt).toBe(current + 3000);
    expect(stored.accounts[0].reading.data.current_resin).toBe(3);
  });
  it('recovers a damaged reading cache only after a valid publication and preserves its bytes', async () => {
    const { directory, service, setTime } = make();
    await publishBrowserSnapshot(directory, snapshot(), current);
    await service.request(connect);
    const bindings = join(directory, 'browser-connections.json');
    const savedBindings = readFileSync(bindings, 'utf8');
    const malformed = '{unreadable';
    const file = join(directory, 'browser-readings.json');
    writeFileSync(file, malformed);
    expect(service.status().error).toContain('could not be opened');
    await expect(publishBrowserSnapshot(directory, { ...snapshot(), version: 2 }, current)).rejects.toThrow('invalid');
    expect(readFileSync(file, 'utf8')).toBe(malformed);
    expect(readdirSync(directory).filter((name) => name.startsWith('browser-readings.corrupt-'))).toEqual([]);
    setTime(current + 1000);
    await publishBrowserSnapshot(directory, snapshot(current + 1000, { current_resin: 42 }), current + 1000);
    const quarantined = readdirSync(directory).filter((name) => name.startsWith('browser-readings.corrupt-'));
    expect(quarantined).toHaveLength(1);
    expect(readFileSync(join(directory, quarantined[0]), 'utf8')).toBe(malformed);
    expect(readFileSync(bindings, 'utf8')).toBe(savedBindings);
    expect(service.status()).toEqual({ receivedAt: current + 1000, accounts: 1 });
    const refreshed = await service.request({ action: 'refresh', gameId: 'game-one' });
    expect(refreshed.reading.observedAt).toBe(current + 1000);
    expect(refreshed.reading.data).toEqual({ current_resin: 42 });
  });
  it('keeps malformed bindings intact after a fresh browser reading', async () => {
    const { directory, service } = make();
    await publishBrowserSnapshot(directory, snapshot(), current);
    const malformed = '{unreadable';
    const bindings = join(directory, 'browser-connections.json');
    writeFileSync(bindings, malformed);
    await expect(service.request(connect)).rejects.toThrow('could not be opened');
    expect(readFileSync(bindings, 'utf8')).toBe(malformed);
  });
  it('allows disabling and disconnecting while the optional browser cache is damaged', async () => {
    const { directory, service } = make();
    await publishBrowserSnapshot(directory, snapshot(), current);
    await service.request(connect);
    const file = join(directory, 'browser-readings.json');
    writeFileSync(file, '{damaged-cache');
    const disabled = await service.request({ action: 'configure', gameId: 'game-one', autoRefresh: false });
    expect(disabled.connections[0].autoRefresh).toBe(false);
    expect(disabled.connections[0].lastCheckedAt).toBeNull();
    expect(disabled.error).toBeUndefined();
    expect(service.status().error).toContain('could not be opened');
    await expect(service.request({ action: 'refresh', gameId: 'game-one' })).rejects.toThrow('could not be opened');
    expect(await service.request({ action: 'disconnect', gameId: 'game-one' })).toEqual({ connections: [] });
    expect(readFileSync(file, 'utf8')).toBe('{damaged-cache');
  });
  it('keeps concurrent bindings, supports configure/disconnect, and checks saved games', async () => {
    const { directory, service, games } = make();
    games.push({ id: 'game-two', presetKey: 'genshin', paused: false });
    await publishBrowserSnapshot(directory, snapshot(), current);
    await Promise.all([service.request(connect), service.request({ ...connect, gameId: 'game-two' })]);
    expect((await service.request()).connections).toHaveLength(2);
    await service.request({ action: 'configure', gameId: 'game-one', autoRefresh: false });
    expect((await service.request()).connections.find((entry) => entry.gameId === 'game-one').autoRefresh).toBe(false);
    games[0].paused = true;
    await expect(service.request({ action: 'refresh', gameId: 'game-one' })).rejects.toThrow('Resume');
    games[0].paused = false;
    games[0].deleted = true;
    await expect(service.request({ action: 'refresh', gameId: 'game-one' })).rejects.toThrow('no longer available');
    await service.request({ action: 'disconnect', gameId: 'game-one' });
    expect((await service.request()).connections.map((entry) => entry.gameId)).toEqual(['game-two']);
    await expect(service.request({ ...connect, gameId: 'missing' })).rejects.toThrow('no longer available');
    games.push({ id: 'other-game', presetKey: 'hsr' });
    await expect(service.request({ ...connect, gameId: 'other-game' })).rejects.toThrow('matching');
  });
  it('rejects duplicate accounts, future times and oversize notes before saving', async () => {
    const { directory } = make();
    const duplicate = snapshot();
    duplicate.accounts.push(duplicate.accounts[0]);
    await expect(publishBrowserSnapshot(directory, duplicate, current)).rejects.toThrow('duplicate');
    await expect(publishBrowserSnapshot(directory, snapshot(current + 31_000), current)).rejects.toThrow(
      'invalid time',
    );
    await expect(
      publishBrowserSnapshot(directory, snapshot(current, { extra: 'x'.repeat(100_001) }), current),
    ).rejects.toThrow('too large');
  });
});
