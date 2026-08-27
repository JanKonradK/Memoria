import { describe, expect, it } from 'vitest';
import { projectEnergy } from '../src/energy';
import { migrateState, seedMissingRegenSnapshots } from '../src/migrations';
import { normalizeState } from '../src/merge';
import { CURRENT_SCHEMA_VERSION, type AppState } from '../src/types';
import { safeParseAppState } from '../src/validation';
import { makeGame, makeResource, makeSnapshot, makeState, makeTask } from './helpers';

describe('migrateState', () => {
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
    expect(migrated.tasks.find((task) => task.id === 'custom-check')?.mode).toBe('check');
    expect(migrated.tasks.find((task) => task.id === 'custom-count')?.mode).toBe('count');
    expect(migrated.tasks.find((task) => task.id === 'other-game')?.mode).toBeUndefined();
  });
});

describe('seedMissingRegenSnapshots', () => {
  it('seeds only missing regen resources and is idempotent', () => {
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
      realSnapshot,
      { id: 'seed-1', resourceId: 'missing-reading', value: 0, takenAt: seenAt },
    ]);
    expect(once.snapshots[0]).toBe(normalized.snapshots[0]);
    expect(twice).toBe(once);
    expect(idCalls).toBe(1);
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
