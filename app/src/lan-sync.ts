import { assertSyncProtocol } from '@memoria/shared';
import {
  newDeviceKey,
  devicePublicKey,
  deviceFingerprint,
  lanKeys,
  sealLan,
  openLan,
  type LanPacket,
} from '@memoria/shared/lan-crypto';
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import {
  emptyState,
  mergeState,
  normalizeLanHost,
  normalizeState,
  parsePairingCode,
  safeParseAppState,
  type AppState,
} from '@memoria/shared';
import { create } from 'zustand';
import { useApp } from './store';
export { normalizeLanHost } from '@memoria/shared';

const PAIR_KEY = 'memoria-wifi-device';
/** Set from pairing until the first sync has been cleared to run. Survives a restart. */
const FIRST_SYNC_KEY = 'memoria-wifi-first-sync';
const CHOOSE = 'Choose in Settings how this device joins your PC.';
/** `hosts` lists every address the PC has reported, the last working one first. */
type Pair = { host: string; hosts: string[]; secret: string; publicKey: string; fingerprint: string; deviceId: string };
const MAX_HOSTS = 8;
type LanStatus = 'off' | 'pairing' | 'syncing' | 'choosing' | 'ok' | 'offline' | 'error';
/** Both sides hold games the other has never seen, so combining them is the owner's call. */
export type FirstSyncChoice = { deviceGames: number; pcGames: number };
export const useLanSync = create<{
  status: LanStatus;
  host: string;
  error: string;
  lastSyncAt: number | null;
  choice: FirstSyncChoice | null;
}>(() => ({
  status: 'off',
  host: '',
  error: '',
  lastSyncAt: null,
  choice: null,
}));
export const isNativeDevice = () => Capacitor.isNativePlatform();
let pair: Pair | null = null;
let generation = 0;
let inFlight: Promise<void> | null = null;
let pairingInProgress = false;
let dirty = false;
let initialized = false;
let debounce: ReturnType<typeof setTimeout> | undefined;
let firstSyncCheck: Promise<void> | null = null;
/** The PC's data as read for the pending choice. Never merged until the owner picks. */
let pcStateForChoice: AppState | null = null;
const firstSyncPending = () => localStorage.getItem(FIRST_SYNC_KEY) !== null;
function clearFirstSync() {
  localStorage.removeItem(FIRST_SYNC_KEY);
  pcStateForChoice = null;
  useLanSync.setState({ choice: null });
}

class LanError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request(
  host: string,
  path: string,
  data: unknown,
  connection?: Pick<Pair, 'secret' | 'fingerprint'>,
  quick = false,
): Promise<Record<string, unknown>> {
  if (!isNativeDevice()) throw new Error('Wi-Fi pairing is available in the Android app.');
  if (!connection) throw new Error('Pair this PC again to enable encrypted sync.');
  const send = (url: string, data: unknown) =>
    CapacitorHttp.post({
      url,
      data,
      headers: { 'Content-Type': 'application/json' },
      responseType: 'json',
      connectTimeout: quick ? 4000 : 8000,
      readTimeout: 15000,
      disableRedirects: true,
    });
  let response;
  let packet: LanPacket;
  let responseKey: Uint8Array;
  try {
    const hello = await send(`${host}/hello`, {});
    const pc = hello.data?.publicKey;
    if (
      hello.status !== 200 ||
      typeof pc !== 'string' ||
      !/^[a-f0-9]{64}$/.test(pc) ||
      deviceFingerprint(pc) !== connection.fingerprint
    )
      throw new LanError('The PC key does not match. Scan a new PC code in Settings.', 403);
    const phone = devicePublicKey(connection.secret);
    const keys = lanKeys(connection.secret, pc, pc, phone);
    responseKey = keys.response;
    packet = sealLan(keys.request, path, phone, hello.data.challenge, data);
    response = await send(`${host}${path}`, packet);
  } catch (error) {
    if (error instanceof LanError) throw error;
    throw new LanError('Cannot reach your PC. Open Memoria there and use the same Wi-Fi or private network.', 0);
  }
  if (response.status !== 200)
    throw new LanError('Encrypted connection failed. Update both devices and pair again.', 403);
  let body;
  try {
    const reply = response.data as LanPacket;
    if (reply.challenge !== packet.challenge) throw new Error();
    body = openLan(responseKey, path, reply, packet.nonce);
  } catch {
    throw new LanError('Sync authentication failed. Local edits were kept.', 403);
  }
  if (typeof body.error === 'string') throw new LanError(body.error, Number(body.status) || 500);
  return body;
}

