import { COMPLETION_RETENTION_MS, emptyState } from '@void/shared';
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
import { flushPersist, useApp } from '../src/store';
import { ANONYMOUS_IDENTITY, LOCAL_IDENTITY, migrateLegacyStorageKeyForIdentity } from '../src/storage-identity';
import { getSyncConfig, resetSyncState, setSyncConfig, syncNow } from '../src/sync';
import { migrateLegacyUiStorage } from '../src/ui-store';

let resetSequence = 0;

function storedState(name: string): ReturnType<typeof emptyState> {
  const state = emptyState();
  state.games = [
    {
      id: name.toLowerCase().replaceAll(' ', '-'),
      name,
      short: name.slice(0, 4),
      color: '#8b5cf6',
      icon: '',
      platform: 'both',
      tz: 'Etc/UTC',
      dailyResetHour: 4,
      weeklyResetDay: 1,
      monthlyResetDay: 1,
      paused: false,
      sort: 0,
      updatedAt: 1,
    },
  ];
  return state;
}

async function flushPersistence(): Promise<void> {
  await vi.advanceTimersByTimeAsync(121);
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
    expect(idb.has('void-state::user:alice')).toBe(true);
    expect(idb.has('void-state::user:bob')).toBe(true);
  });

  it('keeps local mode on unsuffixed storage keys', async () => {
    await useApp.getState().setIdentity(LOCAL_IDENTITY);
    useApp.getState().addBlankGame('Legacy local game');
    updateLocalSecrets({ telegramToken: 'legacy-token' });
    await flushPersistence();

    expect(idb.has('void-state')).toBe(true);
    expect(idb.has('void-state::local')).toBe(false);
    expect(localStorage.getItem('void-local-secrets-v1')).toContain('legacy-token');
    expect(localStorage.getItem('void-local-secrets-v1::local')).toBeNull();

    await useApp.getState().setIdentity(ANONYMOUS_IDENTITY);
    await useApp.getState().setIdentity(LOCAL_IDENTITY);
    expect(useApp.getState().state.games.map((game) => game.name)).toEqual(['Legacy local game']);
    expect(readLocalSecrets().telegramToken).toBe('legacy-token');
  });

  it('migrates legacy technogg IndexedDB data to the Void key for the same identity', async () => {
    idb.set('technogg-state::user:alice-migration', storedState('Alice legacy'));

    await useApp.getState().setIdentity('user:alice-migration');

    expect(useApp.getState().state.games.map((game) => game.name)).toEqual(['Alice legacy']);
    expect((idb.get('void-state::user:alice-migration') as ReturnType<typeof emptyState>).games[0]?.name).toBe(
      'Alice legacy',
    );
    expect(idb.has('technogg-state::user:alice-migration')).toBe(false);
  });

  it('can run the IndexedDB prefix migration twice without changing the migrated value', async () => {
    idb.set('technogg-state::user:twice', storedState('Migrated once'));

    await useApp.getState().setIdentity('user:twice');
    await useApp.getState().setIdentity(ANONYMOUS_IDENTITY);
    await useApp.getState().setIdentity('user:twice');

    expect(useApp.getState().state.games.map((game) => game.name)).toEqual(['Migrated once']);
    expect((idb.get('void-state::user:twice') as ReturnType<typeof emptyState>).games[0]?.name).toBe('Migrated once');
    expect(idb.has('technogg-state::user:twice')).toBe(false);
  });

  it('does not overwrite a pre-existing Void IndexedDB value with legacy data', async () => {
    idb.set('technogg-state::user:existing', storedState('Stale legacy'));
    idb.set('void-state::user:existing', storedState('Current Void'));

    await useApp.getState().setIdentity('user:existing');

    expect(useApp.getState().state.games.map((game) => game.name)).toEqual(['Current Void']);
    expect((idb.get('void-state::user:existing') as ReturnType<typeof emptyState>).games[0]?.name).toBe('Current Void');
    expect(idb.has('technogg-state::user:existing')).toBe(true);
  });

  it('migrates each identity only from its matching legacy IndexedDB key', async () => {
    idb.set('technogg-state::user:alice-isolated', storedState('Alice isolated'));
    idb.set('technogg-state::user:bob-isolated', storedState('Bob isolated'));

    await useApp.getState().setIdentity('user:alice-isolated');
    expect(useApp.getState().state.games.map((game) => game.name)).toEqual(['Alice isolated']);
    expect(idb.has('void-state::user:bob-isolated')).toBe(false);
    expect(idb.has('technogg-state::user:bob-isolated')).toBe(true);

    await useApp.getState().setIdentity('user:bob-isolated');
    expect(useApp.getState().state.games.map((game) => game.name)).toEqual(['Bob isolated']);
    expect((idb.get('void-state::user:alice-isolated') as ReturnType<typeof emptyState>).games[0]?.name).toBe(
      'Alice isolated',
    );
    expect((idb.get('void-state::user:bob-isolated') as ReturnType<typeof emptyState>).games[0]?.name).toBe(
      'Bob isolated',
    );
  });

  it('flushes a pending state immediately without waiting for the debounce', async () => {
    await useApp.getState().setIdentity('user:flush');
    useApp.getState().addBlankGame('Flush me');
    expect(idb.has('void-state::user:flush')).toBe(false);

    await flushPersist();

    expect((idb.get('void-state::user:flush') as ReturnType<typeof emptyState>).games[0]?.name).toBe('Flush me');
  });

  it('prunes expired completion rows while loading and writes the compacted state back', async () => {
    const now = Date.now();
    const state = emptyState();
    state.completions = [
      { id: 'expired', taskId: 'task', periodKey: 'old', done: true, updatedAt: now - COMPLETION_RETENTION_MS - 1 },
      { id: 'boundary', taskId: 'task', periodKey: 'new', done: true, updatedAt: now - COMPLETION_RETENTION_MS },
    ];
    idb.set('void-state::user:pruning', state);

    await useApp.getState().setIdentity('user:pruning');
    expect(useApp.getState().state.completions.map((completion) => completion.id)).toEqual(['boundary']);
    await flushPersistence();
    expect(
      (idb.get('void-state::user:pruning') as ReturnType<typeof emptyState>).completions.map(
        (completion) => completion.id,
      ),
    ).toEqual(['boundary']);
  });

  it('namespaces sync credentials and migrates the legacy shared value once', async () => {
    localStorage.setItem('technogg-sync-config', JSON.stringify({ url: 'https://legacy.test', token: 'legacy-token' }));
    await useApp.getState().setIdentity('user:alice-config');
    expect(getSyncConfig()).toEqual({ url: 'https://legacy.test', token: 'legacy-token' });
    expect(localStorage.getItem('technogg-sync-config')).toBeNull();
    expect(localStorage.getItem('void-sync-config::user:alice-config')).toContain('legacy-token');

    await useApp.getState().setIdentity('user:bob-config');
    expect(getSyncConfig()).toEqual({ url: '', token: '' });
    setSyncConfig({ url: 'https://bob.test', token: 'bob-token' });

    await useApp.getState().setIdentity('user:alice-config');
    expect(getSyncConfig().token).toBe('legacy-token');
    await useApp.getState().setIdentity('user:bob-config');
    expect(getSyncConfig().token).toBe('bob-token');
  });

  it('uses the standard identity key for formerly competing localStorage conventions', () => {
    localStorage.setItem('technogg-onboarding:user_123', 'complete');
    expect(
      migrateLegacyStorageKeyForIdentity(
        'void-onboarding',
        'user:user_123',
        'technogg-onboarding',
        'technogg-onboarding:user_123',
      ),
    ).toBe('void-onboarding::user:user_123');
    expect(localStorage.getItem('void-onboarding::user:user_123')).toBe('complete');
    expect(localStorage.getItem('technogg-onboarding:user_123')).toBeNull();
  });

  it('migrates the device-shared UI store once without overwriting a Void value', () => {
    const legacy = JSON.stringify({ state: { textSize: 'xl', dashboardLayout: 'cards' }, version: 0 });
    localStorage.setItem('technogg-ui', legacy);

    migrateLegacyUiStorage();
    migrateLegacyUiStorage();

    expect(localStorage.getItem('void-ui')).toBe(legacy);
    expect(localStorage.getItem('technogg-ui')).toBeNull();

    const current = JSON.stringify({ state: { textSize: 's', dashboardLayout: 'nexus' }, version: 0 });
    localStorage.setItem('void-ui', current);
    localStorage.setItem('technogg-ui', legacy);
    migrateLegacyUiStorage();

    expect(localStorage.getItem('void-ui')).toBe(current);
    expect(localStorage.getItem('technogg-ui')).toBe(legacy);
  });

  it('keeps renamed localStorage values scoped to their matching identities', () => {
    localStorage.setItem('technogg-setup-dismissed::user:alice', 'alice');
    localStorage.setItem('technogg-setup-dismissed::user:bob', 'bob');

    migrateLegacyStorageKeyForIdentity('void-setup-dismissed', 'user:alice', 'technogg-setup-dismissed');

    expect(localStorage.getItem('void-setup-dismissed::user:alice')).toBe('alice');
    expect(localStorage.getItem('void-setup-dismissed::user:bob')).toBeNull();
    expect(localStorage.getItem('technogg-setup-dismissed::user:bob')).toBe('bob');

    migrateLegacyStorageKeyForIdentity('void-setup-dismissed', 'user:bob', 'technogg-setup-dismissed');

    expect(localStorage.getItem('void-setup-dismissed::user:alice')).toBe('alice');
    expect(localStorage.getItem('void-setup-dismissed::user:bob')).toBe('bob');
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

  it('surfaces client_outdated without entering the conflict retry path', async () => {
    await useApp.getState().setIdentity('user:outdated');
    configureHostedSession({ hosted: true, userId: 'outdated', getToken: async () => 'test-token' });
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 409,
      json: async () => ({ error: 'client_outdated' }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await syncNow();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(useApp.getState()).toMatchObject({
      syncStatus: 'error',
      syncError: 'This device is running an older version -- reload to update',
    });
  });

  it('continues to retry genuine sync conflicts', async () => {
    await useApp.getState().setIdentity('user:conflict');
    configureHostedSession({ hosted: true, userId: 'conflict', getToken: async () => 'test-token' });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({ error: 'sync_conflict_retry' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ state: emptyState(), version: 7 }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ state: emptyState(), version: 8 }) });
    vi.stubGlobal('fetch', fetchMock);

    await syncNow();

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/sync', '/api/state', '/api/sync']);
    expect(useApp.getState().syncStatus).toBe('ok');
  });

  it('warns before sending a state near the document cap', async () => {
    await useApp.getState().setIdentity('user:large');
    configureHostedSession({ hosted: true, userId: 'large', getToken: async () => 'test-token' });
    const state = emptyState();
    state.reminders = Array.from({ length: 46 }, (_, index) => ({
      id: `large-${index}`,
      gameId: null,
      message: 'x'.repeat(20_000),
      at: index,
      updatedAt: index,
    }));
    useApp.setState({ state });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await syncNow();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(useApp.getState().syncError).toMatch(/nearing the 1 MB sync limit/);
  });
});
