import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { mergeState, normalizeLanHost, normalizeState, parsePairingCode, safeParseAppState } from '@memoria/shared';
import { create } from 'zustand';
import { useApp } from './store';
export { normalizeLanHost } from '@memoria/shared';

const PAIR_KEY = 'memoria-wifi-device';
type Pair = { host: string; token: string; deviceId: string };
type LanStatus = 'off' | 'pairing' | 'syncing' | 'ok' | 'offline' | 'error';
export const useLanSync = create<{ status: LanStatus; host: string; error: string; lastSyncAt: number | null }>(() => ({
  status: 'off',
  host: '',
  error: '',
  lastSyncAt: null,
}));
export const isNativeDevice = () => Capacitor.isNativePlatform();
let pair: Pair | null = null;
let generation = 0;
let inFlight: Promise<void> | null = null;
let pairingInProgress = false;
let dirty = false;
let initialized = false;
let debounce: ReturnType<typeof setTimeout> | undefined;

class LanError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request(host: string, path: string, data: unknown, token?: string): Promise<Record<string, unknown>> {
  if (!isNativeDevice()) throw new Error('Wi-Fi pairing is available in the Android app.');
  let response;
  try {
    response = await CapacitorHttp.post({
      url: `${host}${path}`,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      data,
      responseType: 'json',
      connectTimeout: path === '/pair' ? 2000 : 8000,
      readTimeout: path === '/pair' ? 4000 : 15_000,
      disableRedirects: true,
    });
  } catch {
    throw new LanError(
      'Cannot reach your PC. Open Memoria on the PC and connect both devices to the same Wi-Fi. Your progress is saved.',
      0,
    );
  }
  const body = response.data;
  if (response.status !== 200)
    throw new LanError(
      typeof body?.error === 'string'
        ? body.error
        : `PC returned HTTP ${response.status}. Check PC Settings and try again.`,
      response.status,
    );
  if (!body || typeof body !== 'object')
    throw new LanError('The PC returned an invalid response. Update Memoria on both devices.', 500);
  return body as Record<string, unknown>;
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
          : status === 'offline' || status === 'error'
            ? 'error'
            : 'idle',
      error,
    );
}

export async function pairLanDevice(hostInput: string, code: string): Promise<void> {
  if (pair) throw new Error('Disconnect this PC before pairing another.');
  return connectToPc([normalizeLanHost(hostInput)], code);
}

export async function pairLanFromQr(text: string): Promise<void> {
  const payload = parsePairingCode(text);
  return connectToPc(payload.addresses, payload.code);
}

async function connectToPc(hosts: string[], code: string): Promise<void> {
  if (pairingInProgress) throw new Error('A connection is already in progress. Please wait.');
  if (!/^\d{8}$/.test(code.replace(/\s/g, ''))) throw new Error('Enter the eight-digit code from PC Settings.');
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
        body = await request(candidate, '/pair', { code: code.replace(/\s/g, ''), name: 'Android phone' });
        host = candidate;
        break;
      } catch (error) {
        if (!(error instanceof LanError) || error.status !== 0 || candidate === hosts.at(-1)) throw error;
      }
    }
    if (current !== generation) return;
    if (
      !body ||
      typeof body.token !== 'string' ||
      !/^[A-Za-z0-9_-]{43}$/.test(body.token) ||
      typeof body.deviceId !== 'string'
    )
      throw new Error('The PC returned invalid pairing details. Get a new code and try again.');
    const next = { host, token: body.token, deviceId: body.deviceId };
    localStorage.setItem(PAIR_KEY, JSON.stringify(next));
    pair = next;
    useLanSync.setState({ host, lastSyncAt: null });
    if (previous) {
      // The PC may have moved to a new Wi-Fi address. Its old credential is
      // still valid there; retire it so reconnecting does not fill device slots.
      const previousHosts = [...new Set([previous.host, host])];
      for (const previousHost of previousHosts)
        void request(previousHost, '/disconnect', {}, previous.token).catch(() => undefined);
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
  useLanSync.setState({ host: '', lastSyncAt: null });
  setStatus('off');
  // Forget locally immediately even when the PC is off. Its Settings can revoke
  // the old device if this best-effort request cannot reach it.
  if (previous) void request(previous.host, '/disconnect', {}, previous.token).catch(() => undefined);
}

export async function syncLanNow(): Promise<void> {
  if (!pair || !isNativeDevice()) return;
  if (inFlight) {
    dirty = true;
    return inFlight;
  }
  const connection = pair;
  const current = generation;
  const sent = useApp.getState().state;
  if (new TextEncoder().encode(JSON.stringify({ state: sent })).byteLength > 1_000_000) {
    setStatus('error', 'Local data exceeds the 1 MB sync limit. Export a backup and reduce old data.');
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
    const response = await request(connection.host, '/sync', { state: sent }, connection.token);
    if (current !== generation || pair !== connection) return;
    const parsed = safeParseAppState(response.state);
    if (!parsed.success)
      throw new Error('The PC returned invalid data. Update Memoria on both devices. Local edits were kept.');
    // Read the store after the response: edits made during the request survive.
    const local = useApp.getState().state;
    dirty ||= local !== sent;
    // Normalize the original clocks: schema repair would turn an impossible
    // future energy reading into "now" and let it replace the current reading.
    useApp.getState().replaceState(mergeState(local, normalizeState(response.state)));
    setStatus('ok');
    success = true;
  } catch (error) {
    if (current !== generation || pair !== connection) return;
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
    const saved = JSON.parse(localStorage.getItem(PAIR_KEY) ?? 'null') as Pair | null;
    if (saved && /^[A-Za-z0-9_-]{43}$/.test(saved.token) && typeof saved.deviceId === 'string') {
      pair = { ...saved, host: normalizeLanHost(saved.host) };
      useLanSync.setState({ host: pair.host });
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
