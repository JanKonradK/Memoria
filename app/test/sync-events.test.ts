import { emptyState } from '@memoria/shared';
import { afterEach, expect, it, vi } from 'vitest';

vi.mock('idb-keyval', () => ({ get: vi.fn(), set: vi.fn(), del: vi.fn(), keys: vi.fn(async () => []) }));
vi.mock('../src/launcher', () => ({
  servedByLauncher: () => true,
  launcherFetch: (path: string, init?: RequestInit) => fetch(path, init),
}));

import { useApp } from '../src/store';
import { initSync, resetSyncState } from '../src/sync';

afterEach(async () => {
  window.dispatchEvent(new Event('pagehide'));
  await Promise.resolve();
  resetSyncState();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it('pulls changes missed while the desktop event stream was disconnected', async () => {
  vi.useFakeTimers();
  useApp.setState({ state: emptyState(), loaded: true });
  const streams: ReadableStreamDefaultController<Uint8Array>[] = [];
  let remote = emptyState();
  let syncs = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/events') {
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              streams.push(controller);
              init?.signal?.addEventListener('abort', () => controller.close(), { once: true });
            },
          }),
        );
      }
      syncs++;
      return { ok: true, status: 200, json: async () => ({ state: remote }) };
    }),
  );

  initSync();
  await vi.advanceTimersByTimeAsync(350);
  expect(streams).toHaveLength(1);
  const beforeReconnect = syncs;
  streams[0]!.close();
  remote = { ...remote, settings: { ...remote.settings, sleepHours: 9, updatedAt: Date.now() } };
  await vi.advanceTimersByTimeAsync(2300);

  expect(streams).toHaveLength(2);
  expect(syncs).toBeGreaterThan(beforeReconnect);
  expect(useApp.getState().state.settings.sleepHours).toBe(9);
});

it('resumes a stream stopped by an expired launcher token after the host restores it', async () => {
  vi.useFakeTimers();
  useApp.setState({ state: emptyState(), loaded: true });
  let restored = false;
  let streams = 0;
  let writes = 0;
  const remote = emptyState();
  remote.settings = { ...remote.settings, sleepHours: 6, updatedAt: Date.now() };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (!restored) {
        throw Object.assign(new Error('Old session expired'), { name: 'LauncherAuthorizationError' });
      }
      if (url === '/api/events') {
        streams++;
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              init?.signal?.addEventListener('abort', () => controller.close(), { once: true });
            },
          }),
        );
      }
      writes++;
      return { ok: true, status: 200, json: async () => ({ state: remote }) };
    }),
  );
  initSync();
  window.dispatchEvent(new Event('pageshow'));
  await vi.advanceTimersByTimeAsync(1);
  expect(useApp.getState().syncStatus).toBe('error');

  restored = true;
  window.dispatchEvent(new Event('memoria-launcher-restored'));
  await vi.advanceTimersByTimeAsync(350);

  expect(streams).toBe(1);
  expect(writes).toBeGreaterThan(0);
  expect(useApp.getState().syncStatus).toBe('ok');
  expect(useApp.getState().state.settings.sleepHours).toBe(6);
});

it('does not let an old unauthorized response stop a renewed session or discard pending edits', async () => {
  vi.useFakeTimers();
  useApp.setState({ state: emptyState(), loaded: true });
  let release!: () => void;
  const oldRequest = new Promise<void>((resolve) => (release = resolve));
  let restored = false;
  let streams = 0;
  const sent: { settings: { sleepHours: number } }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (!restored) {
        await oldRequest;
        throw Object.assign(new Error('Old session expired'), { name: 'LauncherAuthorizationError' });
      }
      if (url === '/api/events') {
        streams++;
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              init?.signal?.addEventListener('abort', () => controller.close(), { once: true });
            },
          }),
        );
      }
      const state = JSON.parse(String(init?.body)).state;
      sent.push(state);
      return { ok: true, status: 200, json: async () => ({ state }) };
    }),
  );
  initSync();
  window.dispatchEvent(new Event('pageshow'));
  document.dispatchEvent(new Event('visibilitychange'));
  await vi.advanceTimersByTimeAsync(1);
  useApp.getState().updateSettings({ sleepHours: 5 });

  restored = true;
  window.dispatchEvent(new Event('memoria-launcher-restored'));
  release();
  await vi.advanceTimersByTimeAsync(350);

  expect(streams).toBe(1);
  expect(sent.at(-1)?.settings.sleepHours).toBe(5);
  expect(useApp.getState().syncStatus).toBe('ok');
  await vi.advanceTimersByTimeAsync(3000);
  expect(streams).toBe(1);
});
