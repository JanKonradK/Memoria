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