function savePair(next: Pair) {
  pair = next;
  localStorage.setItem(PAIR_KEY, JSON.stringify(next));
  useLanSync.setState({ host: next.host });
}

/** Valid addresses from a PC reply, the working one first. Unknown entries are dropped. */
function knownHosts(host: string, reported: unknown, previous: string[]): string[] {
  const hosts = [host];
  const add = (value: unknown) => {
    if (typeof value !== 'string') return;
    try {
      hosts.push(normalizeLanHost(value));
    } catch {
      // Ignore an address this build cannot use.
    }
  };
  if (Array.isArray(reported)) reported.forEach(add);
  previous.forEach(add);
  return [...new Set(hosts)].slice(0, MAX_HOSTS);
}

/**
 * Send to the last working address, then to the PC's other addresses when it
 * cannot be reached, so a new Wi-Fi address or a private network app such as
 * Tailscale keeps sync going without a new code.
 */
async function requestPc(connection: Pair, path: string, data: unknown): Promise<Record<string, unknown>> {
  const others = connection.hosts.filter((host) => host !== connection.host);
  try {
    return await request(connection.host, path, data, connection, others.length > 0);
  } catch (error) {
    if (!(error instanceof LanError) || error.status !== 0 || others.length === 0) throw error;
    for (const [index, host] of others.entries()) {
      try {
        const body = await request(host, path, data, connection, true);
        if (pair?.secret === connection.secret)
          savePair({ ...connection, host, hosts: knownHosts(host, [], connection.hosts) });
        return body;
      } catch (next) {
        if (!(next instanceof LanError) || next.status !== 0 || index === others.length - 1) throw next;
      }
    }
    throw error;
  }
}

function setStatus(status: LanStatus, error = '') {
  useLanSync.setState({ status, error, ...(status === 'ok' ? { lastSyncAt: Date.now() } : {}) });
  useApp
    .getState()
    .setSyncStatus(
      status === 'ok'
        ? 'ok'
        : status === 'syncing'
          ? 'syncing'
          : status === 'offline' || status === 'error' || status === 'choosing'
            ? 'error'
            : 'idle',
      error,
    );
}

export async function pairLanDevice(hostInput: string, code: string, fingerprint: string): Promise<void> {
  if (pair) throw new Error('Disconnect this PC before pairing another.');
  return connectToPc([normalizeLanHost(hostInput)], code, fingerprint.replace(/\s/g, '').toLowerCase());
}

export async function pairLanFromQr(text: string): Promise<void> {
  const payload = parsePairingCode(text);
  return connectToPc(payload.addresses, payload.code, payload.fingerprint);
}

