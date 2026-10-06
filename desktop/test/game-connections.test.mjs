import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGameConnections, fetchGameAccounts, fetchGameNotes } from '../game-connections.mjs';

const dirs = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const path of dirs.splice(0)) rmSync(path, { recursive: true, force: true });
});
const entry = {
  gameId: 'game-one',
  provider: 'genshin',
  uid: '712345678',
  server: 'os_euro',
  cookie: 'ltuid_v2=123; ltoken_v2=test-session-private; unrelated=drop-me',
};
const reply = (data = { current_resin: 120 }) => new Response(JSON.stringify({ retcode: 0, data }));
function make(fetcher = vi.fn(async () => reply())) {
  const directory = mkdtempSync(join(tmpdir(), 'memoria-connections-test-'));
  dirs.push(directory);
  const seal = (text) => Buffer.from(text).toString('base64');
  const unseal = (text) => Buffer.from(text, 'base64').toString('utf8');
  return { directory, fetcher, service: createGameConnections({ directory, fetcher, seal, unseal }) };
}
describe('local game connections', () => {
  it.each([
    ['genshin', 'hk4e_global', 'os_euro'],
    ['hsr', 'hkrpg_global', 'prod_official_eur'],
    ['zzz', 'nap_global', 'prod_gf_eu'],
  ])(
    'discovers %s accounts without leaking credentials or extra publisher fields',
    async (provider, business, server) => {
      const fetcher = vi.fn(async () =>
        reply({
          list: [
            {
              game_uid: '712345678',
              region: server,
              nickname: 'Traveler\n' + 'x'.repeat(120),
              cookie: 'private-extra',
            },
            { game_uid: '712345678', region: server, nickname: 'duplicate' },
            { game_uid: 'invalid', region: server },
            { game_uid: '712345679', region: 'invalid' },
            null,
          ],
        }),
      );
      const result = await fetchGameAccounts({ provider, cookie: entry.cookie }, fetcher);
      expect(result.accounts).toEqual([
        { provider, uid: '712345678', server, nickname: ('Traveler' + 'x'.repeat(120)).slice(0, 100) },
      ]);
      expect(fetcher.mock.calls[0][0].origin).toBe('https://api-account-os.hoyolab.com');
      expect(fetcher.mock.calls[0][0].searchParams.get('game_biz')).toBe(business);
      expect(JSON.stringify(result)).not.toContain('private');
      expect(fetcher.mock.calls[0][1].headers.Cookie).not.toContain('unrelated');
      expect(fetcher.mock.calls[0][1].redirect).toBe('error');
    },
  );

  it('rejects invalid discovery requests and malformed account lists', async () => {
    const fetcher = vi.fn(async () => reply({ list: null }));
    await expect(fetchGameAccounts({ provider: 'anything', cookie: entry.cookie }, fetcher)).rejects.toThrow(
      'supported',
    );
    expect(fetcher).not.toHaveBeenCalled();
    await expect(fetchGameAccounts({ provider: 'genshin', cookie: entry.cookie }, fetcher)).rejects.toThrow(
      'no account list',
    );
  });

  it('preserves Unicode split across response chunks', async () => {
    const data = { current_resin: 120, name: '原神 — étoile 🌟' };
    const bytes = Buffer.from(JSON.stringify({ retcode: 0, data }));
    const fetcher = async () => ({
      ok: true,
      body: (async function* () {
        for (const byte of bytes) yield Uint8Array.of(byte);
      })(),
    });
    expect((await fetchGameNotes(entry, fetcher)).data).toEqual(data);
  });

  it('enforces the response byte limit before decoding', async () => {
    const fetcher = async () => ({ ok: true, body: [Buffer.alloc(1_000_001)] });
    await expect(fetchGameNotes(entry, fetcher)).rejects.toThrow('too large');
  });

  it('limits requests to supported publishers and rejects header injection', async () => {
    const fetcher = vi.fn();
    await expect(fetchGameNotes({ ...entry, provider: 'https://elsewhere.invalid' }, fetcher)).rejects.toThrow(
      'supported',
    );
    await expect(fetchGameNotes({ ...entry, cookie: `${entry.cookie}\r\nInjected: value` }, fetcher)).rejects.toThrow(
      'valid',
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('never returns session secrets and filters unrelated cookies', async () => {
    const { service, fetcher, directory } = make();
    const result = await service.control({ ...entry, action: 'connect' });
    expect(result.reading.data.current_resin).toBe(120);
    expect(JSON.stringify(result)).not.toContain('test-session-private');
    expect(fetcher.mock.calls[0][1].headers.Cookie).not.toContain('unrelated');
    expect(readFileSync(join(directory, 'game-connections.protected'), 'utf8')).not.toContain('test-session-private');
  });
  it('does not save an account rejected by the publisher', async () => {
    const { service } = make(vi.fn(async () => new Response(JSON.stringify({ retcode: 1034, message: entry.cookie }))));
    await expect(service.control({ ...entry, action: 'connect' })).rejects.toThrow('verification');
    expect(service.status().connections).toEqual([]);
  });
  it('reuses recent observations without inventing a new observation time', async () => {
    const { service, fetcher } = make();
    const first = await service.control({ ...entry, action: 'connect' });
    const second = await service.control({ action: 'refresh', gameId: entry.gameId });
    expect(second.reading.observedAt).toBe(first.reading.observedAt);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await service.control({ action: 'disconnect', gameId: entry.gameId });
    expect(service.status().connections).toEqual([]);
  });
  it('keeps other accounts when two connection checks finish together', async () => {
    const { service } = make();
    await Promise.all([
      service.control({ ...entry, action: 'connect' }),
      service.control({ ...entry, gameId: 'game-two', action: 'connect' }),
    ]);
    expect(service.status().connections).toHaveLength(2);
  });
  it('keeps failing closed when protected data is corrupt', () => {
    const { service, directory } = make();
    writeFileSync(join(directory, 'game-connections.protected'), Buffer.from('{"bad":true}').toString('base64'));
    expect(() => service.status()).toThrow('could not be opened');
    expect(() => service.status()).toThrow('could not be opened');
  });

  it('discards an old refresh when the same game is reconnected to another account', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(100_000);
    const { service, fetcher } = make();
    await service.control({ ...entry, action: 'connect' });
    now.mockReturnValue(200_000);
    let finishOld;
    fetcher.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishOld = resolve;
        }),
    );
    const old = service.control({ action: 'refresh', gameId: entry.gameId });
    const rejected = expect(old).rejects.toThrow('connection changed');
    const replacement = { ...entry, uid: '798765432', action: 'connect' };
    await service.control(replacement);
    finishOld(reply({ current_resin: 1 }));
    await rejected;
    const refreshed = await service.control({ action: 'refresh', gameId: entry.gameId });
    expect(refreshed.reading.uid).toBe(replacement.uid);
    expect(refreshed.reading.data.current_resin).toBe(120);
    expect(service.status().connections[0].uid).toBe(replacement.uid);
  });

  it('invalidates an old-account refresh started while a reconnect is pending', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(100_000);
    const { service, fetcher } = make();
    await service.control({ ...entry, action: 'connect' });
    now.mockReturnValue(200_000);
    let finishConnect;
    let finishOld;
    fetcher.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishConnect = resolve;
        }),
    );
    const reconnect = service.control({ ...entry, uid: '798765432', action: 'connect' });
    fetcher.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishOld = resolve;
        }),
    );
    const old = service.control({ action: 'refresh', gameId: entry.gameId });
    const rejected = expect(old).rejects.toThrow('connection changed');
    finishConnect(reply());
    await reconnect;
    finishOld(reply({ current_resin: 1 }));
    await rejected;
    const refreshed = await service.control({ action: 'refresh', gameId: entry.gameId });
    expect(refreshed.reading.uid).toBe('798765432');
  });

  it('does not recreate a connection when its pending check finishes after disconnect', async () => {
    const { service, fetcher } = make();
    let finish;
    fetcher.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const connecting = service.control({ ...entry, action: 'connect' });
    const rejected = expect(connecting).rejects.toThrow('connection changed');
    await service.control({ action: 'disconnect', gameId: entry.gameId });
    finish(reply());
    await rejected;
    expect(service.status().connections).toEqual([]);
  });

  it('keeps the latest connection when checks finish out of order', async () => {
    const { service, fetcher } = make();
    let finish;
    fetcher.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const older = service.control({ ...entry, action: 'connect' });
    const rejected = expect(older).rejects.toThrow('connection changed');
    await service.control({ ...entry, uid: '798765432', action: 'connect' });
    finish(reply());
    await rejected;
    expect(service.status().connections[0].uid).toBe('798765432');
  });

  it('enforces the account limit when concurrent checks finish', async () => {
    const { service } = make();
    for (let index = 0; index < 29; index++) {
      await service.control({ ...entry, gameId: `game-${index}`, action: 'connect' });
    }
    const results = await Promise.allSettled([
      service.control({ ...entry, gameId: 'game-29', action: 'connect' }),
      service.control({ ...entry, gameId: 'game-30', action: 'connect' }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(service.status().connections).toHaveLength(30);
  });
});
