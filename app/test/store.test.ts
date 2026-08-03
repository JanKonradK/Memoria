import {
  effectiveCountTarget,
  emptyState,
  latestSnapshots,
  PRESETS,
  projectEnergy,
  safeParseAppState,
} from '@void/shared';
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

import { flushPersist, useApp } from '../src/store';
import { storageKeyForIdentity } from '../src/storage-identity';

let identitySequence = 0;

/** Each test gets its own identity so nothing leaks through the module-level store. */
async function freshStore(): Promise<void> {
  await useApp.getState().setIdentity(`store-test:${identitySequence++}`);
}

/**
 * `addBlankGame` already creates a default 'Energy' resource (cap 100, regen 6),
 * so patch THAT row rather than adding a second one — otherwise every lookup
 * silently targets the default and the assertions test nothing.
 */
function addGameWithResource(cap = 100, regenMinutes = 8, reserveCap = 0) {
  const gameId = useApp.getState().addBlankGame('Test game');
  const resource = useApp.getState().state.resources.find((r) => r.gameId === gameId && !r.deleted)!;
  useApp.getState().upsertResource({ id: resource.id, gameId, cap, regenMinutes, reserveCap });
  return { gameId, resourceId: resource.id };
}

/**
 * Snapshots are ordered by `takenAt`, so two writes inside the same millisecond
 * tie-break arbitrarily. Real interactions are milliseconds apart; step the clock
 * so "latest" is unambiguous instead of depending on how fast the test machine is.
 */
function writeEnergy(resourceId: string, value: number, reserve?: number): void {
  vi.advanceTimersByTime(1_000);
  useApp.getState().setEnergy(resourceId, value, reserve);
}

beforeEach(async () => {
  idb.clear();
  localStorage.clear();
  await freshStore();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('local load validation', () => {
  it('repairs a malformed document row-wise and writes the valid result back', async () => {
    const source = useApp.getState();
    const gameId = source.addBlankGame('Stored');
    const raw = {
      ...useApp.getState().state,
      games: [
        { ...useApp.getState().state.games[0]!, monthlyResetDay: 31 },
        { ...useApp.getState().state.games[0]!, id: '', name: 'Broken' },
      ],
    };
    const identity = `store-load:${identitySequence++}`;
    const key = storageKeyForIdentity('void-state', identity)!;
    idb.set(key, raw);

    await useApp.getState().setIdentity(identity);

    const loaded = useApp.getState().state;
    expect(loaded.games).toHaveLength(1);
    expect(loaded.games[0]).toMatchObject({ id: gameId, monthlyResetDay: 28 });
    expect(loaded.resources.some((resource) => resource.gameId === gameId)).toBe(true);

    await flushPersist();
    const persisted = idb.get(key);
    expect(safeParseAppState(persisted).success).toBe(true);
    expect((persisted as typeof loaded).games[0]!.monthlyResetDay).toBe(28);
  });
});

describe('addMissingPresetTasksEverywhere', () => {
  it('catches up two renamed accounts created from the same preset', () => {
    const genshin = PRESETS.find((preset) => preset.key === 'genshin')!;
    const euId = useApp.getState().addGameFromPreset(genshin, {});
    const naId = useApp.getState().addGameFromPreset(genshin, {});

    useApp.getState().updateGame(euId, { name: 'Europe account', short: 'GI-EU', accountLabel: 'Main EU' });
    useApp.getState().updateGame(naId, { name: 'America account', short: 'GI-NA', accountLabel: 'Alt NA' });

    const created = useApp.getState().state;
    expect(created.games.filter((game) => game.id === euId || game.id === naId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: euId, presetKey: 'genshin', short: 'GI-EU', accountLabel: 'Main EU' }),
        expect.objectContaining({ id: naId, presetKey: 'genshin', short: 'GI-NA', accountLabel: 'Alt NA' }),
      ]),
    );

    useApp.getState().replaceState({
      ...created,
      tasks: created.tasks.filter((task) => task.gameId !== euId && task.gameId !== naId),
    });

    expect(useApp.getState().addMissingPresetTasksEverywhere()).toBe(genshin.tasks.length * 2);
    for (const gameId of [euId, naId]) {
      expect(
        useApp
          .getState()
          .state.tasks.filter((task) => task.gameId === gameId)
          .map((task) => task.name),
      ).toEqual(genshin.tasks.map((task) => task.name));
    }
  });
});

