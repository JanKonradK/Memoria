import { emptyState } from '@void/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const idb = vi.hoisted(() => new Map<string, unknown>());

vi.mock('idb-keyval', () => ({
  get: vi.fn(async (key: string) => idb.get(key)),
  set: vi.fn(async (key: string, value: unknown) => {
    idb.set(key, value);
  }),
  del: vi.fn(async (key: string) => {
    idb.delete(key);
  }),
}));

import { configureHostedSession } from '../src/auth-session';
import { useApp } from '../src/store';
import { ANONYMOUS_IDENTITY } from '../src/storage-identity';
import { resetSyncState, syncNow } from '../src/sync';

let sequence = 0;

async function hostedIdentity(name: string): Promise<void> {
  await useApp.getState().setIdentity(`user:${name}-${sequence++}`);
  configureHostedSession({ hosted: true, userId: name, getToken: async () => 'test-token' });
}

/** A fetch mock whose response is released manually, so a switch can race it. */
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

beforeEach(async () => {
  idb.clear();
  localStorage.clear();
  resetSyncState();
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  await useApp.getState().setIdentity(ANONYMOUS_IDENTITY);
});

afterEach(async () => {
  resetSyncState();
  configureHostedSession({ hosted: false, userId: null });
  await useApp.getState().setIdentity(ANONYMOUS_IDENTITY);
  vi.unstubAllGlobals();
});

describe('syncNow preconditions', () => {
  it('never contacts the network for the anonymous identity', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await syncNow();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('short-circuits while offline instead of failing the sync', async () => {
    await hostedIdentity('offline');
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await syncNow();

    expect(fetchMock).not.toHaveBeenCalled();
    // Offline is a normal state, not an error the user must act on.
    expect(useApp.getState().syncStatus).not.toBe('error');
  });
});

describe('re-entrancy', () => {
  it('does not double-post when a second sync starts while one is in flight', async () => {
    await hostedIdentity('reentrant');
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

describe('identity guards', () => {
  it('abandons an in-flight sync when the identity changes mid-request', async () => {
    // The failure this pins is cross-account corruption: the response belongs to
    // the OLD user, so it must never be merged into the NEW identity's state.
    await hostedIdentity('racer');
    const { mock, release } = deferredFetch();
    vi.stubGlobal('fetch', mock);

    const inFlight = syncNow();
    await useApp.getState().setIdentity('user:someone-else');
    release();
    await inFlight;

    // The late response was discarded, so the new identity is untouched and the
    // status was not stamped 'ok' on its behalf.
    expect(useApp.getState().identity).toBe('user:someone-else');
    expect(useApp.getState().state.games.filter((game) => !game.deleted)).toHaveLength(0);
    expect(useApp.getState().syncStatus).not.toBe('ok');
  });

  it('does not report an error against an identity the user has already left', async () => {
    await hostedIdentity('errored');
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchMock = vi.fn(async () => {
      await gate;
      throw new Error('network died');
    });
    vi.stubGlobal('fetch', fetchMock);

    const inFlight = syncNow();
    await useApp.getState().setIdentity('user:moved-on');
    release();
    await inFlight;

    expect(useApp.getState().syncError).toBe('');
    expect(useApp.getState().syncStatus).not.toBe('error');
  });
});

describe('conflict retry ceiling', () => {
  it('gives up after three conflicted attempts rather than looping forever', async () => {
    await hostedIdentity('stubborn');
    const fetchMock = vi.fn(async (url: string) =>
      url.endsWith('/api/sync')
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
