import { describe, expect, it } from 'vitest';
import { projectEnergy } from '../src/energy';
import { CONTENT_NORMALIZERS, migrateState, normalizeContent, seedMissingRegenSnapshots } from '../src/migrations';
import { normalizeState } from '../src/merge';
import { CURRENT_SCHEMA_VERSION, type AppState } from '../src/types';
import { safeParseAppState } from '../src/validation';
import { makeGame, makeResource, makeSnapshot, makeState, makeTask } from './helpers';

describe('migrateState', () => {
  it('refuses a newer schema before normalization can discard its fields', () => {
    const future = { ...makeState(), schemaVersion: CURRENT_SCHEMA_VERSION + 1, futureField: 'keep me' };
    expect(() => migrateState(future)).toThrow(/newer version/);
    expect(() => normalizeState(future)).toThrow(/newer version/);
    expect(future.futureField).toBe('keep me');
  });

  it('aligns legacy Genshin accounts without overwriting customised fields', () => {
    const state = makeState({
      schemaVersion: 3,
      games: [
        makeGame({ id: 'eu', presetKey: 'genshin', color: '#8d6f26', color2: '#352a54', titleFont: undefined }),
        makeGame({
          id: 'na',
          name: 'Renamed NA account',
          short: 'gi',
          color: '#8D6F26',
          color2: '#352a54',
          titleFont: undefined,
        }),
        makeGame({
          id: 'asia',
          name: 'Genshin Impact',
          short: 'Asia',
          color: '#8d6f26',
          color2: '#352a54',
          titleFont: undefined,
        }),
        makeGame({
          id: 'legacy-cream',
          presetKey: 'genshin',
          color: '#fefef3',
          color2: '#352a54',
          titleFont: undefined,
        }),
        makeGame({
          id: 'custom-palette',
          presetKey: 'genshin',
          color: '#123456',
          color2: '#654321',
          titleFont: undefined,
        }),
        makeGame({
          id: 'custom-font',
          presetKey: 'genshin',
          color: '#8d6f26',
          color2: '#352a54',
          titleFont: "'Orbitron', sans-serif",
        }),
        makeGame({ id: 'unrelated', color: '#8d6f26', color2: '#352a54', titleFont: undefined }),
      ],
    });

    const migrated = migrateState(state) as AppState;
    for (const id of ['eu', 'na', 'asia', 'legacy-cream']) {
      expect(migrated.games.find((game) => game.id === id)).toMatchObject({
        color: '#f8efdb',
        color2: '#d8c9b4',
        titleFont: "'Cinzel', serif",
      });
    }
    expect(migrated.games.find((game) => game.id === 'custom-palette')).toMatchObject({
      color: '#123456',
      color2: '#654321',
      titleFont: "'Cinzel', serif",
    });
    expect(migrated.games.find((game) => game.id === 'custom-font')).toMatchObject({
      color: '#f8efdb',
      color2: '#d8c9b4',
      titleFont: "'Orbitron', sans-serif",
    });
    expect(migrated.games.find((game) => game.id === 'unrelated')).toMatchObject({
      color: '#8d6f26',
      color2: '#352a54',
      titleFont: undefined,
    });
    expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(migrateState(migrated)).toBe(migrated);
  });

  it('strips legacy resource icons without rejecting saved state', () => {
    const legacy = {
      ...makeState(),
      schemaVersion: 4,
      resources: [{ ...makeResource(), icon: 'comet' }],
    };

    const parsed = safeParseAppState(legacy);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.resources[0]).not.toHaveProperty('icon');

    const migrated = migrateState(legacy) as AppState;
    expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(migrated.resources[0]).not.toHaveProperty('icon');
    expect(normalizeState(legacy).resources[0]).not.toHaveProperty('icon');
  });

  it('strips legacy game card display toggles', () => {
    const legacy = {
      ...makeState(),
      schemaVersion: 5,
      games: [{ ...makeGame(), hideProgressRing: true, hideEventStrip: true }],
    };

    const migrated = migrateState(legacy) as AppState;

    expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(migrated.games[0]).not.toHaveProperty('hideProgressRing');
    expect(migrated.games[0]).not.toHaveProperty('hideEventStrip');
    expect(normalizeState(legacy).games[0]).not.toHaveProperty('hideProgressRing');
    expect(normalizeState(legacy).games[0]).not.toHaveProperty('hideEventStrip');
  });

  it('upgrades only the untouched Genshin Crystalfly Trap task', () => {
    const name = 'Crystalfly Trap (Crystal Cores)';
    const state = makeState({
      schemaVersion: 6,
      games: [
        makeGame({ id: 'genshin', presetKey: 'genshin', name: 'Renamed account' }),
        makeGame({ id: 'other', name: 'Other game', short: 'OG' }),
      ],
      tasks: [
        makeTask({ id: 'untouched', gameId: 'genshin', name, mode: undefined }),
        makeTask({ id: 'custom-check', gameId: 'genshin', name, mode: 'check' }),
        makeTask({ id: 'custom-count', gameId: 'genshin', name, mode: 'count', countTarget: 2 }),
        makeTask({ id: 'other-game', gameId: 'other', name, mode: undefined }),
      ],
    });

    const migrated = migrateState(state) as AppState;

    expect(migrated.tasks.find((task) => task.id === 'untouched')).toMatchObject({
      mode: 'timer',
      timerDurationMinutes: 10_080,
      timerStepMinutes: 720,
      timerEndsAt: null,
    });
    // Previously-normalized defaults carry an explicit check mode too.
    expect(migrated.tasks.find((task) => task.id === 'custom-check')?.mode).toBe('timer');
    expect(migrated.tasks.find((task) => task.id === 'custom-count')?.mode).toBe('count');
    expect(migrated.tasks.find((task) => task.id === 'other-game')?.mode).toBeUndefined();
  });
});

