import type { AppState, Snapshot } from './types';
import { CURRENT_SCHEMA_VERSION } from './types';
import { presetForGame } from './presets';
import { effectiveResourceKind } from './tracking';

export type StateMigration = (raw: unknown) => unknown;

function objectRecord(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
}

function migrateGenshinPalette(raw: unknown): unknown {
  const state = objectRecord(raw);
  if (!state || !Array.isArray(state.games)) return raw;
  let changed = false;
  const games = state.games.map((item) => {
    const game = objectRecord(item);
    if (!game) return item;
    const preset = presetForGame({
      name: typeof game.name === 'string' ? game.name : '',
      short: typeof game.short === 'string' ? game.short : '',
      presetKey: typeof game.presetKey === 'string' ? game.presetKey : undefined,
    });
    if (preset?.key !== 'genshin') return item;

    // Both earlier Genshin palettes: the Mora gold this migration replaces, and
    // the near-white it replaced before that — a legacy document can still be
    // sitting on either, and all three accounts have to end up on one pair.
    const oldPalette = typeof game.color === 'string' && ['#8d6f26', '#fefef3'].includes(game.color.toLowerCase());
    const missingTitleFont = typeof game.titleFont !== 'string' || game.titleFont.trim() === '';
    if (!oldPalette && !missingTitleFont) return item;
    changed = true;
    return {
      ...game,
      ...(oldPalette ? { color: '#f8efdb', color2: '#d8c9b4' } : {}),
      ...(missingTitleFont ? { titleFont: "'Cinzel', serif" } : {}),
    };
  });
  return changed ? { ...state, games } : raw;
}

function stripResourceIcons(raw: unknown): unknown {
  const state = objectRecord(raw);
  if (!state || !Array.isArray(state.resources)) return raw;
  let changed = false;
  const resources = state.resources.map((item) => {
    const resource = objectRecord(item);
    if (!resource || !('icon' in resource)) return item;
    const clean = { ...resource };
    delete clean.icon;
    changed = true;
    return clean;
  });
  return changed ? { ...state, resources } : raw;
}

function stripGameCardDisplayToggles(raw: unknown): unknown {
  const state = objectRecord(raw);
  if (!state || !Array.isArray(state.games)) return raw;
  let changed = false;
  const games = state.games.map((item) => {
    const game = objectRecord(item);
    if (!game || (!('hideProgressRing' in game) && !('hideEventStrip' in game))) return item;
    const clean = { ...game };
    delete clean.hideProgressRing;
    delete clean.hideEventStrip;
    changed = true;
    return clean;
  });
  return changed ? { ...state, games } : raw;
}

function migrateCrystalflyTrapTimer(raw: unknown): unknown {
  const state = objectRecord(raw);
  if (!state || !Array.isArray(state.games) || !Array.isArray(state.tasks)) return raw;
  const genshinGameIds = new Set(
    state.games.flatMap((item) => {
      const game = objectRecord(item);
      if (!game || typeof game.id !== 'string') return [];
      const preset = presetForGame({
        name: typeof game.name === 'string' ? game.name : '',
        short: typeof game.short === 'string' ? game.short : '',
        presetKey: typeof game.presetKey === 'string' ? game.presetKey : undefined,
      });
      return preset?.key === 'genshin' ? [game.id] : [];
    }),
  );
  let changed = false;
  const tasks = state.tasks.map((item) => {
    const task = objectRecord(item);
    if (
      !task ||
      task.name !== 'Crystalfly Trap (Crystal Cores)' ||
      typeof task.gameId !== 'string' ||
      !genshinGameIds.has(task.gameId) ||
      task.mode !== undefined
    ) {
      return item;
    }
    changed = true;
    return {
      ...task,
      mode: 'timer',
      timerDurationMinutes: 10_080,
      timerStepMinutes: 720,
      timerEndsAt: null,
    };
  });
  return changed ? { ...state, tasks } : raw;
}

/** Keys are source versions; each migration advances its input by one version. */
export const MIGRATIONS: Readonly<Record<number, StateMigration>> = {
  3: migrateGenshinPalette,
  4: stripResourceIcons,
  5: stripGameCardDisplayToggles,
  6: migrateCrystalflyTrapTimer,
};

/**
 * Schema versions 1 -> 2 and 2 -> 3 were migrated implicitly by
 * inferLegacyResource and inferLegacyTask during normalization.
 */
export function migrateState(raw: unknown): unknown {
  let state = raw;
  const record = objectRecord(state);
  if (!record) return raw;
  let version =
    typeof record.schemaVersion === 'number' && Number.isInteger(record.schemaVersion) && record.schemaVersion >= 1
      ? record.schemaVersion
      : 1;

  while (version < CURRENT_SCHEMA_VERSION) {
    state = MIGRATIONS[version]?.(state) ?? state;
    const migrated = objectRecord(state);
    if (!migrated) return state;
    version += 1;
    state = { ...migrated, schemaVersion: version };
  }
  return state;
}

/** Seed clocks that predate automatic zero snapshots. */
export function seedMissingRegenSnapshots(state: AppState, takenAt: number, createId: () => string): AppState {
  const resourcesWithSnapshots = new Set(state.snapshots.map((snapshot) => snapshot.resourceId));
  const seeded: Snapshot[] = [];

  for (const resource of state.resources) {
    if (resource.deleted || effectiveResourceKind(resource) !== 'regen' || resourcesWithSnapshots.has(resource.id)) {
      continue;
    }
    seeded.push({ id: createId(), resourceId: resource.id, value: 0, takenAt });
    resourcesWithSnapshots.add(resource.id);
  }

  return seeded.length > 0 ? { ...state, snapshots: [...state.snapshots, ...seeded] } : state;
}
