import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const BROWSER_ORIGIN = 'chrome-extension://fonifgaeglmfmakjocdjembgclppgcfe/';
export const BROWSER_MESSAGE_LIMIT = 1_000_000;
const STALE_READING = 'Open Chrome or Edge and read accounts again, then return to Memoria.';
const ACCOUNT_ERROR = 'HoYoLAB could not read this account. Open Chrome or Edge and read accounts again.';
const PROVIDERS = {
  genshin: {
    business: 'hk4e_global',
    url: 'https://sg-public-api.hoyolab.com/event/game_record/genshin/api/dailyNote',
    servers: ['os_euro', 'os_usa', 'os_asia', 'os_cht'],
  },
  hsr: {
    business: 'hkrpg_global',
    url: 'https://bbs-api-os.hoyolab.com/game_record/hkrpg/api/note',
    servers: ['prod_official_eur', 'prod_official_usa', 'prod_official_asia', 'prod_official_cht'],
  },
  zzz: {
    business: 'nap_global',
    url: 'https://sg-act-public-api.hoyolab.com/event/game_record_zzz/api/zzz/note',
    servers: ['prod_gf_eu', 'prod_gf_us', 'prod_gf_jp', 'prod_gf_sg'],
  },
};
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
const key = (account) => `${account.provider}:${account.uid}:${account.server}`;
function identity(input) {
  if (
    !object(input) ||
    !Object.hasOwn(PROVIDERS, input.provider) ||
    !PROVIDERS[input.provider].servers.includes(input.server) ||
    typeof input.uid !== 'string' ||
    !/^\d{8,12}$/.test(input.uid)
  )
    throw fail('Choose a supported HoYoLAB account and server.');
  return { provider: input.provider, uid: input.uid, server: input.server };
}
function timestamp(value, now) {
  if (!Number.isSafeInteger(value) || value <= 0 || value > now + 30_000)
    throw fail('The browser reading has an invalid time.');
  return value;
}
function rejectSecrets(value, depth = 0) {
  if (depth > 12) throw fail('The browser response is too complex.');
  if (!value || typeof value !== 'object') return;
  for (const [name, child] of Object.entries(value)) {
    if (/(?:cookie|token|session|password|auth|secret)/i.test(name))
      throw fail('The browser connector accepts readings only, without sign-in data.');
    rejectSecrets(child, depth + 1);
  }
}
function cleanText(value, limit) {
  return typeof value === 'string'
    ? [...value]
        .filter((letter) => letter.charCodeAt(0) >= 32 && letter.charCodeAt(0) !== 127)
        .join('')
        .slice(0, limit)
    : '';
}
function fields(source, numbers, booleans = []) {
  const result = {};
  if (!object(source)) return result;
  for (const name of numbers) if (Number.isSafeInteger(source[name]) && source[name] >= 0) result[name] = source[name];
  for (const name of booleans) if (typeof source[name] === 'boolean') result[name] = source[name];
  return result;
}
/** Keep exactly the fields consumed by shared/mapHoYoNotes. Publisher profile data stays in the browser. */
function notes(provider, data) {
  if (!object(data) || Buffer.byteLength(JSON.stringify(data)) > 100_000)
    throw fail('The browser account reading is invalid or too large.');
  if (provider === 'genshin') {
    const result = fields(
      data,
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
    if (object(data.daily_task))
      result.daily_task = fields(
        data.daily_task,
        ['finished_num', 'completed_tasks', 'total_num', 'max_tasks'],
        ['is_extra_task_reward_received', 'claimed_commission_reward'],
      );
    return result;
  }
  if (provider === 'hsr')
    return fields(data, ['current_stamina', 'current_reserve_stamina', 'current_train_score', 'max_train_score']);
  const result = {};
  for (const name of ['energy', 'battery_charge'])
    if (object(data[name])) {
      result[name] = fields(data[name], ['current']);
      if (object(data[name].progress)) result[name].progress = fields(data[name].progress, ['current']);
    }
  for (const name of ['vitality', 'engagement'])
    if (object(data[name])) result[name] = fields(data[name], ['current', 'max']);
  return result;
}
export function validateBrowserSnapshot(input, now = Date.now()) {
  if (
    !object(input) ||
    Buffer.byteLength(JSON.stringify(input)) > BROWSER_MESSAGE_LIMIT ||
    input.version !== 1 ||
    !Array.isArray(input.accounts) ||
    input.accounts.length > 30
  )
    throw fail('The browser account response is invalid or too large.');
  rejectSecrets(input);
  const fetchedAt = timestamp(input.fetchedAt, now);
  const seen = new Set();
  const accounts = input.accounts.map((value) => {
    const account = { ...identity(value), nickname: cleanText(value.nickname, 100) };
    if (seen.has(key(account))) throw fail('The browser response contains a duplicate account.');
    seen.add(key(account));
    if (value.error != null && (typeof value.error !== 'string' || value.error.length > 500))
      throw fail('The browser account error is invalid.');
    if (value.error) account.error = ACCOUNT_ERROR;
    if (value.reading != null) {
      if (!object(value.reading)) throw fail('The browser account reading is invalid.');
      const observedAt = timestamp(value.reading.observedAt, now);
      if (observedAt > fetchedAt + 30_000) throw fail('The browser reading is newer than its account check.');
      account.reading = { observedAt, data: notes(account.provider, value.reading.data) };
    }
    return account;
  });
  return { version: 1, fetchedAt, accounts };
}
function readJSON(file) {
  try {
    const info = lstatSync(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size > BROWSER_MESSAGE_LIMIT) throw new Error('invalid file');
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw fail('Saved browser connection data could not be opened. Your game data is unchanged.', 503);
  }
}
function readSnapshot(directory, now) {
  const stored = readJSON(join(directory, 'browser-readings.json'));
  if (stored == null) return undefined;
  try {
    const snapshot = validateBrowserSnapshot(stored, now);
    return { ...snapshot, receivedAt: timestamp(stored.receivedAt, now) };
  } catch {
    throw fail('Saved browser readings could not be opened. Your game data is unchanged.', 503);
  }
}
function atomicWrite(file, value) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify(value), { mode: 0o600, flag: 'wx' });
    renameSync(temporary, file);
  } finally {
    rmSync(temporary, { force: true });
  }
}
async function locked(file, action) {
  const lock = `${file}.lock`;
  const deadline = Date.now() + 5000;
  while (true) {
    try {
      mkdirSync(lock);
      writeFileSync(join(lock, 'owner.json'), JSON.stringify({ pid: process.pid }));
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw fail('Windows could not save the browser connection.', 503);
      try {
        if (Date.now() - statSync(lock).mtimeMs > 5000) {
          let dead = false;
          try {
            const owner = JSON.parse(readFileSync(join(lock, 'owner.json'), 'utf8'));
            if (!Number.isInteger(owner.pid) || owner.pid <= 0) dead = true;
            else
              try {
                process.kill(owner.pid, 0);
              } catch (probe) {
                dead = probe.code === 'ESRCH';
              }
          } catch {
            dead = true;
          }
          if (dead) {
            const stale = `${lock}.stale-${randomUUID()}`;
            renameSync(lock, stale);
            rmSync(stale, { recursive: true, force: true });
            continue;
          }
        }
      } catch {
        /* Another writer can release the lock while we inspect it. */
      }
      if (Date.now() >= deadline) throw fail('The browser connection is busy. Try again.', 503);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  try {
    return await action();
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}
export function browserRequestHeaders(input, now = Date.now()) {
  if (!object(input) || !Object.hasOwn(PROVIDERS, input.provider) || !['accounts', 'notes'].includes(input.kind))
    throw fail('Choose a supported HoYoLAB request.');
  rejectSecrets(input);
  const provider = PROVIDERS[input.provider];
  const url = new URL(
    input.kind === 'accounts'
      ? 'https://api-account-os.hoyolab.com/binding/api/getUserGameRolesByCookie'
      : provider.url,
  );
  if (input.kind === 'accounts') url.searchParams.set('game_biz', provider.business);
  else {
    const account = identity(input);
    url.searchParams.set('role_id', account.uid);
    url.searchParams.set('server', account.server);
  }
  const timestamp = Math.floor(now / 1000);
  const letters = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const nonce = [...randomBytes(6)].map((value) => letters[value % letters.length]).join('');
  const digest = createHash('md5')
    .update(`salt=6s25p5ox5y14umn1p61aqyyvbvvl3lrt&t=${timestamp}&r=${nonce}`)
    .digest('hex');
  return {
    ok: true,
    url: url.href,
    headers: {
      'x-rpc-app_version': '1.5.0',
      'x-rpc-client_type': '5',
      'x-rpc-language': 'en-us',
      'x-rpc-lang': 'en-us',
      DS: `${timestamp},${nonce},${digest}`,
    },
  };
}
export function browserSnapshotStatus(directory, now = Date.now()) {
  try {
    const snapshot = readSnapshot(directory, now);
    return { receivedAt: snapshot?.receivedAt ?? null, accounts: snapshot?.accounts.length ?? 0 };
  } catch (error) {
    return { receivedAt: null, accounts: 0, error: error.message };
  }
}
export async function publishBrowserSnapshot(directory, input, now = Date.now()) {
  const snapshot = validateBrowserSnapshot(input, now);
  mkdirSync(directory, { recursive: true });
  return locked(join(directory, 'browser-readings.json'), () => {
    let previous;
    try {
      previous = readSnapshot(directory, now);
    } catch (error) {
      // Only this optional cache may recover from a fresh, validated browser read.
      // Preserve its bytes for inspection; account bindings and game data stay intact.
      const file = join(directory, 'browser-readings.json');
      const info = lstatSync(file);
      if (!info.isFile() || info.isSymbolicLink()) throw error;
      renameSync(file, join(directory, `browser-readings.corrupt-${randomUUID()}.json`));
    }
    // A slower browser check cannot replace a newer account list or observation.
    if (previous && snapshot.fetchedAt <= previous.fetchedAt)
      return { ok: true, ...browserSnapshotStatus(directory, now) };
    if (previous)
      for (const account of snapshot.accounts) {
        const old = previous.accounts.find((value) => key(value) === key(account));
        if (old?.reading && (!account.reading || old.reading.observedAt > account.reading.observedAt))
          account.reading = old.reading;
      }
    atomicWrite(join(directory, 'browser-readings.json'), { ...snapshot, receivedAt: now });
    return { ok: true, receivedAt: now, accounts: snapshot.accounts.length };
  });
}
function binding(input) {
  if (!object(input) || typeof input.gameId !== 'string' || !/^[\w-]{1,100}$/.test(input.gameId))
    throw fail('Choose a saved game account.');
  return { gameId: input.gameId, ...identity(input), autoRefresh: input.autoRefresh === true };
}
/** Bind saved games to browser readings. This store never opens a browser cookie database. */
export function createBrowserConnections({ directory, getGames, now = Date.now }) {
  const file = join(directory, 'browser-connections.json');
  function load() {
    const stored = readJSON(file);
    if (stored == null) return [];
    try {
      if (!Array.isArray(stored) || stored.length > 30) throw new Error('invalid');
      rejectSecrets(stored);
      const result = stored.map(binding);
      if (new Set(result.map((entry) => entry.gameId)).size !== result.length) throw new Error('duplicate');
      return result;
    } catch {
      throw fail('Saved browser connections could not be opened. Your game data is unchanged.', 503);
    }
  }
  function response(list = load()) {
    let snapshot;
    try {
      snapshot = readSnapshot(directory, now());
    } catch {
      /* Optional cache errors are reported by status(), not successful metadata actions. */
    }
    return {
      connections: list.map((entry) => ({
        ...entry,
        transport: 'browser',
        lastCheckedAt: snapshot?.accounts.find((account) => key(account) === key(entry))?.reading?.observedAt ?? null,
      })),
    };
  }
  function reading(entry) {
    const account = readSnapshot(directory, now())?.accounts.find((value) => key(value) === key(entry));
    if (!account?.reading || account.error || now() - account.reading.observedAt > 15 * 60_000)
      throw fail(STALE_READING, 409);
    return { gameId: entry.gameId, provider: entry.provider, uid: entry.uid, ...account.reading };
  }
  async function game(gameId, provider, active = false) {
    const saved = (await getGames()).find((entry) => entry.id === gameId && !entry.deleted);
    if (!saved) throw fail('This saved game account is no longer available.', 404);
    if (saved.presetKey && saved.presetKey !== provider) throw fail('Choose the matching HoYoLAB game.');
    if (active && saved.paused) throw fail('Resume this game before you refresh its readings.', 409);
    return saved;
  }
  return {
    status: () => browserSnapshotStatus(directory, now()),
    async listAccounts(input) {
      if (!object(input) || !Object.hasOwn(PROVIDERS, input.provider)) throw fail('Choose a supported HoYoLAB game.');
      return {
        accounts: (readSnapshot(directory, now())?.accounts ?? [])
          .filter((entry) => entry.provider === input.provider)
          .map(({ provider, uid, server, nickname }) => ({ provider, uid, server, nickname })),
      };
    },
    async request(input) {
      if (input == null || input.action === 'status') return response();
      if (!object(input)) throw fail('Choose a browser connection action.');
      rejectSecrets(input);
      if (input.action === 'refresh') {
        const entry = load().find((value) => value.gameId === input.gameId);
        if (!entry) throw fail('Connect this game account first.', 404);
        await game(entry.gameId, entry.provider, true);
        const current = load().find((value) => value.gameId === entry.gameId);
        if (!current || key(current) !== key(entry)) throw fail('The browser connection changed. Refresh again.', 409);
        return { reading: reading(entry) };
      }
      if (!['connect', 'configure', 'disconnect'].includes(input.action))
        throw fail('Unknown browser connection action.');
      if (typeof input.gameId !== 'string' || !/^[\w-]{1,100}$/.test(input.gameId))
        throw fail('Choose a saved game account.');
      if (input.action === 'connect') await game(input.gameId, input.provider);
      mkdirSync(directory, { recursive: true });
      return locked(file, () => {
        const list = load();
        let next;
        let result;
        if (input.action === 'connect') {
          const entry = binding(input);
          result = reading(entry);
          next = [...list.filter((value) => value.gameId !== entry.gameId), entry];
          if (next.length > 30) throw fail('The connection limit is 30 accounts.');
        } else if (input.action === 'disconnect') next = list.filter((entry) => entry.gameId !== input.gameId);
        else {
          if (!list.some((entry) => entry.gameId === input.gameId)) throw fail('Connect this game account first.', 404);
          next = list.map((entry) =>
            entry.gameId === input.gameId ? { ...entry, autoRefresh: input.autoRefresh === true } : entry,
          );
        }
        // Metadata changes remain available if the optional read-only browser cache is damaged.
        const status = response(next);
        atomicWrite(file, next);
        return { ...status, ...(result ? { reading: result } : {}) };
      });
    },
  };
}