describe('seedMissingRegenSnapshots', () => {
  it('seeds missing energy clocks and full weekly stock, and is idempotent', () => {
    const seenAt = 10_000;
    const realSnapshot = makeSnapshot({ id: 'real', resourceId: 'has-reading', value: 42, takenAt: 5_000 });
    const normalized = normalizeState(
      makeState({
        resources: [
          makeResource({ id: 'missing-reading', kind: 'regen' }),
          makeResource({ id: 'has-reading', kind: 'regen' }),
          makeResource({ id: 'counter', kind: 'counter', regenMinutes: 0 }),
          makeResource({ id: 'weekly', kind: 'weekly', regenMinutes: 0 }),
          makeResource({ id: 'deleted', kind: 'regen', deleted: true }),
        ],
        snapshots: [realSnapshot],
      }),
    );
    let idCalls = 0;
    const once = seedMissingRegenSnapshots(normalized, seenAt, () => `seed-${++idCalls}`);
    const twice = seedMissingRegenSnapshots(once, seenAt + 60_000, () => `duplicate-${++idCalls}`);

    expect(once.snapshots).toEqual([
      expect.objectContaining(realSnapshot),
      {
        id: 'seed-1',
        resourceId: 'missing-reading',
        value: 0,
        takenAt: seenAt,
        provenance: { kind: 'estimate', observedAt: seenAt, importedAt: seenAt },
      },
      {
        id: 'seed-2',
        resourceId: 'weekly',
        value: 200,
        takenAt: seenAt,
        provenance: { kind: 'estimate', observedAt: seenAt, importedAt: seenAt },
      },
    ]);
    expect(once.snapshots[0]).toBe(normalized.snapshots[0]);
    expect(twice).toBe(once);
    expect(idCalls).toBe(2);
  });

  it('makes a zero-seeded resource project upward over time', () => {
    const resource = makeResource({ kind: 'regen', regenMinutes: 8 });
    const seeded = seedMissingRegenSnapshots(makeState({ resources: [resource] }), 1_000, () => 'seed');
    const snapshot = seeded.snapshots[0];

    expect(projectEnergy(resource, snapshot, 1_000 + 16 * 60_000)).toMatchObject({
      value: 2,
      hasSnapshot: true,
    });
  });
});

describe('NTE 1.5 overflow storage', () => {
  const nte = (over: Partial<AppState> = {}) =>
    makeState({
      schemaVersion: 10,
      games: [
        makeGame({ id: 'nte', name: 'Neverness to Everness', presetKey: 'nte' }),
        makeGame({ id: 'hsr', presetKey: 'hsr' }),
      ],
      resources: [
        makeResource({ id: 'px', gameId: 'nte', name: 'Character Pixels', cap: 240, regenMinutes: 6, reserveCap: 0 }),
        makeResource({ id: 'cs', gameId: 'nte', name: 'City Stamina', cap: 100, kind: 'weekly', reserveCap: 0 }),
        makeResource({
          id: 'own',
          gameId: 'nte',
          name: 'City Stamina',
          cap: 100,
          reserveCap: 50,
          reserveLabel: 'Mine',
        }),
        makeResource({ id: 'other', gameId: 'hsr', name: 'Character Pixels', reserveCap: 0 }),
      ],
      tasks: [
        makeTask({
          id: 'empty',
          gameId: 'nte',
          name: 'Empty City Stamina before Monday',
          presetTaskKey: 'nte-city-stamina',
        }),
        makeTask({ id: 'renamed', gameId: 'nte', name: 'Spend stamina', presetTaskKey: 'nte-city-stamina' }),
      ],
      ...over,
    });

  it('adds both reserves, retires the Monday routine, and leaves the player’s own choices', () => {
    const migrated = migrateState(nte()) as AppState;
    const byId = (id: string) => migrated.resources.find((row) => row.id === id)!;
    expect(byId('px')).toMatchObject({ reserveCap: 2400, reserveLabel: 'Photo Paper Supply' });
    // The 12 -> 13 step takes the City Stamina reserve off again: there is none.
    expect(byId('cs').reserveCap).toBe(0);
    expect(byId('own')).toMatchObject({ reserveCap: 50, reserveLabel: 'Mine' });
    expect(byId('other').reserveCap).toBe(0);
    expect(migrated.tasks.find((row) => row.id === 'empty')?.deleted).toBe(true);
    expect(migrated.tasks.find((row) => row.id === 'renamed')?.deleted).toBeFalsy();
  });

  it('upgrades every device to the same, newer clock', () => {
    const before = nte();
    const px = before.resources.find((row) => row.id === 'px')!;
    px.hlc = { wall: 1_000, counter: 2, device: 'pc' };
    const first = migrateState(structuredClone(before)) as AppState;
    const second = migrateState(structuredClone(before)) as AppState;
    expect(first).toEqual(second);
    const after = first.resources.find((row) => row.id === 'px')!;
    expect(after.hlc!.counter).toBe(px.hlc!.counter + 1);
    expect(after.hlc!.wall).toBe(px.hlc!.wall);
  });
});

