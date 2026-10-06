import { createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Community HoYoLAB protocol. Endpoint references:
// https://github.com/seriaati/genshin.py/blob/master/genshin/client/routes.py
const PROVIDERS = {
  genshin: {
    url: 'https://sg-public-api.hoyolab.com/event/game_record/genshin/api/dailyNote',
    servers: ['os_euro', 'os_usa', 'os_asia', 'os_cht'],
  },
  hsr: {
    url: 'https://bbs-api-os.hoyolab.com/game_record/hkrpg/api/note',
    servers: ['prod_official_eur', 'prod_official_usa', 'prod_official_asia', 'prod_official_cht'],
  },
  zzz: {
    url: 'https://sg-act-public-api.hoyolab.com/event/game_record_zzz/api/zzz/note',
    servers: ['prod_gf_eu', 'prod_gf_us', 'prod_gf_jp', 'prod_gf_sg'],
  },
};
const fail = (message, status = 400) => Object.assign(new Error(message), { status });

/** Windows protects these credentials for the current OS user. Nothing goes into state.json. */
function protect(value, decrypt = false) {
  if (process.platform !== 'win32') throw fail('Account connections require the Windows launcher.', 503);
  const operation = decrypt ? 'Unprotect' : 'Protect';
  const input = decrypt ? '[Convert]::FromBase64String($value)' : '[Text.Encoding]::UTF8.GetBytes($value)';
  const output = decrypt ? '[Text.Encoding]::UTF8.GetString($bytes)' : '[Convert]::ToBase64String($bytes)';
  const script = `Add-Type -AssemblyName System.Security; $value=[Console]::In.ReadToEnd(); $bytes=[Security.Cryptography.ProtectedData]::${operation}(${input},$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write(${output})`;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    input: value,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 10000,
    // Thirty supported 16 KB sessions can produce over 600 KB of protected Base64.
    maxBuffer: 1000000,
  });
  if (result.status !== 0 || !result.stdout)
    throw fail('Windows could not open the protected connection. Reconnect this account.', 503);
  return result.stdout.trim();
}

function validateConnection(input) {
  if (!input || typeof input !== 'object') throw fail('Choose a game account.');
  const { gameId, provider, uid, server, cookie } = input;
  if (typeof gameId !== 'string' || !/^[\w-]{1,100}$/.test(gameId)) throw fail('Invalid game identifier.');
  if (!Object.hasOwn(PROVIDERS, provider) || !PROVIDERS[provider].servers.includes(server))
    throw fail('Choose a supported game and server.');
  if (typeof uid !== 'string' || !/^\d{8,12}$/.test(uid)) throw fail('Enter the in-game UID, using 8 to 12 digits.');
  if (
    typeof cookie !== 'string' ||
    cookie.length > 16000 ||
    [...cookie].some((character) => character.charCodeAt(0) < 32)
  )
    throw fail('Enter a valid HoYoLAB session cookie.');
  const allowed = new Set([
    'ltoken',
    'ltoken_v2',
    'ltuid',
    'ltuid_v2',
    'ltmid_v2',
    'cookie_token',
    'cookie_token_v2',
    'account_id',
    'account_id_v2',
    'account_mid_v2',
  ]);
  const pairs = cookie
    .split(';')
    .map((part) => part.trim())
    .filter((part) => allowed.has(part.split('=')[0]));
  if (!pairs.some((part) => /^ltoken(?:_v2)?=.+/.test(part)) || !pairs.some((part) => /^ltuid(?:_v2)?=\d+$/.test(part)))
    throw fail('The session needs ltoken and ltuid (or their v2 values). Sign in to HoYoLAB again.');
  return { gameId, provider, uid, server, cookie: pairs.join('; '), autoRefresh: input.autoRefresh === true };
}

