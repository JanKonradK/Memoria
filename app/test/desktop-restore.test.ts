import { emptyState } from '@memoria/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  idb: new Map<string, unknown>(),
  serving: true,
  request: vi.fn(),
}));
vi.mock('idb-keyval', () => ({
  get: vi.fn(async (key: string) => fixture.idb.get(key)),
  set: vi.fn(async (key: string, value: unknown) => {
    fixture.idb.set(key, value);
  }),
  del: vi.fn(async (key: string) => {
    fixture.idb.delete(key);
  }),
  keys: vi.fn(async () => [...fixture.idb.keys()]),
}));
vi.mock('../src/launcher', () => ({
  servedByLauncher: () => fixture.serving,
  launcherFetch: fixture.request,
}));

import { flushPersist, useApp } from '../src/store';

beforeEach(async () => {
  await flushPersist();
  fixture.idb.clear();
  fixture.serving = true;
  fixture.request.mockReset();
  useApp.setState({ state: emptyState(), loaded: false, loadError: '', saveError: '' });
});

afterEach(async () => {
  await flushPersist();
});

describe('new PC profile restoration', () => {
  it('adopts old PC settings and roster before making the profile available', async () => {
    const remote = emptyState();
    remote.settings = { ...remote.settings, localTz: 'Asia/Tokyo', sleepHours: 4, updatedAt: 0 };
    fixture.request.mockResolvedValue(new Response(JSON.stringify({ state: remote, version: 3 })));

    await useApp.getState().load();

    expect(useApp.getState()).toMatchObject({ loaded: true, loadError: '' });
    expect(useApp.getState().state.settings).toMatchObject({ localTz: 'Asia/Tokyo', sleepHours: 4, updatedAt: 0 });
    expect(fixture.idb.get('memoria-state')).toEqual(remote);
    expect(fixture.request).toHaveBeenCalledExactlyOnceWith('/api/state', { signal: expect.any(AbortSignal) });
  });

  it('opens a truly empty PC document without waiting for a write', async () => {
    fixture.request.mockResolvedValue(new Response(JSON.stringify({ state: emptyState(), version: 0 })));
    await useApp.getState().load();
    expect(useApp.getState().loaded).toBe(true);
    expect(useApp.getState().state.games).toEqual([]);
    expect(fixture.request).toHaveBeenCalledOnce();
  });

  it.each(['memoria-state', 'void-state', 'technogg-state::user:previous'])(
    '%s takes priority over restoration',
    async (key) => {
      const local = emptyState();
      local.settings.sleepHours = 11;
      fixture.idb.set(key, local);
      await useApp.getState().load();
      expect(useApp.getState().state.settings.sleepHours).toBe(11);
      expect(fixture.request).not.toHaveBeenCalled();
    },
  );

  it.each([
    new Response('unavailable', { status: 503 }),
    new Response(JSON.stringify({ state: { settings: {} } })),
    new Response(JSON.stringify({ state: { ...emptyState(), schemaVersion: 999 } })),
  ])('keeps invalid or unreadable PC data off the write path', async (response) => {
    fixture.request.mockResolvedValue(response);
    await useApp.getState().load();
    expect(useApp.getState().loaded).toBe(false);
    expect(useApp.getState().loadError).not.toBe('');
    expect(fixture.idb.has('memoria-state')).toBe(false);
  });

  it('can retry a failed read without keeping empty defaults', async () => {
    fixture.request.mockRejectedValueOnce(new Error('Connection lost'));
    await useApp.getState().load();
    const remote = emptyState();
    remote.settings.sleepHours = 5;
    fixture.request.mockResolvedValueOnce(new Response(JSON.stringify({ state: remote })));
    await useApp.getState().load();
    expect(useApp.getState()).toMatchObject({ loaded: true, loadError: '' });
    expect(useApp.getState().state.settings.sleepHours).toBe(5);
  });

  it('does not restore an old request after the user clears local data', async () => {
    let finish!: (value: Response) => void;
    fixture.request.mockReturnValueOnce(new Promise<Response>((resolve) => (finish = resolve)));
    const loading = useApp.getState().load();
    await vi.waitFor(() => expect(fixture.request).toHaveBeenCalledOnce());
    await useApp.getState().clearLocalData();
    const remote = emptyState();
    remote.settings.sleepHours = 5;
    finish(new Response(JSON.stringify({ state: remote })));
    await loading;
    expect(fixture.idb.has('memoria-state')).toBe(false);
    expect(useApp.getState().state.settings.sleepHours).toBe(8);
  });

  it('keeps ordinary web profiles local when no launcher is present', async () => {
    fixture.serving = false;
    await useApp.getState().load();
    expect(useApp.getState().loaded).toBe(true);
    expect(fixture.request).not.toHaveBeenCalled();
  });
});