describe('NTE corrections', () => {
  const nte = () =>
    makeState({
      schemaVersion: 12,
      games: [
        makeGame({ id: 'nte', name: 'Neverness to Everness', presetKey: 'nte', tz: 'Europe/Warsaw', updatedAt: 5 }),
        makeGame({ id: 'na', name: 'Neverness to Everness', presetKey: 'nte', tz: 'Etc/GMT+5' }),
      ],
      resources: [
        makeResource({
          id: 'cs',
          gameId: 'nte',
          name: 'City Stamina',
          cap: 700,
          kind: 'weekly',
          reserveCap: 1000,
          reserveLabel: 'City Stamina Reserve',
        }),
        makeResource({
          id: 'own',
          gameId: 'nte',
          name: 'City Stamina',
          cap: 700,
          reserveCap: 50,
          reserveLabel: 'Mine',
        }),
        makeResource({
          id: 'px',
          gameId: 'nte',
          name: 'Character Pixels',
          reserveCap: 2400,
          reserveLabel: 'Photo Paper Supply',
        }),
      ],
    });

  it('moves the Europe server to fixed UTC+1 and takes off the City Stamina reserve', () => {
    const migrated = migrateState(nte()) as AppState;
    expect(migrated.games.find((row) => row.id === 'nte')).toMatchObject({ tz: 'Etc/GMT-1', updatedAt: 6 });
    expect(migrated.games.find((row) => row.id === 'na')?.tz).toBe('Etc/GMT+5');
    const byId = (id: string) => migrated.resources.find((row) => row.id === id)!;
    expect(byId('cs').reserveCap).toBe(0);
    expect(byId('cs').reserveLabel).toBeUndefined();
    expect(byId('own')).toMatchObject({ reserveCap: 50, reserveLabel: 'Mine' });
    expect(byId('px')).toMatchObject({ reserveCap: 2400, reserveLabel: 'Photo Paper Supply' });
  });

  it('upgrades every device identically', () => {
    expect(migrateState(nte())).toEqual(migrateState(nte()));
  });
});

describe('content normalizers', () => {
  it('run on current documents without a schema bump, and leave untouched input as is', () => {
    const current = makeState();
    expect(current.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(CURRENT_SCHEMA_VERSION).toBe(13);
    expect(migrateState(current)).toBe(current);
    expect(normalizeContent(current)).toBe(current);
    expect(normalizeContent(null)).toBeNull();
  });
  it('are idempotent and deterministic', () => {
    // A stand-in fix shaped like a real one: rename a shipped row once, stamped from the row itself.
    const rename = (raw: unknown) => {
      const state = raw as AppState;
      if (!state.games.some((game) => game.name === 'Old')) return raw;
      return {
        ...state,
        games: state.games.map((game) =>
          game.name === 'Old' ? { ...game, name: 'New', updatedAt: game.updatedAt + 1 } : game,
        ),
      };
    };
    const raw = makeState({ games: [makeGame({ name: 'Old', updatedAt: 5 })] });
    const once = normalizeContent(raw, [rename]);
    expect(normalizeContent(once, [rename])).toBe(once);
    expect(normalizeContent(raw, [rename])).toEqual(once);
    for (const normalize of CONTENT_NORMALIZERS) {
      const first = normalizeState(normalize(makeState()));
      expect(normalizeState(normalize(first))).toEqual(first);
    }
  });
});
