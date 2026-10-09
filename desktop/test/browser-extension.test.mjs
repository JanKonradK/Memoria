import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { ALARM, createWorker } from '../../browser-extension/background.mjs';
import { browserRequestHeaders } from '../browser-bridge.mjs';
import {
  createConnector,
  discoverAccounts,
  MESSAGES,
  PROVIDERS,
  readingData,
  validateRequest,
} from '../../browser-extension/hoyo-client.mjs';

const NOW = 1_791_500_000_000;
const SERVERS = { genshin: 'os_euro', hsr: 'prod_official_eur', zzz: 'prod_gf_eu' };
const NOTES = {
  genshin: {
    current_resin: 123,
    current_home_coin: 999,
    finished_task_num: 4,
    total_task_num: 4,
    is_extra_task_reward_received: true,
  },
  hsr: { current_stamina: 125, current_reserve_stamina: 8, current_train_score: 500, max_train_score: 500 },
  zzz: { energy: { progress: { current: 140, max: 240 } }, vitality: { current: 400, max: 400 } },
};
const ACCOUNT_URL = 'https://api-account-os.hoyolab.com/binding/api/getUserGameRolesByCookie';
const response = (data) => new Response(JSON.stringify({ retcode: 0, data }));
const headers = {
  DS: '1791500000,abcdef,0123456789abcdef0123456789abcdef',
  'x-rpc-app_version': '1.5.0',
  'x-rpc-client_type': '5',
  'x-rpc-language': 'en-us',
  'x-rpc-lang': 'en-us',
};
function signed(request) {
  const provider = PROVIDERS[request.provider];
  const url = new URL(request.kind === 'accounts' ? ACCOUNT_URL : provider.url);
  if (request.kind === 'accounts') url.searchParams.set('game_biz', provider.business);
  else {
    url.searchParams.set('role_id', request.uid);
    url.searchParams.set('server', request.server);
  }
  return { ok: true, url: url.href, headers: { ...headers } };
}
function providerOf(url) {
  const parsed = new URL(url);
  return Object.keys(PROVIDERS).find(
    (key) => parsed.searchParams.get('game_biz') === PROVIDERS[key].business || url.startsWith(PROVIDERS[key].url),
  );
}
function make(options = {}) {
  const published = [];
  const sendNative = vi.fn(async (message) => {
    if (options.native) return options.native(message);
    if (message.action === 'publish') {
      published.push(message.snapshot);
      return { ok: true, receivedAt: NOW, accounts: message.snapshot.accounts.length };
    }
    return signed(message);
  });
  const fetcher = vi.fn(async (url, init) => {
    if (options.fetcher) return options.fetcher(url, init);
    const provider = providerOf(url);
    if (url.startsWith(ACCOUNT_URL))
      return response({ list: [{ game_uid: '712345678', region: SERVERS[provider], nickname: 'Player' }] });
    return response(NOTES[provider]);
  });
  return {
    published,
    sendNative,
    fetcher,
    connector: createConnector({
      sendNative,
      fetcher,
      now: options.now ?? (() => NOW),
      timeoutMs: options.timeoutMs ?? 15000,
    }),
  };
}
const oldAccount = (provider = 'genshin') => ({
  provider,
  uid: '712345678',
  server: SERVERS[provider],
  nickname: 'Before',
  reading: { observedAt: NOW - 60_000, data: NOTES[provider] },
});
afterEach(() => {
  vi.useRealTimers();
});

