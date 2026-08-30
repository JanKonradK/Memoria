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

vi.mock('../src/launcher', () => ({ servedByLauncher: () => launcher.serving }));

import { useApp } from '../src/store';
import { resetSyncState, syncNow } from '../src/sync';

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

describe('conflict handling', () => {
  it('pulls, merges and retries when another window wrote first', async () => {
    let conflicted = false;
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).endsWith('/api/sync')) {
        if (conflicted) return { ok: true, status: 200, json: async () => ({ state: emptyState(), version: 3 }) };
        conflicted = true;
        return { ok: false, status: 409, json: async () => ({ error: 'sync_conflict_retry' }) };
      }
      return { ok: true, status: 200, json: async () => ({ state: emptyState(), version: 2 }) };
    });
    vi.stubGlobal('fetch', fetchMock);

    await syncNow();

    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/api/state'))).toHaveLength(1);
    expect(useApp.getState().syncStatus).toBe('ok');
  });

  it('gives up after three conflicted attempts rather than looping forever', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      String(url).endsWith('/api/sync')
        ? { ok: false, status: 409, json: async () => ({ error: 'sync_conflict_retry' }) }
        : { ok: true, status: 200, json: async () => ({ state: emptyState(), version: 1 }) },
    );
    vi.stubGlobal('fetch', fetchMock);

    await syncNow();

    const posts = fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/api/sync'));
    expect(posts).toHaveLength(3);
    expect(useApp.getState()).toMatchObject({
      syncStatus: 'error',
      syncError: 'Sync remained conflicted after three attempts.',
    });
  });
});

describe('launcher errors', () => {
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
