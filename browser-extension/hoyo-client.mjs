// This module handles publisher data only. Browser credentials never leave fetch().
export const HOST = 'app.memoria.browser';
export const PROVIDERS = {
  genshin: {
    name: 'Genshin Impact',
    business: 'hk4e_global',
    url: 'https://sg-public-api.hoyolab.com/event/game_record/genshin/api/dailyNote',
    servers: ['os_euro', 'os_usa', 'os_asia', 'os_cht'],
  },
  hsr: {
    name: 'Honkai: Star Rail',
    business: 'hkrpg_global',
    url: 'https://bbs-api-os.hoyolab.com/game_record/hkrpg/api/note',
    servers: ['prod_official_eur', 'prod_official_usa', 'prod_official_asia', 'prod_official_cht'],
  },
  zzz: {
    name: 'Zenless Zone Zero',
    business: 'nap_global',
    url: 'https://sg-act-public-api.hoyolab.com/event/game_record_zzz/api/zzz/note',
    servers: ['prod_gf_eu', 'prod_gf_us', 'prod_gf_jp', 'prod_gf_sg'],
  },
};

const ACCOUNT_URL = 'https://api-account-os.hoyolab.com/binding/api/getUserGameRolesByCookie';
const MAX_BYTES = 1_000_000;
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const accountKey = (account) => `${account.provider}:${account.uid}:${account.server}`;
const safeName = (value) =>
  typeof value === 'string'
    ? [...value]
        .filter((letter) => letter.charCodeAt(0) >= 32 && letter.charCodeAt(0) !== 127)
        .join('')
        .slice(0, 100)
    : '';
export const MESSAGES = {
  host: 'Open Memoria and select Set up browser connector. Then read accounts again.',
  network: 'HoYoLAB could not be reached. Check your connection, then read accounts again.',
  login: 'Sign in at HoYoLAB in this browser, then read accounts again.',
  verification: 'Open HoYoLAB and complete its verification, then read accounts again.',
  notes: 'Enable Real-Time Notes in HoYoLAB Battle Chronicle, then read accounts again.',
  wait: 'HoYoLAB asked us to wait. Read accounts again later.',
  response: 'HoYoLAB returned an unreadable response. Read accounts again later.',
  contract: 'The browser connector needs an update. Update Memoria and reload the extension.',
  publish: 'Readings could not reach Memoria. Open Memoria, then read accounts again.',
};
const failure = (kind) => Object.assign(new Error(MESSAGES[kind]), { kind });

/** The native helper may sign requests, but cannot turn this into an arbitrary fetch. */
export function validateRequest(request, response) {
  const provider = Object.hasOwn(PROVIDERS, request.provider) ? PROVIDERS[request.provider] : undefined;
  if (!provider || !['accounts', 'notes'].includes(request.kind)) throw failure('contract');
  const expected = new URL(request.kind === 'accounts' ? ACCOUNT_URL : provider.url);
  if (request.kind === 'accounts') expected.searchParams.set('game_biz', provider.business);
  else {
    if (
      typeof request.uid !== 'string' ||
      !/^\d{8,12}$/.test(request.uid) ||
      !provider.servers.includes(request.server)
    )
      throw failure('contract');
    expected.searchParams.set('role_id', request.uid);
    expected.searchParams.set('server', request.server);
  }
  if (!object(response) || response.ok !== true || typeof response.url !== 'string') throw failure('contract');
  let actual;
  try {
    actual = new URL(response.url);
  } catch {
    throw failure('contract');
  }
  if (
    actual.origin !== expected.origin ||
    actual.pathname !== expected.pathname ||
    actual.username ||
    actual.password ||
    actual.hash ||
    [...actual.searchParams].length !== [...expected.searchParams].length ||
    [...expected.searchParams].some(([key, value]) => actual.searchParams.get(key) !== value)
  )
    throw failure('contract');
  const fixed = {
    'x-rpc-app_version': '1.5.0',
    'x-rpc-client_type': '5',
    'x-rpc-language': 'en-us',
    'x-rpc-lang': 'en-us',
  };
  if (!object(response.headers)) throw failure('contract');
  const headers = {};
  for (const [key, value] of Object.entries(response.headers)) {
    const lower = key.toLowerCase();
    if (lower === 'ds') {
      if (typeof value !== 'string' || !/^\d{9,12},[a-zA-Z0-9]{6},[a-f0-9]{32}$/.test(value)) throw failure('contract');
    } else if (!Object.hasOwn(fixed, lower) || value !== fixed[lower]) throw failure('contract');
    if (Object.hasOwn(headers, lower)) throw failure('contract');
    headers[lower] = value;
  }
  if (!headers.ds || Object.keys(fixed).some((key) => headers[key] !== fixed[key])) throw failure('contract');
  return { url: expected.href, headers };
}

