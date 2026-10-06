import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { MAX_EVENT_FEED_BYTES, RemoteEventFeedSchema, type RemoteEventFeed } from '@memoria/shared';
import { create } from 'zustand';
import { launcherFetch, servedByLauncher } from '../launcher';
import { useApp } from '../store';

export const PUBLIC_EVENT_FEED_URL = 'https://raw.githubusercontent.com/JanKonradK/Memoria/main/app/public/events.json';
const CACHE_KEY = 'memoria-public-calendar';
const REFRESH_MS = 6 * 60 * 60_000;

export const useRemoteFeed = create<{
  status: 'idle' | 'checking' | 'ok' | 'error';
  error: string;
  lastSuccessAt: number | null;
}>(() => ({ status: 'idle', error: '', lastSuccessAt: null }));

let inFlight: Promise<void> | null = null;
let cached: RemoteEventFeed | null = null;

async function readResponse(response: Response): Promise<unknown> {
  if (!response.ok) throw new Error('The public calendar could not be reached. Saved events are still available.');
  if (Number(response.headers.get('content-length') ?? 0) > MAX_EVENT_FEED_BYTES)
    throw new Error('The public calendar is too large.');
  const reader = response.body?.getReader();
  if (!reader) return JSON.parse(await response.text());
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > MAX_EVENT_FEED_BYTES) {
        await reader.cancel();
        throw new Error('The public calendar is too large.');
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

async function requestFeed(): Promise<unknown> {
  if (Capacitor.isNativePlatform()) {
    const response = await CapacitorHttp.get({
      url: PUBLIC_EVENT_FEED_URL,
      responseType: 'json',
      connectTimeout: 8000,
      readTimeout: 12_000,
      disableRedirects: true,
    });
    if (response.status !== 200)
      throw new Error('The public calendar could not be reached. Saved events are still available.');
    return typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
  }
  const options: RequestInit = {
    signal: AbortSignal.timeout(15_000),
    cache: 'no-store',
    credentials: 'omit',
    redirect: 'error',
  };
  return readResponse(
    await (servedByLauncher() ? launcherFetch('/api/calendar', options) : fetch(PUBLIC_EVENT_FEED_URL, options)),
  );
}

/** A failed download never removes cached or locally edited events. */
export function refreshRemoteFeed(): Promise<void> {
  if (window.location.protocol === 'file:') return Promise.resolve();
  if (inFlight) return inFlight;
  inFlight = (async () => {
    useRemoteFeed.setState({ status: 'checking', error: '' });
    try {
      const payload = await requestFeed();
      if (new TextEncoder().encode(JSON.stringify(payload)).byteLength > MAX_EVENT_FEED_BYTES)
        throw new Error('The public calendar is too large.');
      const parsed = RemoteEventFeedSchema.safeParse(payload);
      if (!parsed.success) throw new Error('The public calendar has invalid data. Saved events were kept.');
      const result = useApp.getState().importRemoteEvents(parsed.data);
      if (result.error) throw new Error(result.error);
      // Do not replace the offline cache with an older feed rejected by the store.
      const accepted = useApp.getState().state.settings.remoteFeedVersion;
      if (accepted?.revision === parsed.data.revision) {
        cached = parsed.data;
        const receivedAt = Date.now();
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify({ receivedAt, feed: cached }));
        } catch {
          /* Offline cache is best effort. */
        }
        useRemoteFeed.setState({ status: 'ok', error: '', lastSuccessAt: receivedAt });
      } else {
        useRemoteFeed.setState({ status: 'ok', error: '' });
      }
    } catch (error) {
      useRemoteFeed.setState({
        status: 'error',
        error:
          error instanceof Error ? error.message : 'The public calendar could not be checked. Saved events were kept.',
      });
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/** Start once after local state loads; return cleanup for the app lifecycle. */
export function initRemoteFeed(): () => void {
  // The downloadable standalone file intentionally makes no network requests.
  if (window.location.protocol === 'file:') return () => undefined;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw && raw.length <= MAX_EVENT_FEED_BYTES + 100) {
      const entry = JSON.parse(raw) as { receivedAt?: unknown; feed?: unknown };
      const parsed = RemoteEventFeedSchema.safeParse(entry.feed);
      if (parsed.success) {
        cached = parsed.data;
        useApp.getState().importRemoteEvents(cached);
        if (typeof entry.receivedAt === 'number' && Number.isFinite(entry.receivedAt) && entry.receivedAt <= Date.now())
          useRemoteFeed.setState({ lastSuccessAt: entry.receivedAt });
      }
    }
  } catch {
    /* Keep the bundled calendar when an offline cache is damaged. */
  }
  void refreshRemoteFeed();
  const timer = setInterval(() => {
    if (!document.hidden) void refreshRemoteFeed();
  }, REFRESH_MS);
  const onOnline = () => {
    void refreshRemoteFeed();
  };
  window.addEventListener('online', onOnline);
  const unsubscribe = useApp.subscribe((next, previous) => {
    if (cached && next.state.games !== previous.state.games) next.importRemoteEvents(cached);
  });
  return () => {
    clearInterval(timer);
    window.removeEventListener('online', onOnline);
    unsubscribe();
  };
}