export async function fetchGameNotes(connection, fetcher = fetch) {
  const entry = validateConnection(connection);
  const observedAt = Date.now();
  const url = new URL(PROVIDERS[entry.provider].url);
  url.searchParams.set('role_id', entry.uid);
  url.searchParams.set('server', entry.server);
  const timestamp = Math.floor(observedAt / 1000);
  const letters = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const nonce = [...randomBytes(6)].map((value) => letters[value % letters.length]).join('');
  const digest = createHash('md5')
    .update(`salt=6s25p5ox5y14umn1p61aqyyvbvvl3lrt&t=${timestamp}&r=${nonce}`)
    .digest('hex');
  let response;
  try {
    response = await fetcher(url, {
      headers: {
        Cookie: entry.cookie,
        Referer: 'https://act.hoyolab.com/',
        'x-rpc-app_version': '1.5.0',
        'x-rpc-client_type': '5',
        'x-rpc-language': 'en-us',
        'x-rpc-lang': 'en-us',
        DS: `${timestamp},${nonce},${digest}`,
        'User-Agent': 'Memoria/2.0',
      },
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw fail('HoYoLAB could not be reached. Your saved readings are unchanged.', 502);
  }
  if (!response.ok)
    throw fail(
      response.status === 429
        ? 'HoYoLAB asked us to wait. Try again later.'
        : 'HoYoLAB is unavailable. Try again later.',
      502,
    );
  const chunks = [];
  let bytes = 0;
  if (response.body) {
    for await (const chunk of response.body) {
      bytes += chunk.byteLength;
      if (bytes > 1000000) throw fail('The account response was too large.', 502);
      chunks.push(Buffer.from(chunk));
    }
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw fail('HoYoLAB returned an unreadable response.', 502);
  }
  if (payload.retcode !== 0) {
    if ([10035, 5003, 10041, 1034].includes(payload.retcode))
      throw fail('Open HoYoLAB and complete its verification, then refresh again.', 409);
    if ([10102, 10103].includes(payload.retcode))
      throw fail('Enable Real-Time Notes in your HoYoLAB Battle Chronicle, then retry.', 409);
    throw fail('HoYoLAB rejected this session or account. Check the UID and server, then reconnect.', 409);
  }
  if (!payload.data || typeof payload.data !== 'object' || Array.isArray(payload.data))
    throw fail('HoYoLAB returned no readings.', 502);
  return { gameId: entry.gameId, provider: entry.provider, uid: entry.uid, observedAt, data: payload.data };
}

export function createGameConnections({
  directory,
  fetcher = fetch,
  seal = protect,
  unseal = (value) => protect(value, true),
}) {
  const file = join(directory, 'game-connections.protected');
  const cache = new Map();
  const pending = new Map();
  const generations = new Map();
  let entries;
  function invalidate(gameId) {
    const generation = (generations.get(gameId) ?? 0) + 1;
    generations.set(gameId, generation);
    cache.delete(gameId);
    pending.delete(gameId);
    return generation;
  }
  function unchanged(entry, generation) {
    const current = load().find((item) => item.gameId === entry.gameId);
    return (
      (generations.get(entry.gameId) ?? 0) === generation &&
      current &&
      ['provider', 'uid', 'server', 'cookie'].every((field) => current[field] === entry[field])
    );
  }
  function load() {
    if (entries) return entries;
    try {
      const stored = JSON.parse(unseal(readFileSync(file, 'utf8')));
      if (!Array.isArray(stored) || stored.length > 30) throw new Error('Invalid connections');
      entries = stored.map(validateConnection);
    } catch (error) {
      if (error.code === 'ENOENT') entries = [];
      else throw fail('Saved game connections could not be opened. Your game data is unchanged.', 503);
    }
    return entries;
  }
  function save(next) {
    mkdirSync(directory, { recursive: true });
    writeFileSync(`${file}.tmp`, seal(JSON.stringify(next)), { mode: 0o600 });
    renameSync(`${file}.tmp`, file);
    entries = next;
  }
  function status() {
    return {
      connections: load().map((entry) => ({
        gameId: entry.gameId,
        provider: entry.provider,
        uid: entry.uid,
        server: entry.server,
        autoRefresh: entry.autoRefresh,
        lastCheckedAt: cache.get(entry.gameId)?.observedAt ?? null,
      })),
    };
  }
  async function refresh(entry) {
    const cached = cache.get(entry.gameId);
    if (cached && Date.now() - cached.observedAt < 60000) return cached;
    if (pending.has(entry.gameId)) return pending.get(entry.gameId);
    const generation = generations.get(entry.gameId) ?? 0;
    const request = fetchGameNotes(entry, fetcher)
      .then((result) => {
        if (!unchanged(entry, generation)) throw fail('The account connection changed. Refresh again.', 409);
        cache.set(entry.gameId, result);
        return result;
      })
      .finally(() => {
        if (pending.get(entry.gameId) === request) pending.delete(entry.gameId);
      });
    pending.set(entry.gameId, request);
    return request;
  }
  return {
    status,
    async control(input) {
      const list = load();
      if (input?.action === 'connect') {
        const entry = validateConnection(input);
        if (list.length >= 30 && !list.some((item) => item.gameId === entry.gameId))
          throw fail('The connection limit is 30 accounts.');
        const generation = invalidate(entry.gameId);
        const result = await fetchGameNotes(entry, fetcher);
        if (generations.get(entry.gameId) !== generation)
          throw fail('The account connection changed. Connect again if needed.', 409);
        const current = load().filter((item) => item.gameId !== entry.gameId);
        if (current.length >= 30) throw fail('The connection limit is 30 accounts.');
        save([...current, entry]);
        // A refresh of the previous connection could have started during this check.
        invalidate(entry.gameId);
        cache.set(entry.gameId, result);
        return { ...status(), reading: result };
      }
      if (input?.action === 'disconnect') {
        if (typeof input.gameId !== 'string' || !/^[\w-]{1,100}$/.test(input.gameId))
          throw fail('Invalid game identifier.');
        const next = list.filter((item) => item.gameId !== input.gameId);
        if (next.length !== list.length) save(next);
        invalidate(input.gameId);
        return status();
      }
      const entry = list.find((item) => item.gameId === input?.gameId);
      if (!entry) throw fail('Connect this game account first.', 404);
      if (input.action === 'configure') {
        save(list.map((item) => (item === entry ? { ...entry, autoRefresh: input.autoRefresh === true } : item)));
        return status();
      }
      if (input.action === 'refresh') return { reading: await refresh(entry) };
      throw fail('Unknown connection action.');
    },
  };
}
