import { emptyState } from '@technogg/shared';
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
import { readLocalSecrets, updateLocalSecrets } from '../src/secret-store';
import { useApp } from '../src/store';
import { ANONYMOUS_IDENTITY, LOCAL_IDENTITY } from '../src/storage-identity';
import { resetSyncState, syncNow } from '../src/sync';

let resetSequence = 0;

async function flushPersistence(): Promise<void> {
  await vi.advanceTimersByTimeAsync(251);
}

beforeEach(async () => {
  vi.useFakeTimers();
  idb.clear();
  localStorage.clear();
  await useApp.getState().setIdentity(`test-reset:${resetSequence++}`);
  await useApp.getState().setIdentity(ANONYMOUS_IDENTITY);
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});

afterEach(async () => {
  resetSyncState();
  configureHostedSession({ hosted: false, userId: null });
  await useApp.getState().setIdentity(ANONYMOUS_IDENTITY);
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('storage identities', () => {
  it('keeps two signed-in identities isolated when switching between them', async () => {
    await useApp.getState().setIdentity('user:alice');
    useApp.getState().addBlankGame('Alice game');
    updateLocalSecrets({ discordWebhook: 'alice-secret' });
    await flushPersistence();

    await useApp.getState().setIdentity('user:bob');
    expect(useApp.getState().state.games).toHaveLength(0);
    expect(readLocalSecrets().discordWebhook).toBe('');
    useApp.getState().addBlankGame('Bob game');
    updateLocalSecrets({ discordWebhook: 'bob-secret' });
    await flushPersistence();

    await useApp.getState().setIdentity('user:alice');
    expect(useApp.getState().state.games.map((game) => game.name)).toEqual(['Alice game']);
    expect(readLocalSecrets().discordWebhook).toBe('alice-secret');

    await useApp.getState().setIdentity('user:bob');
    expect(useApp.getState().state.games.map((game) => game.name)).toEqual(['Bob game']);
    expect(readLocalSecrets().discordWebhook).toBe('bob-secret');
    expect(idb.has('technogg-state::user:alice')).toBe(true);
    expect(idb.has('technogg-state::user:bob')).toBe(true);
  });

  it('keeps local mode on the existing unsuffixed storage keys', async () => {
    await useApp.getState().setIdentity(LOCAL_IDENTITY);
    useApp.getState().addBlankGame('Legacy local game');
    updateLocalSecrets({ telegramToken: 'legacy-token' });
    await flushPersistence();

    expect(idb.has('technogg-state')).toBe(true);
    expect(idb.has('technogg-state::local')).toBe(false);
    expect(localStorage.getItem('technogg-local-secrets-v1')).toContain('legacy-token');
    expect(localStorage.getItem('technogg-local-secrets-v1::local')).toBeNull();

    await useApp.getState().setIdentity(ANONYMOUS_IDENTITY);
    await useApp.getState().setIdentity(LOCAL_IDENTITY);
    expect(useApp.getState().state.games.map((game) => game.name)).toEqual(['Legacy local game']);
    expect(readLocalSecrets().telegramToken).toBe('legacy-token');
  });
});

describe('sync identity state', () => {
  it('resetSyncState clears the server version cursor', async () => {
    await useApp.getState().setIdentity('user:sync-user');
    configureHostedSession({ hosted: true, userId: 'sync-user', getToken: async () => 'test-token' });
    const fetchMock = vi.fn();
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ state: emptyState(), version: 41 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ state: emptyState(), version: 42 }),
      });
    vi.stubGlobal('fetch', fetchMock);

    await syncNow();
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({ version: null });

    resetSyncState();
    expect(useApp.getState().syncStatus).toBe('idle');
    await syncNow();
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toMatchObject({ version: null });
  });
});
