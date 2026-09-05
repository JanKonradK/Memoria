import { emptyState, type AppState, type Game } from '@memoria/shared';
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
  keys: vi.fn(async () => [...idb.keys()]),
}));

import { useApp } from '../src/store';
import {
  cloudSyncNow,
  cloudSyncSupported,
  connectExistingCloudFile,
  connectNewCloudFile,
  disconnectCloudFile,
  mergeCloudDocument,
  resetCloudSyncState,
} from '../src/cloud-sync';

function game(id: string, name: string, updatedAt: number): Game {
  return {
    id,
    name,
    short: name.slice(0, 2),
    color: '#ffffff',
    color2: '#000000',
    color3: '#888888',
    icon: '',
    platform: 'pc',
    tz: 'Etc/GMT-1',
    dailyResetHour: 4,
    weeklyResetDay: 1,
    monthlyResetDay: 1,
    paused: false,
    sort: 0,
    updatedAt,
  };
}

function withGames(...games: Game[]): AppState {
  return { ...emptyState(), games };
}

/**
 * A stand-in for the file the provider syncs. `contents` is what is on disk, and
 * a test mutates it directly to play the part of the other device writing first.
 */
function fakeFile(initial = '') {
  const store = { contents: initial, lastModified: 1000, writes: [] as string[] };
  const handle = {
    kind: 'file' as const,
    name: 'memoria-sync.json',
    async getFile() {
      return {
        lastModified: store.lastModified,
        async text() {
          return store.contents;
        },
      };
    },
    async createWritable() {
      let staged = '';
      return {
        async write(chunk: string) {
          staged += chunk;
        },
        async close() {
          store.contents = staged;
          store.writes.push(staged);
          store.lastModified += 1000;
        },
        async abort() {},
      };
    },
    async queryPermission() {
      return 'granted' as const;
    },
    async requestPermission() {
      return 'granted' as const;
    },
  };
  return { store, handle };
}

beforeEach(() => {
  idb.clear();
  resetCloudSyncState();
  useApp.setState({ state: emptyState(), loaded: true, cloudStatus: 'off', cloudError: '', cloudFileName: '' });
});

afterEach(() => {
  resetCloudSyncState();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window, 'showSaveFilePicker');
  Reflect.deleteProperty(window, 'showOpenFilePicker');
});

describe('cloudSyncSupported', () => {
  it('is false when the browser has no file pickers', () => {
    expect(cloudSyncSupported()).toBe(false);
  });

  it('is true once both pickers exist', () => {
    Object.assign(window, { showSaveFilePicker: () => {}, showOpenFilePicker: () => {} });
    expect(cloudSyncSupported()).toBe(true);
  });
});

describe('mergeCloudDocument', () => {
  it('treats a freshly created empty file as nothing to merge', () => {
    const local = withGames(game('a', 'Genshin', 5));
    expect(mergeCloudDocument(local, '')).toEqual({ next: local, changed: false });
  });

  it('folds in a row this device has never seen', () => {
    const local = withGames(game('a', 'Genshin', 5));
    const remote = withGames(game('b', 'HSR', 7));

    const { next, changed } = mergeCloudDocument(local, JSON.stringify(remote));

    expect(changed).toBe(true);
    expect(next.games.map((g) => g.id).sort()).toEqual(['a', 'b']);
  });

  it('keeps the later edit of a row both devices touched', () => {
    const local = withGames(game('a', 'Local name', 10));
    const remote = withGames(game('a', 'Remote name', 20));

    expect(mergeCloudDocument(local, JSON.stringify(remote)).next.games[0]!.name).toBe('Remote name');
    expect(mergeCloudDocument(remote, JSON.stringify(local)).next.games[0]!.name).toBe('Remote name');
  });

  it('accepts the launcher-shaped { state } wrapper as well as a bare document', () => {
    const local = emptyState();
    const remote = withGames(game('b', 'ZZZ', 7));

    const { next } = mergeCloudDocument(local, JSON.stringify({ state: remote, version: 3 }));

    expect(next.games.map((g) => g.id)).toEqual(['b']);
  });

  it('refuses a file that is not a Memoria document rather than salvaging it', () => {
    // normalizeState would happily answer an empty document here, and the write
    // that followed would replace whatever the user actually picked.
    const local = withGames(game('a', 'Genshin', 5));
    expect(() => mergeCloudDocument(local, JSON.stringify({ notes: ['shopping list'] }))).toThrow(
      /not a Memoria document/,
    );
    expect(() => mergeCloudDocument(local, '{ definitely not json')).toThrow();
  });
});