describe('setEnergy', () => {
  it('clamps to the resource cap and to zero', () => {
    const { resourceId } = addGameWithResource(100);

    writeEnergy(resourceId, 500);
    expect(latestSnapshots(useApp.getState().state.snapshots).get(resourceId)?.value).toBe(100);

    writeEnergy(resourceId, -20);
    expect(latestSnapshots(useApp.getState().state.snapshots).get(resourceId)?.value).toBe(0);
  });

  it('keeps only the newest snapshots per resource and always retains the latest write', () => {
    const { resourceId } = addGameWithResource(500);

    // Comfortably past the 200-per-resource retention limit.
    for (let index = 0; index < 260; index++) writeEnergy(resourceId, index);

    const mine = useApp.getState().state.snapshots.filter((s) => s.resourceId === resourceId);
    expect(mine.length).toBeLessThanOrEqual(200);
    // The most recent value survives trimming — that is what every projection reads.
    expect(latestSnapshots(useApp.getState().state.snapshots).get(resourceId)?.value).toBe(259);
  });

  it('trims only the target resource, never a sibling', () => {
    const { gameId, resourceId } = addGameWithResource(500);
    useApp.getState().upsertResource({ gameId, name: 'Second', cap: 50, regenMinutes: 4 });
    const other = useApp.getState().state.resources.find((r) => r.name === 'Second' && !r.deleted)!;

    writeEnergy(other.id, 7);
    for (let index = 0; index < 250; index++) writeEnergy(resourceId, index);

    const siblings = useApp.getState().state.snapshots.filter((s) => s.resourceId === other.id);
    expect(siblings).toHaveLength(1);
    expect(siblings[0]!.value).toBe(7);
  });
});

describe('adjustEnergy', () => {
  it('preserves the PROJECTED reserve rather than rolling it back to the snapshot', () => {
    // Regression guard for the load-bearing comment in store.ts: reserve keeps
    // accruing while the main bar sits at cap, and a quick +/- must not undo it.
    const { gameId, resourceId } = addGameWithResource(100, 8, 200);

    // Seed a snapshot well in the past so the reserve has had time to accrue.
    writeEnergy(resourceId, 100, 10);
    const seeded = latestSnapshots(useApp.getState().state.snapshots).get(resourceId)!;
    const agedAt = seeded.takenAt - 6 * 60 * 60 * 1000;
    useApp.getState().replaceState({
      ...useApp.getState().state,
      snapshots: useApp.getState().state.snapshots.map((s) => (s.id === seeded.id ? { ...s, takenAt: agedAt } : s)),
    });

    const state = useApp.getState().state;
    const resource = state.resources.find((r) => r.id === resourceId)!;
    const game = state.games.find((g) => g.id === gameId);
    const aged = latestSnapshots(state.snapshots).get(resourceId)!;
    const projected = projectEnergy(resource, aged, Date.now(), game);

    vi.advanceTimersByTime(1_000);
    useApp.getState().adjustEnergy(resourceId, -10);

    const after = latestSnapshots(useApp.getState().state.snapshots).get(resourceId)!;
    // The written reserve is the PROJECTED one, not the (stale) snapshot value.
    expect(after.reserve).toBe(projected.reserve ?? aged.reserve);
    expect(after.reserve ?? 0).toBeGreaterThanOrEqual(aged.reserve ?? 0);
  });

  it('applies the delta to the projected value and clamps at the cap', () => {
    const { resourceId } = addGameWithResource(100);
    writeEnergy(resourceId, 95);

    vi.advanceTimersByTime(1_000);
    useApp.getState().adjustEnergy(resourceId, 20);
    expect(latestSnapshots(useApp.getState().state.snapshots).get(resourceId)?.value).toBe(100);

    vi.advanceTimersByTime(1_000);
    useApp.getState().adjustEnergy(resourceId, -1000);
    expect(latestSnapshots(useApp.getState().state.snapshots).get(resourceId)?.value).toBe(0);
  });

  it('does nothing for an unknown resource', () => {
    const before = useApp.getState().state.snapshots.length;
    useApp.getState().adjustEnergy('missing-resource', 5);
    expect(useApp.getState().state.snapshots).toHaveLength(before);
  });
});