async function connectToPc(hosts: string[], code: string, fingerprint: string): Promise<void> {
  if (pairingInProgress) throw new Error('Already connecting.');
  if (!/^\d{8}$/.test(code.replace(/\s/g, ''))) throw new Error('Enter the eight-digit code from PC Settings.');
  if (!/^[a-f0-9]{64}$/.test(fingerprint)) throw new Error('Enter the PC key fingerprint from PC Settings.');
  const secret = newDeviceKey();
  const credentials = { secret, fingerprint };
  pairingInProgress = true;
  const previous = pair;
  const current = ++generation;
  setStatus('pairing');
  try {
    let host = hosts[0];
    let body: Record<string, unknown> | undefined;
    for (const candidate of hosts) {
      if (current !== generation) return;
      try {
        body = await request(candidate, '/pair', { code: code.replace(/\s/g, ''), name: 'Android phone' }, credentials);
        host = candidate;
        break;
      } catch (error) {
        if (!(error instanceof LanError) || error.status !== 0 || candidate === hosts.at(-1)) throw error;
      }
    }
    if (current !== generation) return;
    if (!body || typeof body.deviceId !== 'string') throw new Error('Invalid pairing reply.');
    localStorage.setItem(FIRST_SYNC_KEY, '1');
    pcStateForChoice = null;
    useLanSync.setState({ choice: null, lastSyncAt: null });
    savePair({
      host,
      hosts: knownHosts(host, hosts, []),
      secret,
      publicKey: devicePublicKey(secret),
      fingerprint,
      deviceId: body.deviceId,
    });
    if (previous) {
      // The PC may have moved to a new Wi-Fi address. Its old credential is
      // still valid there; retire it so reconnecting does not fill device slots.
      const previousHosts = [...new Set([previous.host, host])];
      for (const previousHost of previousHosts)
        void request(previousHost, '/disconnect', {}, previous).catch(() => undefined);
    }
    await syncLanNow();
  } catch (error) {
    if (current !== generation) return;
    setStatus('error', error instanceof Error ? error.message : String(error));
    throw error;
  } finally {
    pairingInProgress = false;
  }
}

export async function disconnectLanSync(): Promise<void> {
  const previous = pair;
  ++generation;
  pair = null;
  dirty = false;
  clearTimeout(debounce);
  localStorage.removeItem(PAIR_KEY);
  clearFirstSync();
  useLanSync.setState({ host: '', lastSyncAt: null });
  setStatus('off');
  // Forget locally immediately even when the PC is off. Its Settings can revoke
  // the old device if this best-effort request cannot reach it.
  if (previous) void request(previous.host, '/disconnect', {}, previous).catch(() => undefined);
}

/**
 * A first sync merges by id, so a device set up on its own would add a second
 * copy of every game the PC already has. Read the PC's data without sending
 * ours, and stop for the owner when each side has games the other has not seen.
 */
function checkFirstSync(): Promise<void> {
  if (firstSyncCheck) return firstSyncCheck;
  const connection = pair;
  const current = generation;
  if (!connection) return Promise.resolve();
  firstSyncCheck = (async () => {
    const live = (state: AppState) => state.games.filter((game) => !game.deleted);
    try {
      const local = live(useApp.getState().state);
      if (local.length > 0) {
        // An empty state changes nothing on the PC; the reply is the PC's own data.
        const response = await requestPc(connection, '/sync', { state: emptyState() });
        if (current !== generation || pair?.secret !== connection.secret) return;
        assertSyncProtocol(response.state);
        if (!safeParseAppState(response.state).success)
          throw new Error('The PC returned invalid data. Update Memoria on both devices. Local edits were kept.');
        const pcState = normalizeState(response.state);
        const known = new Set(pcState.games.map((game) => game.id));
        const pcGames = live(pcState).length;
        const unseen = live(useApp.getState().state).filter((game) => !known.has(game.id)).length;
        if (pcGames > 0 && unseen > 0) {
          pcStateForChoice = pcState;
          useLanSync.setState({ choice: { deviceGames: local.length, pcGames } });
          setStatus('choosing', CHOOSE);
          return;
        }
      }
      clearFirstSync();
    } catch (error) {
      if (current !== generation || pair?.secret !== connection.secret) return;
      if (error instanceof LanError && error.status === 401) {
        localStorage.removeItem(PAIR_KEY);
        clearFirstSync();
        pair = null;
        useLanSync.setState({ host: '' });
      }
      setStatus(
        error instanceof LanError && error.status === 0 ? 'offline' : 'error',
        error instanceof Error ? error.message : String(error),
      );
      return;
    }
    firstSyncCheck = null;
    await syncLanNow();
  })().finally(() => {
    firstSyncCheck = null;
  });
  return firstSyncCheck;
}

/**
 * Answer the first-sync question. `pc` replaces this device's data with the
 * PC's, `combine` keeps every game from both, `cancel` disconnects untouched.
 */