describe('connecting a file', () => {
  it('writes the local document into a file that is still empty', async () => {
    const { store, handle } = fakeFile('');
    Object.assign(window, { showSaveFilePicker: async () => handle });
    useApp.setState({ state: withGames(game('a', 'Genshin', 5)) });

    await connectNewCloudFile();

    expect(JSON.parse(store.contents).games.map((g: Game) => g.id)).toEqual(['a']);
    expect(useApp.getState().cloudStatus).toBe('ok');
    expect(useApp.getState().cloudFileName).toBe('memoria-sync.json');
  });

  it('adopts the other device`s document when joining an existing file', async () => {
    const remote = withGames(game('b', 'HSR', 7));
    const { handle } = fakeFile(JSON.stringify(remote));
    Object.assign(window, { showOpenFilePicker: async () => [handle] });
    useApp.setState({ state: withGames(game('a', 'Genshin', 5)) });

    await connectExistingCloudFile();

    expect(
      useApp
        .getState()
        .state.games.map((g) => g.id)
        .sort(),
    ).toEqual(['a', 'b']);
  });

  it('reports and writes nothing when the picked file belongs to something else', async () => {
    const { store, handle } = fakeFile(JSON.stringify({ notes: ['shopping list'] }));
    Object.assign(window, { showSaveFilePicker: async () => handle });
    useApp.setState({ state: withGames(game('a', 'Genshin', 5)) });

    await connectNewCloudFile();

    expect(store.writes).toEqual([]);
    expect(store.contents).toBe(JSON.stringify({ notes: ['shopping list'] }));
    expect(useApp.getState().cloudStatus).toBe('error');
  });

  it('stays quiet when the user dismisses the picker', async () => {
    Object.assign(window, {
      showSaveFilePicker: async () => {
        throw new DOMException('The user aborted a request.', 'AbortError');
      },
    });

    await connectNewCloudFile();

    expect(useApp.getState().cloudStatus).not.toBe('error');
  });
});

describe('cloudSyncNow', () => {
  it('does nothing at all when no file is connected', async () => {
    await cloudSyncNow();
    expect(useApp.getState().cloudStatus).toBe('off');
  });

  it('does not rewrite a file that already says exactly this', async () => {
    const { store, handle } = fakeFile('');
    Object.assign(window, { showSaveFilePicker: async () => handle });
    useApp.setState({ state: withGames(game('a', 'Genshin', 5)) });
    await connectNewCloudFile();
    expect(store.writes).toHaveLength(1);

    await cloudSyncNow();
    await cloudSyncNow();

    expect(store.writes).toHaveLength(1);
  });

  it('picks up an edit another device left in the file, then writes the union back', async () => {
    const { store, handle } = fakeFile('');
    Object.assign(window, { showSaveFilePicker: async () => handle });
    useApp.setState({ state: withGames(game('a', 'Genshin', 5)) });
    await connectNewCloudFile();

    // The other device syncs its copy in underneath us.
    store.contents = JSON.stringify(withGames(game('b', 'HSR', 7)));
    store.lastModified += 1000;

    await cloudSyncNow();

    expect(
      useApp
        .getState()
        .state.games.map((g) => g.id)
        .sort(),
    ).toEqual(['a', 'b']);
    expect(
      JSON.parse(store.contents)
        .games.map((g: Game) => g.id)
        .sort(),
    ).toEqual(['a', 'b']);
  });

  it('leaves the file alone when the device stops syncing', async () => {
    const { store, handle } = fakeFile('');
    Object.assign(window, { showSaveFilePicker: async () => handle });
    useApp.setState({ state: withGames(game('a', 'Genshin', 5)) });
    await connectNewCloudFile();
    const written = store.contents;

    await disconnectCloudFile();

    expect(store.contents).toBe(written);
    expect(useApp.getState().cloudStatus).toBe('off');
    expect(idb.has('memoria-cloud-file')).toBe(false);
  });
});