describe('browser-owned HoYoLAB readings', () => {
  it('reads all three games and publishes exactly one credential-free snapshot', async () => {
    const fixture = make();
    const result = await fixture.connector.refresh();
    expect(result.errors).toEqual({});
    expect(result.snapshot.accounts.map((entry) => entry.provider)).toEqual(['genshin', 'hsr', 'zzz']);
    expect(fixture.published).toEqual([result.snapshot]);
    expect(fixture.fetcher).toHaveBeenCalledTimes(6);
    for (const [, init] of fixture.fetcher.mock.calls) {
      expect(init).toMatchObject({ credentials: 'include', redirect: 'error', cache: 'no-store', method: 'GET' });
      expect(Object.keys(init.headers).sort()).toEqual([
        'ds',
        'x-rpc-app_version',
        'x-rpc-client_type',
        'x-rpc-lang',
        'x-rpc-language',
      ]);
      expect(init.signal).toBeInstanceOf(AbortSignal);
    }
    expect(fixture.sendNative.mock.calls.every(([message]) => !Object.hasOwn(message, 'cookie'))).toBe(true);
  });

  it('removes unknown and credential-shaped publisher fields before publication', async () => {
    const fixture = make({
      fetcher: async (url) =>
        url.startsWith(ACCOUNT_URL)
          ? response({
              list: [
                { game_uid: '712345678', region: SERVERS[providerOf(url)], nickname: 'Player\nname', cookie: 'secret' },
              ],
            })
          : response({
              ...NOTES[providerOf(url)],
              cookie: 'secret',
              account_token: 'secret',
              extra: { password: 'secret' },
            }),
    });
    const { snapshot } = await fixture.connector.refresh();
    expect(JSON.stringify(snapshot)).not.toContain('secret');
    expect(snapshot.accounts[0].nickname).toBe('Playername');
    expect(snapshot.accounts[0].reading.data).toEqual(NOTES.genshin);
  });

  it('records the observation time before the notes request starts', async () => {
    let clock = NOW;
    const fixture = make({
      now: () => clock,
      fetcher: async (url) => {
        const provider = providerOf(url);
        if (url.startsWith(ACCOUNT_URL))
          return response({ list: provider === 'genshin' ? [{ game_uid: '712345678', region: SERVERS.genshin }] : [] });
        clock += 2000;
        return response(NOTES.genshin);
      },
    });
    const { snapshot } = await fixture.connector.refresh();
    expect(snapshot.accounts[0].reading.observedAt).toBe(NOW);
    expect(snapshot.fetchedAt).toBe(NOW + 2000);
  });

  it('keeps old readings and their observation time after a partial notes failure', async () => {
    const fixture = make({
      fetcher: async (url) => {
        const provider = providerOf(url);
        if (url.startsWith(ACCOUNT_URL))
          return response({ list: [{ game_uid: '712345678', region: SERVERS[provider] }] });
        return provider === 'genshin'
          ? new Response(JSON.stringify({ retcode: 1034, message: 'private-token-echo' }))
          : response(NOTES[provider]);
      },
    });
    const { snapshot, errors } = await fixture.connector.refresh({ accounts: [oldAccount()] });
    expect(snapshot.accounts[0].reading).toEqual(oldAccount().reading);
    expect(snapshot.accounts[0].error).toBe(MESSAGES.verification);
    expect(snapshot.accounts[1].reading.observedAt).toBe(NOW);
    expect(errors).toEqual({ genshin: MESSAGES.verification });
    expect(JSON.stringify(snapshot)).not.toContain('private-token-echo');
  });

  it('keeps the known account on discovery failure and does not fetch its notes', async () => {
    const fixture = make({
      fetcher: async (url) =>
        providerOf(url) === 'genshin' ? new Response(JSON.stringify({ retcode: -100 })) : response({ list: [] }),
    });
    const { snapshot, errors } = await fixture.connector.refresh({ accounts: [oldAccount()] });
    expect(snapshot.accounts).toEqual([{ ...oldAccount(), error: MESSAGES.login }]);
    expect(errors.genshin).toBe(MESSAGES.login);
    expect(fixture.fetcher).toHaveBeenCalledTimes(3);
  });

  it('removes previously linked accounts when successful discovery no longer returns them', async () => {
    const fixture = make({ fetcher: async () => response({ list: [] }) });
    const { snapshot } = await fixture.connector.refresh({ accounts: [oldAccount()] });
    expect(snapshot.accounts).toEqual([]);
    expect(fixture.published).toHaveLength(1);
  });

  it('never publishes more than thirty accounts across all providers', async () => {
    const fixture = make({
      fetcher: async (url) => {
        const provider = providerOf(url);
        if (url.startsWith(ACCOUNT_URL))
          return response({
            list: Array.from({ length: 40 }, (_, index) => ({
              game_uid: String(712345678 + index),
              region: SERVERS[provider],
            })),
          });
        return response(NOTES[provider]);
      },
    });
    const { snapshot } = await fixture.connector.refresh();
    expect(snapshot.accounts).toHaveLength(30);
    expect(fixture.fetcher).toHaveBeenCalledTimes(33);
  });

  it('coalesces manual and scheduled reads without a second publication', async () => {
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const fixture = make({
      native: async (message) => {
        if (message.action === 'headers') {
          await gate;
          return signed(message);
        }
        return { ok: true };
      },
    });
    const first = fixture.connector.refresh();
    const second = fixture.connector.refresh({ accounts: [oldAccount()] });
    expect(second).toBe(first);
    release();
    await Promise.all([first, second]);
    expect(fixture.sendNative.mock.calls.filter(([message]) => message.action === 'publish')).toHaveLength(1);
    await fixture.connector.refresh();
    expect(fixture.sendNative.mock.calls.filter(([message]) => message.action === 'publish')).toHaveLength(2);
  });

  it('does not publish an incomplete snapshot if the native helper goes away', async () => {
    let calls = 0;
    const fixture = make({
      native: async (message) => {
        calls += 1;
        if (calls === 3) throw new Error('secret native diagnostics');
        return message.action === 'headers' ? signed(message) : { ok: true };
      },
    });
    await expect(fixture.connector.refresh()).rejects.toThrow(MESSAGES.host);
    expect(fixture.sendNative.mock.calls.some(([message]) => message.action === 'publish')).toBe(false);
  });

  it.each([
    ['bad JSON', new Response('{')],
    ['array response', new Response('[]')],
    ['missing retcode', new Response('{"data":{}}')],
    ['missing account list', response({})],
    ['oversize header', new Response('{}', { headers: { 'content-length': '1000001' } })],
    ['oversize body', new Response('x'.repeat(1_000_001))],
  ])('shows bounded errors for %s without losing prior readings', async (_, payload) => {
    const fixture = make({
      fetcher: async (url) => (providerOf(url) === 'genshin' ? payload : response({ list: [] })),
    });
    const result = await fixture.connector.refresh({ accounts: [oldAccount()] });
    expect(result.errors.genshin).toBe(MESSAGES.response);
    expect(result.snapshot.accounts[0].reading.observedAt).toBe(NOW - 60_000);
  });

  it('maps HTTP rate limits separately from an offline request', async () => {
    const fixture = make({
      fetcher: async (url) =>
        providerOf(url) === 'genshin' ? new Response('', { status: 429 }) : response({ list: [] }),
    });
    expect((await fixture.connector.refresh()).errors.genshin).toBe(MESSAGES.wait);
  });

  it('bounds a stuck fetch and aborts its request', async () => {
    vi.useFakeTimers();
    let signal;
    const fixture = make({
      timeoutMs: 20,
      fetcher: (url, init) => {
        if (providerOf(url) === 'genshin') {
          signal = init.signal;
          return new Promise(() => {});
        }
        return response({ list: [] });
      },
    });
    const pending = fixture.connector.refresh();
    await vi.advanceTimersByTimeAsync(21);
    const result = await pending;
    expect(signal.aborted).toBe(true);
    expect(result.errors.genshin).toBe(MESSAGES.network);
  });

  it('bounds a stuck native request', async () => {
    vi.useFakeTimers();
    const fixture = make({ timeoutMs: 20, native: () => new Promise(() => {}) });
    const pending = expect(fixture.connector.refresh()).rejects.toThrow(MESSAGES.host);
    await vi.advanceTimersByTimeAsync(21);
    await pending;
    expect(fixture.fetcher).not.toHaveBeenCalled();
  });

  it('rejects empty or malformed notes while retaining the previous observation', async () => {
    const fixture = make({
      fetcher: async (url) =>
        url.startsWith(ACCOUNT_URL)
          ? response({
              list: providerOf(url) === 'genshin' ? [{ game_uid: '712345678', region: SERVERS.genshin }] : [],
            })
          : response({ current_resin: '123', session: 'not-a-reading' }),
    });
    const result = await fixture.connector.refresh({ accounts: [oldAccount()] });
    expect(result.snapshot.accounts[0].reading).toEqual(oldAccount().reading);
    expect(result.snapshot.accounts[0].error).toBe(MESSAGES.response);
  });
});