export async function resolveFirstSync(answer: 'pc' | 'combine' | 'cancel'): Promise<void> {
  if (!useLanSync.getState().choice) return;
  if (answer === 'cancel') return disconnectLanSync();
  const pcState = pcStateForChoice;
  if (answer === 'pc') {
    if (!pcState) return;
    useApp.getState().replaceState(pcState);
  }
  clearFirstSync();
  await syncLanNow();
}

export async function syncLanNow(): Promise<void> {
  if (!pair || !isNativeDevice()) return;
  if (firstSyncPending()) {
    // Nothing is sent while the question is open; a failed check is tried again here.
    if (!useLanSync.getState().choice) await checkFirstSync();
    return;
  }
  if (inFlight) {
    dirty = true;
    return inFlight;
  }
  const connection = pair;
  const current = generation;
  const sent = useApp.getState().state;
  if (new TextEncoder().encode(JSON.stringify({ state: sent })).byteLength > 1_000_000) {
    setStatus('error', 'Data is over the 1 MB sync limit.');
    return;
  }
  let complete!: () => void;
  inFlight = new Promise<void>((resolve) => {
    complete = resolve;
  });
  dirty = false;
  setStatus('syncing');
  let success = false;
  try {
    const response = await requestPc(connection, '/sync', { state: sent });
    const reached = pair;
    if (current !== generation || !reached || reached.secret !== connection.secret) return;
    assertSyncProtocol(response.state);
    const parsed = safeParseAppState(response.state);
    if (!parsed.success)
      throw new Error('The PC returned invalid data. Update Memoria on both devices. Local edits were kept.');
    // Read the store after the response: edits made during the request survive.
    const local = useApp.getState().state;
    dirty ||= local !== sent;
    // Normalize the original clocks: schema repair would turn an impossible
    // future energy reading into "now" and let it replace the current reading.
    useApp.getState().replaceState(mergeState(local, normalizeState(response.state)));
    const hosts = knownHosts(reached.host, response.addresses, reached.hosts);
    if (hosts.join() !== reached.hosts.join()) savePair({ ...reached, hosts });
    setStatus('ok');
    success = true;
  } catch (error) {
    if (current !== generation || pair?.secret !== connection.secret) return;
    if (error instanceof LanError && error.status === 401) {
      localStorage.removeItem(PAIR_KEY);
      pair = null;
      useLanSync.setState({ host: '' });
    }
    setStatus(
      error instanceof LanError && error.status === 0 ? 'offline' : 'error',
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    inFlight = null;
    complete();
    // Also handles a new pairing while an old, uncancellable native request ends.
    if (pair && (current !== generation || (success && dirty))) {
      clearTimeout(debounce);
      debounce = setTimeout(() => void syncLanNow(), 300);
    }
  }
}

export function initLanSync(): void {
  if (initialized || !isNativeDevice()) return;
  initialized = true;
  try {
    const saved = JSON.parse(localStorage.getItem(PAIR_KEY) ?? 'null') as Partial<Pair> | null;
    if (
      saved &&
      typeof saved.secret === 'string' &&
      /^[a-f0-9]{64}$/.test(saved.secret) &&
      typeof saved.fingerprint === 'string' &&
      /^[a-f0-9]{64}$/.test(saved.fingerprint) &&
      typeof saved.deviceId === 'string'
    ) {
      const host = normalizeLanHost(saved.host ?? '');
      pair = {
        host,
        hosts: knownHosts(host, saved.hosts, []),
        secret: saved.secret,
        publicKey: devicePublicKey(saved.secret),
        fingerprint: saved.fingerprint,
        deviceId: saved.deviceId,
      };
      useLanSync.setState({ host });
    } else if (saved) {
      localStorage.removeItem(PAIR_KEY);
      clearFirstSync();
      setStatus('error', 'Pair this PC again to enable encrypted sync.');
    }
  } catch {
    localStorage.removeItem(PAIR_KEY);
  }
  document.addEventListener('tg-mutated', () => {
    dirty = true;
    clearTimeout(debounce);
    debounce = setTimeout(() => void syncLanNow(), 800);
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void syncLanNow();
  });
  window.addEventListener('online', () => void syncLanNow());
  setInterval(() => {
    if (!document.hidden) void syncLanNow();
  }, 15_000);
  void syncLanNow();
}