describe('setTaskCount', () => {
  it('marks done only once the count reaches the effective target', () => {
    const store = useApp.getState();
    const gameId = store.addBlankGame('Counted');
    store.addTask(gameId, 'Weekly Bosses', 'weekly');
    const task = useApp.getState().state.tasks.find((t) => t.gameId === gameId)!;
    const target = effectiveCountTarget(task);

    useApp.getState().setTaskCount(task.id, '2026-W30', target - 1);
    let row = useApp.getState().state.completions.find((c) => c.taskId === task.id)!;
    expect(row.countDone).toBe(target - 1);
    expect(row.done).toBe(false);

    useApp.getState().setTaskCount(task.id, '2026-W30', target);
    row = useApp.getState().state.completions.find((c) => c.taskId === task.id)!;
    expect(row.done).toBe(true);
  });

  it('keeps separate period keys independent', () => {
    const store = useApp.getState();
    const gameId = store.addBlankGame('Counted');
    store.addTask(gameId, 'Weekly Bosses', 'weekly');
    const task = useApp.getState().state.tasks.find((t) => t.gameId === gameId)!;

    useApp.getState().setTaskCount(task.id, '2026-W30', 1);
    useApp.getState().setTaskCount(task.id, '2026-W31', 3);

    const rows = useApp.getState().state.completions.filter((c) => c.taskId === task.id);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.periodKey === '2026-W30')?.countDone).toBe(1);
    expect(rows.find((r) => r.periodKey === '2026-W31')?.countDone).toBe(3);
  });
});

describe('deleteGame', () => {
  it('tombstones the game and every child row instead of hard-deleting them', () => {
    // Hard deletes would be resurrected by the LWW merge on the next sync.
    const store = useApp.getState();
    const gameId = store.addBlankGame('Doomed');
    store.upsertResource({ gameId, name: 'Energy', cap: 10 });
    store.addTask(gameId, 'Daily', 'daily');
    store.upsertChip({ gameId, label: 'Domain', delta: -20 });
    store.upsertEvent({ gameId, name: 'Banner', start: Date.now(), end: Date.now() + 1000 });

    useApp.getState().deleteGame(gameId);
    const after = useApp.getState().state;

    expect(after.games.find((g) => g.id === gameId)?.deleted).toBe(true);
    for (const collection of [after.resources, after.tasks, after.chips, after.events]) {
      const children = collection.filter((row) => (row as { gameId?: string }).gameId === gameId);
      expect(children.length).toBeGreaterThan(0);
      expect(children.every((row) => (row as { deleted?: boolean }).deleted === true)).toBe(true);
    }
  });
});

describe('updateSettings', () => {
  it('advances the clock only for the fields actually touched', () => {
    useApp.getState().updateSettings({ sleepHours: 8, localTz: 'Europe/Warsaw' });
    const first = useApp.getState().state.settings;
    const untouchedClock = first.fieldUpdatedAt?.localTz;

    useApp.getState().updateSettings({ sleepHours: 9 });
    const second = useApp.getState().state.settings;

    expect(second.sleepHours).toBe(9);
    expect(second.localTz).toBe('Europe/Warsaw');
    expect(second.fieldUpdatedAt?.localTz).toBe(untouchedClock);
    expect(second.fieldUpdatedAt?.sleepHours ?? 0).toBeGreaterThanOrEqual(first.fieldUpdatedAt?.sleepHours ?? 0);
  });
});

