import { emptyState, mergeState, type RemoteEventFeed } from '@memoria/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeGame } from '../../shared/test/helpers';

const idb = vi.hoisted(() => new Map<string, unknown>());
vi.mock('idb-keyval', () => ({
  get: vi.fn(async (key: string) => idb.get(key)),
  set: vi.fn(async (key: string, value: unknown) => {
    idb.set(key, value);
  }),
  del: vi.fn(async (key: string) => {
    idb.delete(key);
  }),
  keys: vi.fn(async () => [...idb.keys()]),
}));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false }, CapacitorHttp: { get: vi.fn() } }));
vi.mock('../src/launcher', () => ({ servedByLauncher: () => false, launcherFetch: vi.fn() }));

import { flushPersist, useApp } from '../src/store';
import { planSeedImport } from '../src/data/seed-events';
import { refreshRemoteFeed, useRemoteFeed, PUBLIC_EVENT_FEED_URL } from '../src/data/remote-feed';

const now = Date.parse('2026-10-06T12:00:00Z');
function feed(over: Partial<RemoteEventFeed> = {}): RemoteEventFeed {
  return {
    version: 2,
    generatedAt: '2026-10-06T10:00:00Z',
    seedUpdated: '2026-10-06',
    revision: 'review-1',
    events: [
      {
        game: 'genshin',
        sourceKey: 'public:genshin:test',
        name: 'Reviewed event',
        type: 'event',
        start: '2026-10-07 10:00',
        end: '2026-10-10 03:59',
        notes: 'Publisher-reviewed date.',
      },
    ],
    withdrawn: [],
    ...over,
  };
}

beforeEach(async () => {
  await flushPersist();
  idb.clear();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.spyOn(Date, 'now').mockReturnValue(now);
  const state = emptyState();
  state.games = [makeGame({ presetKey: 'genshin' })];
  useApp.setState({ state, loaded: true, importHistory: [] });
  useRemoteFeed.setState({ status: 'idle', error: '', lastSuccessAt: null });
});