describe('narrow browser request and publisher validation', () => {
  const request = { provider: 'genshin', kind: 'notes', uid: '712345678', server: 'os_euro' };
  it('accepts the real native helper signature for every supported request', () => {
    for (const provider of Object.keys(PROVIDERS)) {
      for (const kind of ['accounts', 'notes']) {
        const input = { provider, kind, uid: '712345678', server: SERVERS[provider] };
        const result = browserRequestHeaders(input, NOW);
        expect(validateRequest(input, result).url).toBe(signed(input).url);
      }
    }
  });
  it.each([
    [
      'remote origin',
      (value) => {
        value.url = 'https://example.com/';
      },
    ],
    [
      'HTTP origin',
      (value) => {
        value.url = value.url.replace('https:', 'http:');
      },
    ],
    [
      'credentials',
      (value) => {
        value.url = value.url.replace('https://', 'https://user:pass@');
      },
    ],
    [
      'fragment',
      (value) => {
        value.url += '#private';
      },
    ],
    [
      'wrong UID',
      (value) => {
        value.url = value.url.replace('712345678', '712345679');
      },
    ],
    [
      'duplicate query',
      (value) => {
        value.url += '&server=os_euro';
      },
    ],
    [
      'unknown query',
      (value) => {
        value.url += '&token=secret';
      },
    ],
    [
      'cookie header',
      (value) => {
        value.headers.Cookie = 'private';
      },
    ],
    [
      'authorization header',
      (value) => {
        value.headers.Authorization = 'private';
      },
    ],
    [
      'referer header',
      (value) => {
        value.headers.Referer = 'https://act.hoyolab.com/';
      },
    ],
    [
      'modified public header',
      (value) => {
        value.headers['x-rpc-client_type'] = '99';
      },
    ],
    [
      'malformed DS',
      (value) => {
        value.headers.DS = 'private';
      },
    ],
    [
      'duplicate DS casing',
      (value) => {
        value.headers.ds = value.headers.DS;
      },
    ],
    [
      'missing DS',
      (value) => {
        delete value.headers.DS;
      },
    ],
  ])('rejects %s before sending any browser credentials', (_, mutate) => {
    const value = signed(request);
    mutate(value);
    expect(() => validateRequest(request, value)).toThrow(MESSAGES.contract);
  });

  it('canonicalizes equivalent safe query order for its fixed DNR rules', () => {
    const value = signed(request);
    value.url = `${PROVIDERS.genshin.url}?server=os_euro&role_id=712345678`;
    expect(validateRequest(request, value).url).toBe(signed(request).url);
  });

  it('rejects unsupported provider names and numeric UIDs', () => {
    expect(() => validateRequest({ ...request, provider: 'constructor' }, {})).toThrow(MESSAGES.contract);
    expect(() => validateRequest({ ...request, uid: 712345678 }, signed(request))).toThrow(MESSAGES.contract);
  });

  it('deduplicates validated account identity and cleans nicknames', () => {
    expect(
      discoverAccounts('genshin', {
        list: [
          { game_uid: '712345678', region: 'os_euro', nickname: 'a\nb' },
          { game_uid: '712345678', region: 'os_euro', nickname: 'duplicate' },
          { game_uid: 712345678, region: 'os_euro' },
          { game_uid: 'bad', region: 'os_euro' },
          { game_uid: '712345679', region: 'prod_gf_eu' },
        ],
      }),
    ).toEqual([{ provider: 'genshin', uid: '712345678', server: 'os_euro', nickname: 'ab' }]);
  });

  it('filters nested aliases and invalid numeric values', () => {
    expect(
      readingData('genshin', {
        current_resin: -1,
        current_home_coin: Infinity,
        daily_task: { finished_num: 4, total_num: 4, claimed_commission_reward: true, cookie: 'secret' },
      }),
    ).toEqual({ daily_task: { finished_num: 4, total_num: 4, claimed_commission_reward: true } });
    expect(
      readingData('zzz', {
        battery_charge: { current: 100, token: 'secret' },
        engagement: { current: 400, max: 400, extra: [] },
      }),
    ).toEqual({ battery_charge: { current: 100 }, engagement: { current: 400, max: 400 } });
  });

  it('pins the stable extension ID and declares only four hosts and narrow permissions', () => {
    const manifest = JSON.parse(
      readFileSync(new URL('../../browser-extension/manifest.json', import.meta.url), 'utf8'),
    );
    const identity = JSON.parse(
      readFileSync(new URL('../../browser-extension/identity.json', import.meta.url), 'utf8'),
    );
    const id = createHash('sha256')
      .update(Buffer.from(manifest.key, 'base64'))
      .digest('hex')
      .slice(0, 32)
      .replace(/[0-9a-f]/g, (letter) => String.fromCharCode(97 + Number.parseInt(letter, 16)));
    expect(id).toBe(identity.id);
    expect(manifest.key).toBe(identity.key);
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.permissions.sort()).toEqual([
      'alarms',
      'declarativeNetRequestWithHostAccess',
      'nativeMessaging',
      'storage',
    ]);
    expect(manifest.host_permissions).toHaveLength(4);
    expect(manifest.content_scripts).toBeUndefined();
    expect(manifest.externally_connectable).toBeUndefined();
    for (const host of manifest.host_permissions)
      expect(new URL(host).hostname).toMatch(
        /^(api-account-os|sg-public-api|bbs-api-os|sg-act-public-api)\.hoyolab\.com$/,
      );
  });

  it('scopes the Referer modification to our initiator and exact API query shapes', () => {
    const rules = JSON.parse(readFileSync(new URL('../../browser-extension/rules.json', import.meta.url), 'utf8'));
    expect(rules).toHaveLength(4);
    for (const rule of rules) {
      expect(rule.condition.initiatorDomains).toEqual(['fonifgaeglmfmakjocdjembgclppgcfe']);
      expect(rule.condition.resourceTypes).toEqual(['xmlhttprequest']);
      expect(rule.action).toEqual({
        type: 'modifyHeaders',
        requestHeaders: [{ header: 'Referer', operation: 'set', value: 'https://act.hoyolab.com/' }],
      });
      const matches = new RegExp(rule.condition.regexFilter);
      expect(matches.test('https://www.hoyolab.com/')).toBe(false);
      expect(matches.test(`${signed(request).url}&token=secret`)).toBe(false);
      expect(
        matches.test(
          'https://sg-public-api.hoyolab.com.attacker.example/event/game_record/genshin/api/dailyNote?role_id=712345678&server=os_euro',
        ),
      ).toBe(false);
    }
    for (const provider of Object.keys(PROVIDERS)) {
      for (const kind of ['accounts', 'notes']) {
        const url = signed({ provider, kind, uid: '712345678', server: SERVERS[provider] }).url;
        expect(rules.filter((rule) => new RegExp(rule.condition.regexFilter).test(url))).toHaveLength(1);
      }
    }
  });
});