/** Keep only fields consumed by shared/mapHoYoNotes, never arbitrary API objects. */
export function readingData(provider, data) {
  if (!object(data)) throw failure('response');
  const result = {};
  const copy = (source, target, integers, booleans = []) => {
    if (!object(source)) return;
    for (const key of integers) {
      const value = source[key];
      if (Number.isSafeInteger(value) && value >= 0) target[key] = value;
    }
    for (const key of booleans) if (typeof source[key] === 'boolean') target[key] = source[key];
  };
  if (provider === 'genshin') {
    copy(
      data,
      result,
      [
        'current_resin',
        'current_home_coin',
        'current_realm_currency',
        'finished_task_num',
        'completed_commissions',
        'total_task_num',
        'max_commissions',
      ],
      ['is_extra_task_reward_received', 'claimed_commission_reward'],
    );
    if (object(data.daily_task)) {
      const daily = {};
      copy(
        data.daily_task,
        daily,
        ['finished_num', 'completed_tasks', 'total_num', 'max_tasks'],
        ['is_extra_task_reward_received', 'claimed_commission_reward'],
      );
      if (Object.keys(daily).length) result.daily_task = daily;
    }
  } else if (provider === 'hsr') {
    copy(data, result, ['current_stamina', 'current_reserve_stamina', 'current_train_score', 'max_train_score']);
  } else if (provider === 'zzz') {
    for (const key of ['energy', 'battery_charge', 'vitality', 'engagement']) {
      if (!object(data[key])) continue;
      const target = {};
      copy(data[key], target, ['current', 'max']);
      if (['energy', 'battery_charge'].includes(key) && object(data[key].progress)) {
        const progress = {};
        copy(data[key].progress, progress, ['current', 'max']);
        if (Object.keys(progress).length) target.progress = progress;
      }
      if (Object.keys(target).length) result[key] = target;
    }
  } else throw failure('contract');
  if (!Object.keys(result).length) throw failure('response');
  return result;
}

export function discoverAccounts(provider, data) {
  if (!Object.hasOwn(PROVIDERS, provider) || !object(data) || !Array.isArray(data.list)) throw failure('response');
  const accounts = [];
  const seen = new Set();
  // Inspect a bounded list even if the publisher response contains many invalid rows.
  for (const entry of data.list.slice(0, 100)) {
    if (
      !object(entry) ||
      typeof entry.game_uid !== 'string' ||
      !/^\d{8,12}$/.test(entry.game_uid) ||
      !PROVIDERS[provider].servers.includes(entry.region)
    )
      continue;
    const account = { provider, uid: entry.game_uid, server: entry.region, nickname: safeName(entry.nickname) };
    if (seen.has(accountKey(account))) continue;
    seen.add(accountKey(account));
    accounts.push(account);
    if (accounts.length === 30) break;
  }
  return accounts;
}

async function readJson(response) {
  const length = Number(response.headers?.get('content-length'));
  if (Number.isFinite(length) && length > MAX_BYTES) throw failure('response');
  if (!response.body?.getReader) throw failure('response');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_BYTES) throw failure('response');
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    const payload = JSON.parse(text);
    if (!object(payload) || !Number.isInteger(payload.retcode)) throw failure('response');
    if ([10035, 5003, 10041, 1034].includes(payload.retcode)) throw failure('verification');
    if ([10102, 10103].includes(payload.retcode)) throw failure('notes');
    if (payload.retcode !== 0) throw failure('login');
    if (!object(payload.data)) throw failure('response');
    return payload.data;
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error?.kind ? error : failure('response');
  } finally {
    reader.releaseLock();
  }
}