describe('reviewed public calendar imports', () => {
  it('imports once, retains metadata across sync and stops older bundles rolling it back', () => {
    expect(useApp.getState().importRemoteEvents(feed())).toEqual({ applied: 1, skipped: false });
    expect(useApp.getState().importRemoteEvents(feed())).toEqual({ applied: 0, skipped: true });
    expect(planSeedImport(useApp.getState().state, now)).toEqual([]);
    expect(mergeState(emptyState(), useApp.getState().state).settings.remoteFeedVersion?.revision).toBe('review-1');
  });

  it('applies reviewed corrections while retaining completion and user edits', () => {
    useApp.getState().importRemoteEvents(feed());
    const original = useApp.getState().state.events[0]!;
    useApp.getState().upsertEvent({ ...original, done: true });
    const updated = feed({
      generatedAt: '2026-10-06T11:00:00Z',
      revision: 'review-2',
      events: [{ ...feed().events[0]!, end: '2026-10-11 03:59' }],
    });
    expect(useApp.getState().importRemoteEvents(updated).applied).toBe(1);
    expect(useApp.getState().state.events[0]?.done).toBe(true);
    useApp.getState().upsertEvent({ ...useApp.getState().state.events[0]!, notes: 'My plan' });
    const newer = feed({
      generatedAt: '2026-10-06T11:30:00Z',
      revision: 'review-3',
      events: [{ ...updated.events[0]!, name: 'Renamed upstream' }],
    });
    expect(useApp.getState().importRemoteEvents(newer).applied).toBe(0);
    expect(useApp.getState().state.events[0]?.notes).toBe('My plan');
    expect(useApp.getState().state.events[0]?.name).toBe('Reviewed event');
  });

  it('does not resurrect deleted events or overwrite unowned source matches', () => {
    useApp.getState().importRemoteEvents(feed());
    const original = useApp.getState().state.events[0]!;
    useApp.getState().deleteEvent(original.id);
    useApp.getState().importRemoteEvents(feed({ generatedAt: '2026-10-06T11:00:00Z', revision: 'review-2' }));
    expect(useApp.getState().state.events).toHaveLength(1);
    expect(useApp.getState().state.events[0]?.deleted).toBe(true);
    useApp.setState({
      state: { ...useApp.getState().state, events: [{ ...original, seedHash: undefined, name: 'My imported title' }] },
    });
    useApp.getState().importRemoteEvents(feed({ generatedAt: '2026-10-06T11:30:00Z', revision: 'review-3' }));
    expect(useApp.getState().state.events[0]?.name).toBe('My imported title');
  });

  it('does not treat a partial delivery as a request to remove missing events', () => {
    useApp.getState().importRemoteEvents(feed());
    useApp
      .getState()
      .importRemoteEvents(feed({ generatedAt: '2026-10-06T11:00:00Z', revision: 'review-2', events: [] }));
    expect(useApp.getState().state.events[0]?.deleted).not.toBe(true);
    useApp.getState().importRemoteEvents(
      feed({
        generatedAt: '2026-10-06T11:30:00Z',
        revision: 'review-3',
        events: [],
        withdrawn: ['public:genshin:test'],
      }),
    );
    expect(useApp.getState().state.events[0]?.deleted).toBe(true);
  });

  it('scopes a repeated feed to newly added accounts with their own server times', () => {
    useApp.getState().importRemoteEvents(feed());
    useApp.getState().batch((state) => ({
      ...state,
      games: [...state.games, makeGame({ id: 'g2', presetKey: 'genshin', tz: 'Etc/GMT-8' })],
    }));
    expect(useApp.getState().importRemoteEvents(feed()).applied).toBe(1);
    const events = useApp.getState().state.events;
    expect(events).toHaveLength(2);
    expect(events[0]!.start - events[1]!.start).toBe(7 * 3_600_000);
  });

  it('rejects future, stale, oversized or invalid feeds without changing events', () => {
    useApp.getState().importRemoteEvents(feed());
    const before = useApp.getState().state;
    const inputs: unknown[] = [
      feed({ generatedAt: '2026-10-06T09:00:00Z', revision: 'old' }),
      feed({ revision: 'different-content-same-publication-time' }),
      feed({ generatedAt: '2026-10-07T10:00:00Z' }),
      feed({ events: [{ ...feed().events[0]!, start: '2026-02-31 10:00' }] }),
      { ...feed(), extra: 'x'.repeat(530_000) },
      { ...feed(), version: 100 },
    ];
    for (const input of inputs) {
      expect(useApp.getState().importRemoteEvents(input).skipped).toBe(true);
      expect(useApp.getState().state).toBe(before);
    }
  });

  it('keeps the latest calendar date when an older calendar was packaged later', () => {
    const left = emptyState();
    const right = emptyState();
    left.settings.remoteFeedVersion = {
      generatedAt: '2026-10-06T10:00:00Z',
      seedUpdated: '2026-10-06',
      revision: 'new-facts',
      receivedAt: now,
    };
    right.settings.remoteFeedVersion = {
      generatedAt: '2026-10-06T11:00:00Z',
      seedUpdated: '2026-10-05',
      revision: 'old-facts-later-package',
      receivedAt: now,
    };
    expect(mergeState(left, right).settings.remoteFeedVersion?.revision).toBe('new-facts');
    expect(mergeState(right, left).settings.remoteFeedVersion?.revision).toBe('new-facts');
  });
});

describe('public calendar refresh', () => {
  it('fetches only the fixed public feed without credentials and records a successful check', async () => {
    const request = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(feed())));
    await refreshRemoteFeed();
    expect(request).toHaveBeenCalledWith(
      PUBLIC_EVENT_FEED_URL,
      expect.objectContaining({ credentials: 'omit', redirect: 'error' }),
    );
    expect(useRemoteFeed.getState()).toMatchObject({ status: 'ok', lastSuccessAt: now });
    expect(useApp.getState().state.events).toHaveLength(1);
  });

  it('preserves events and last success when a later network check fails', async () => {
    const request = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(feed())));
    await refreshRemoteFeed();
    const before = useApp.getState().state;
    request.mockRejectedValue(new Error('Offline'));
    await refreshRemoteFeed();
    expect(useRemoteFeed.getState()).toMatchObject({ status: 'error', lastSuccessAt: now });
    expect(useApp.getState().state).toBe(before);
  });
});