function browserMock(stored = {}, native) {
  const data = { ...stored };
  const alarms = new Map();
  const browser = {
    runtime: {
      sendNativeMessage: vi.fn((host, message, reply) =>
        Promise.resolve(native ? native(message) : message.action === 'headers' ? signed(message) : { ok: true }).then(
          reply,
        ),
      ),
    },
    storage: {
      local: {
        get: vi.fn(async (keys) =>
          Object.fromEntries(
            (Array.isArray(keys) ? keys : [keys])
              .filter((key) => Object.hasOwn(data, key))
              .map((key) => [key, data[key]]),
          ),
        ),
        set: vi.fn(async (values) => {
          Object.assign(data, values);
        }),
      },
    },
    alarms: {
      get: vi.fn(async (name) => alarms.get(name)),
      create: vi.fn(async (name, options) => {
        alarms.set(name, { name, ...options });
      }),
      clear: vi.fn(async (name) => alarms.delete(name)),
    },
  };
  return { browser, data, alarms };
}

describe('five-minute browser worker', () => {
  it('starts with automatic readings off and requires explicit opt-in', async () => {
    const fixture = browserMock();
    const worker = createWorker(fixture.browser);
    await worker.restoreAlarm();
    expect(fixture.browser.alarms.create).not.toHaveBeenCalled();
    expect((await worker.status()).automatic).toBe(false);
    await worker.configure(true);
    expect(fixture.alarms.get(ALARM)).toMatchObject({ periodInMinutes: 5, delayInMinutes: 5 });
    await worker.configure(false);
    expect(fixture.alarms.has(ALARM)).toBe(false);
    expect(fixture.data.automatic).toBe(false);
  });

  it('restores a missing opted-in alarm without postponing an existing one', async () => {
    const fixture = browserMock({ automatic: true });
    const worker = createWorker(fixture.browser);
    await worker.restoreAlarm();
    await worker.restoreAlarm();
    expect(fixture.browser.alarms.create).toHaveBeenCalledTimes(1);
  });

  it('ignores unrelated alarms and disabled automatic readings', async () => {
    const fixture = browserMock();
    const worker = createWorker(fixture.browser);
    await worker.alarm({ name: ALARM });
    await worker.alarm({ name: 'other' });
    expect(fixture.browser.runtime.sendNativeMessage).not.toHaveBeenCalled();
    expect((await worker.configure('true')).ok).toBe(false);
    expect(fixture.data.automatic).toBeUndefined();
  });

  it('coalesces a manual read with an opted-in alarm and saves only readings', async () => {
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const fixture = browserMock({ automatic: true });
    const worker = createWorker(fixture.browser, {
      now: () => NOW,
      fetcher: async (url) => {
        await gate;
        const provider = providerOf(url);
        return url.startsWith(ACCOUNT_URL)
          ? response({ list: [{ game_uid: '712345678', region: SERVERS[provider] }] })
          : response(NOTES[provider]);
      },
    });
    const first = worker.read();
    const second = worker.read();
    const alarm = worker.alarm({ name: ALARM });
    expect(second).toBe(first);
    expect((await worker.status()).busy).toBe(true);
    release();
    await Promise.all([first, second, alarm]);
    expect(
      fixture.browser.runtime.sendNativeMessage.mock.calls.filter(([, message]) => message.action === 'publish'),
    ).toHaveLength(1);
    expect(fixture.data.checkedAt).toBe(NOW);
    expect((await worker.status()).busy).toBe(false);
    expect(Object.keys(fixture.data).sort()).toEqual(['automatic', 'checkedAt', 'errors', 'lastError', 'snapshot']);
  });

  it('keeps the prior snapshot when publication fails and surfaces recovery', async () => {
    const previous = { version: 1, fetchedAt: NOW - 60_000, accounts: [oldAccount()] };
    const fixture = browserMock({ snapshot: previous, checkedAt: NOW - 60_000 }, (message) =>
      message.action === 'headers' ? signed(message) : { ok: false, error: 'private diagnostics' },
    );
    const worker = createWorker(fixture.browser, { now: () => NOW, fetcher: async () => response({ list: [] }) });
    expect(await worker.read()).toEqual({ ok: false, error: MESSAGES.publish });
    expect(fixture.data.snapshot).toBe(previous);
    expect(fixture.data.checkedAt).toBe(NOW - 60_000);
    expect(fixture.data.lastError).toBe(MESSAGES.publish);
    expect(JSON.stringify(await worker.status())).not.toContain('private diagnostics');
  });
});