/** One run is shared by manual reads and alarms. A failed read retains its original time. */
export function createConnector({ sendNative, fetcher = fetch, now = Date.now, timeoutMs = 15000 }) {
  let pending;
  const native = async (message) => {
    let timer;
    try {
      const result = await Promise.race([
        sendNative(message),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(failure('host')), timeoutMs);
        }),
      ]);
      if (!object(result) || result.ok !== true) throw failure('host');
      return result;
    } catch {
      throw failure('host');
    } finally {
      clearTimeout(timer);
    }
  };
  const request = async (provider, kind, account) => {
    const input = {
      action: 'headers',
      provider,
      kind,
      ...(account ? { uid: account.uid, server: account.server } : {}),
    };
    const signed = validateRequest(input, await native(input));
    const controller = new AbortController();
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(failure('network'));
      }, timeoutMs);
    });
    try {
      return await Promise.race([
        (async () => {
          const response = await fetcher(signed.url, {
            method: 'GET',
            headers: signed.headers,
            credentials: 'include',
            redirect: 'error',
            cache: 'no-store',
            signal: controller.signal,
          });
          if (!response?.ok) throw failure(response?.status === 429 ? 'wait' : 'network');
          return readJson(response);
        })(),
        timeout,
      ]);
    } catch (error) {
      throw error?.kind ? error : failure('network');
    } finally {
      clearTimeout(timer);
    }
  };
  const run = async (previous) => {
    const old = new Map();
    for (const account of Array.isArray(previous?.accounts) ? previous.accounts.slice(0, 30) : []) {
      if (
        !account ||
        !Object.hasOwn(PROVIDERS, account.provider) ||
        typeof account.uid !== 'string' ||
        !/^\d{8,12}$/.test(account.uid) ||
        !PROVIDERS[account.provider].servers.includes(account.server)
      )
        continue;
      const safe = {
        provider: account.provider,
        uid: account.uid,
        server: account.server,
        nickname: safeName(account.nickname),
      };
      if (
        Number.isSafeInteger(account.reading?.observedAt) &&
        account.reading.observedAt > 0 &&
        account.reading.observedAt <= now()
      ) {
        try {
          safe.reading = {
            observedAt: account.reading.observedAt,
            data: readingData(account.provider, account.reading.data),
          };
        } catch {
          /* Invalid local cache is not republished. */
        }
      }
      old.set(accountKey(safe), safe);
    }
    const accounts = [];
    const errors = {};
    for (const provider of Object.keys(PROVIDERS)) {
      let discovered;
      try {
        discovered = discoverAccounts(provider, await request(provider, 'accounts'));
      } catch (error) {
        if (error.kind === 'host' || error.kind === 'contract') throw error;
        errors[provider] = error.message;
        accounts.push(
          ...[...old.values()]
            .filter((entry) => entry.provider === provider)
            .map((entry) => ({ ...entry, error: error.message }))
            .slice(0, 30 - accounts.length),
        );
        continue;
      }
      for (const account of discovered.slice(0, 30 - accounts.length)) {
        const observedAt = now();
        try {
          const data = readingData(provider, await request(provider, 'notes', account));
          accounts.push({ ...account, reading: { observedAt, data } });
        } catch (error) {
          if (error.kind === 'host' || error.kind === 'contract') throw error;
          errors[provider] = error.message;
          accounts.push({
            ...account,
            ...(old.get(accountKey(account))?.reading ? { reading: old.get(accountKey(account)).reading } : {}),
            error: error.message,
          });
        }
      }
    }
    const snapshot = { version: 1, fetchedAt: now(), accounts };
    try {
      await native({ action: 'publish', snapshot });
    } catch {
      throw failure('publish');
    }
    return { snapshot, errors };
  };
  return {
    refresh(previous) {
      if (!pending)
        pending = run(previous).finally(() => {
          pending = undefined;
        });
      return pending;
    },
  };
}