describe('upsertEvents', () => {
  it('appends in order and updates existing ids in place rather than duplicating', () => {
    const store = useApp.getState();
    const gameId = store.addBlankGame('Batch');
    const start = Date.now();

    useApp.getState().upsertEvents([
      { gameId, name: 'First', start, end: start + 1000 },
      { gameId, name: 'Second', start, end: start + 2000 },
      { gameId, name: 'Third', start, end: start + 3000 },
    ]);

    const live = () => useApp.getState().state.events.filter((e) => !e.deleted);
    expect(live().map((e) => e.name)).toEqual(['First', 'Second', 'Third']);

    const second = live().find((e) => e.name === 'Second')!;
    useApp.getState().upsertEvents([
      { id: second.id, gameId, name: 'Second (renamed)' },
      { gameId, name: 'Fourth', start, end: start + 4000 },
    ]);

    expect(live()).toHaveLength(4);
    expect(live().map((e) => e.name)).toEqual(['First', 'Second (renamed)', 'Third', 'Fourth']);
  });

  it('is a single commit — one batch produces one new state object', () => {
    const store = useApp.getState();
    const gameId = store.addBlankGame('Batch');
    const start = Date.now();
    const seen: unknown[] = [];
    const unsubscribe = useApp.subscribe((s) => {
      if (!seen.includes(s.state)) seen.push(s.state);
    });

    seen.length = 0;
    useApp
      .getState()
      .upsertEvents(
        Array.from({ length: 25 }, (_, index) => ({ gameId, name: `Event ${index}`, start, end: start + index })),
      );
    unsubscribe();

    expect(seen).toHaveLength(1);
  });
});

describe('importJson', () => {
  it('returns false for text that is not JSON at all', () => {
    expect(useApp.getState().importJson('not json at all')).toBe(false);
  });

  it('rejects garbage outright, and leaves existing data intact', () => {
    // This used to return true and merge an empty state — a silent no-op that
    // told the user their broken backup had imported fine. Import is the one
    // place with a human standing there who can be told the file is bad, so it
    // now schema-validates and refuses. The non-destructive half of the old
    // contract still holds: their existing games survive.
    useApp.getState().addBlankGame('Keep me');
    const before = useApp.getState().state;

    expect(useApp.getState().importJson(JSON.stringify({ nope: true }))).toBe(false);
    expect(useApp.getState().state).toBe(before);

    const invalid = emptyState();
    invalid.games = [{ ...before.games[0]!, monthlyResetDay: 31 }];
    expect(useApp.getState().importJson(JSON.stringify(invalid))).toBe(false);
    expect(useApp.getState().state).toBe(before);
  });

  it('imports a BARE state — not an export envelope', () => {
    // Settings.tsx unwraps `{ state }` before calling in; the store action itself
    // takes the state directly. Passing an envelope silently imports nothing.
    const incoming = emptyState();
    const gameId = useApp.getState().addBlankGame('Source');
    const source = useApp.getState().state.games.find((g) => g.id === gameId)!;
    incoming.games = [{ ...source, id: 'imported-game', name: 'Imported' }];

    // An envelope is now an explicit failure rather than a silent no-op, which
    // is the difference between "nothing happened" and "we told you why".
    expect(useApp.getState().importJson(JSON.stringify({ state: incoming }))).toBe(false);
    expect(useApp.getState().state.games.some((g) => g.id === 'imported-game')).toBe(false);

    expect(useApp.getState().importJson(JSON.stringify(incoming))).toBe(true);
    expect(useApp.getState().state.games.some((g) => g.id === 'imported-game')).toBe(true);
  });
});
