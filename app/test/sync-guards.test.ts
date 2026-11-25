import { emptyState } from '@memoria/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const idb = vi.hoisted(() => new Map<string, unknown>());
const launcher = vi.hoisted(() => ({ serving: true }));

vi.mock('idb-keyval', () => ({
  get: vi.fn(async (key: string) => idb.get(key)),
  set: vi.fn(async (key: string, value: unknown) => {
    idb.set(key, value);
  }),
  del: vi.fn(async (key: string) => {
    idb.delete(key);
  }),
}));

vi.mock('../src/launcher', () => ({
  servedByLauncher: () => launcher.serving,
  launcherFetch: (path: string, init?: RequestInit) => fetch(path, init),
}));

import { useApp } from '../src/store';
import { flushSync, resetSyncState, syncNow } from '../src/sync';

/** A fetch mock whose response is released manually, so two calls can race. */
function deferredFetch() {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const mock = vi.fn(async () => {
    await gate;
    return { ok: true, status: 200, json: async () => ({ state: emptyState(), version: 5 }) };
  });
  return { mock, release };
}

beforeEach(() => {
  idb.clear();
  localStorage.clear();
  launcher.serving = true;
  useApp.setState({ state: emptyState(), loaded: true });
  resetSyncState();
});

afterEach(() => {
  resetSyncState();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('syncNow preconditions', () => {
  it('never contacts the network when the launcher is not serving the page', async () => {
    launcher.serving = false;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await syncNow();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(useApp.getState().syncStatus).not.toBe('error');
  });

  it('syncs while the machine has no internet, because the launcher is loopback', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ state: emptyState() }) }));
    vi.stubGlobal('fetch', fetchMock);

    await syncNow();

    expect(fetchMock).toHaveBeenCalled();
    expect(useApp.getState().syncStatus).toBe('ok');
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  });
});

describe('re-entrancy', () => {
  it('waits for an active request and sends edits made during it in a follow-up', async () => {
    vi.useFakeTimers();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const sent: { settings: { sleepHours: number } }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url, init: RequestInit) => {
        const state = JSON.parse(String(init.body)).state;
        sent.push(state);
        if (sent.length === 1) await gate;
        return { ok: true, status: 200, json: async () => ({ state }) };
      }),
    );
    const first = syncNow();
    useApp.getState().updateSettings({ sleepHours: 9 });
    const completed = vi.fn();
    const concurrent = syncNow().then(completed);
    await Promise.resolve();
    expect(completed).not.toHaveBeenCalled();
    release();
    await Promise.all([first, concurrent]);
    expect(completed).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(300);
    expect(sent).toHaveLength(2);
    expect(sent[1]?.settings.sleepHours).toBe(9);
    await vi.advanceTimersByTimeAsync(1000);
    expect(sent).toHaveLength(2);
  });

  it('does not double-post when a second sync starts while one is in flight', async () => {
    const { mock, release } = deferredFetch();
    vi.stubGlobal('fetch', mock);

    const first = syncNow();
    const second = syncNow();
    release();
    await Promise.all([first, second]);

    const posts = mock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST');
    expect(posts).toHaveLength(1);
  });
});

describe('single-POST HLC sync', () => {
  it('posts state without version and merges the launcher reply', async () => {
    let postedBody: Record<string, unknown> | undefined;
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      postedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return { ok: true, status: 200, json: async () => ({ state: emptyState(), version: 3 }) };
    });
    vi.stubGlobal('fetch', fetchMock);

    await syncNow();

    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/api/sync'))).toHaveLength(1);
    expect(postedBody).toBeDefined();
    expect('version' in postedBody!).toBe(false);
    expect(useApp.getState().syncStatus).toBe('ok');
  });

  it('queues a follow-up sync when local edits arrive while a request is in flight', async () => {
    vi.useFakeTimers();
    try {
      const { mock, release } = deferredFetch();
      vi.stubGlobal('fetch', mock);

      const running = syncNow();
      useApp.getState().updateSettings({ sleepHours: 6 });
      release();
      await running;
      await vi.advanceTimersByTimeAsync(350);

      const posts = mock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST');
      expect(posts).toHaveLength(2);
      expect(useApp.getState().syncStatus).toBe('ok');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('launcher errors', () => {
  it.each([
    { settings: { theme: 'dark' } },
    { ...emptyState(), games: [{ id: 'broken' }] },
    { ...emptyState(), schemaVersion: 999 },
  ])('keeps local data when the launcher returns an invalid or newer document', async (state) => {
    useApp.getState().updateSettings({ sleepHours: 9 });
    const local = useApp.getState().state;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ state, version: 5 }) })),
    );

    await syncNow();

    expect(useApp.getState().state).toBe(local);
    expect(useApp.getState().syncStatus).toBe('error');
    expect(useApp.getState().syncError).toMatch(/invalid data|Update Memoria/i);
  });

  it('records HTTP error status when the launcher returns a non-JSON failure', async () => {
    const local = useApp.getState().state;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 503,
        json: async () => {
          throw new Error('not json');
        },
      })),
    );

    await syncNow();

    expect(useApp.getState().state).toBe(local);
    expect(useApp.getState()).toMatchObject({ syncStatus: 'error', syncError: 'HTTP 503' });
  });

  it('surfaces the launcher JSON error instead of only the status code', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: 'Invalid app state: schema version is too new' }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await syncNow();

    expect(useApp.getState()).toMatchObject({
      syncStatus: 'error',
      syncError: 'Invalid app state: schema version is too new',
    });
  });
});

describe('PC close sync boundary', () => {
  it('sends the last edit made while an earlier request was still running', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const sent: { settings: { sleepHours: number } }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url, init: RequestInit) => {
        const state = JSON.parse(String(init.body)).state;
        sent.push(state);
        if (sent.length === 1) await gate;
        return { ok: true, status: 200, json: async () => ({ state }) };
      }),
    );
    const earlier = syncNow();
    useApp.getState().updateSettings({ sleepHours: 6 });
    const finalSave = flushSync();
    release();
    await Promise.all([earlier, finalSave]);
    expect(sent).toHaveLength(2);
    expect(sent[1].settings.sleepHours).toBe(6);
    expect(useApp.getState().syncStatus).toBe('ok');
  });

  it('rejects instead of approving close after a failed PC write', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 500, json: async () => ({ error: 'Disk full' }) })),
    );
    await expect(flushSync()).rejects.toThrow('Disk full');
  });
});
