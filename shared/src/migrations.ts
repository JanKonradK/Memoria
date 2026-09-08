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

/** Apply the revised routines once, including existing accounts. */
function migrateRoutineDefaults(raw: unknown): unknown {
  const state = objectRecord(raw);
  if (!state || !Array.isArray(state.games) || !Array.isArray(state.tasks)) return raw;
  const changedAt = Date.now();
  const games = state.games
    .map(objectRecord)
    .filter((game): game is Record<string, unknown> => Boolean(game && !game.deleted));
  const gamePresets = new Map(
    games.map((game) => [
      game.id,
      presetForGame({
        name: String(game.name ?? ''),
        short: String(game.short ?? ''),
        presetKey: typeof game.presetKey === 'string' ? game.presetKey : undefined,
      })?.key,
    ]),
  );
  const completions = Array.isArray(state.completions) ? state.completions.map(objectRecord) : [];
  const tasks = state.tasks.map((rawTask) => {
    const task = objectRecord(rawTask);
    if (!task || task.deleted) return rawTask;
    const game = gamePresets.get(task.gameId);
    const matches = (key: string, name: string) =>
      task.presetTaskKey === key || (!task.presetTaskKey && task.name === name);
    const updatedAt = Math.max(changedAt, Number(task.updatedAt ?? 0) + 1);
    if (game === 'nte' && matches('nte-mews-flash', 'Mews Flash lottery') && task.name === 'Mews Flash lottery') {
      return { ...task, deleted: true, updatedAt };
    }
    if (game !== 'genshin') return rawTask;
    if (
      (matches('genshin-commissions', 'Daily Commissions ×4') && task.countTarget === 4) ||
      (matches('genshin-random-events', 'Random Events ×10') && task.countTarget === 10)
    ) {
      if (task.mode !== 'count') return rawTask;
      const next: Record<string, unknown> = { ...task, mode: 'check', updatedAt };
      delete next.countTarget;
      return next;
    }
    const minutes = matches('genshin-parametric', 'Parametric Transformer')
      ? 9_960
      : matches('genshin-crystalfly', 'Crystalfly Trap (Crystal Cores)')
        ? 10_080
        : null;
    if (minutes == null || (task.mode !== undefined && task.mode !== 'check') || task.timerDurationMinutes != null)
      return rawTask;
    const lastUse = completions
      .filter((row) => row != null && row.taskId === task.id && row.done)
      .reduce((latest, row) => Math.max(latest, Number(row?.updatedAt ?? 0)), 0);
    return {
      ...task,
      mode: 'timer',
      timerDurationMinutes: minutes,
      timerStepMinutes: 720,
      timelineLinked: false,
      timerEndsAt: task.timerEndsAt ?? (lastUse ? lastUse + minutes * 60_000 : null),
      updatedAt,
    };
  });
  for (const game of games) {
    if (gamePresets.get(game.id) !== 'wuwa') continue;
    // A tombstone counts as present: never restore a task the player removed.
    if (
      tasks.some((rawTask) => {
        const task = objectRecord(rawTask);
        return (
          task != null &&
          task.gameId === game.id &&
          (task.presetTaskKey === 'wuwa-tacet-fields' || task.name === 'Tacet Fields ×4')
        );
      })
    )
      continue;
    tasks.push({
      id: `preset-task:${String(game.id)}:wuwa-tacet-fields`,
      gameId: game.id,
      presetTaskKey: 'wuwa-tacet-fields',
      name: 'Tacet Fields ×4',
      cadence: 'daily',
      mode: 'count',
      countTarget: 4,
      intervalDays: 1,
      anchorAt: changedAt,
      core: false,
      sort: 1,
      updatedAt: changedAt,
    });
  }
  const chips = Array.isArray(state.chips) ? [...state.chips] : [];
  for (const game of games) {
    if (gamePresets.get(game.id) !== 'uma') continue;
    if (
      !tasks.some((rawTask) => {
        const task = objectRecord(rawTask);
        return (
          task != null &&
          task.gameId === game.id &&
          (task.presetTaskKey === 'uma-independent-training' || task.name === 'Independent Training')
        );
      })
    ) {
      tasks.push({
        id: `preset-task:${String(game.id)}:uma-independent-training`,
        gameId: game.id,
        presetTaskKey: 'uma-independent-training',
        name: 'Independent Training',
        cadence: 'custom',
        mode: 'timer',
        timerDurationMinutes: 50,
        timerEndsAt: null,
        intervalDays: 1,
        anchorAt: changedAt,
        timelineLinked: false,
        core: false,
        sort: 0,
        updatedAt: changedAt,
      });
    }
    if (
      !chips.some((rawChip) => {
        const chip = objectRecord(rawChip);
        return chip != null && chip.gameId === game.id && chip.label === 'Independent Training';
      })
    ) {
      chips.push({
        id: `preset-chip:${String(game.id)}:uma-independent-training`,
        gameId: game.id,
        label: 'Independent Training',
        delta: -30,
        sort: 0,
        updatedAt: changedAt,
      });
    }
  }
  return { ...state, tasks, chips };
}

/** Keys are source versions; each migration advances its input by one version. */
export const MIGRATIONS: Readonly<Record<number, StateMigration>> = {
  3: migrateGenshinPalette,
  4: stripResourceIcons,
  5: stripGameCardDisplayToggles,
  6: migrateCrystalflyTrapTimer,
  7: migrateRoutineDefaults,
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

/** Seed energy clocks at zero and untouched weekly stock at its full cap. */
export function seedMissingRegenSnapshots(state: AppState, takenAt: number, createId: () => string): AppState {
  const resourcesWithSnapshots = new Set(state.snapshots.map((snapshot) => snapshot.resourceId));
  const seeded: Snapshot[] = [];

  for (const resource of state.resources) {
    const kind = effectiveResourceKind(resource);
    if (resource.deleted || !['regen', 'weekly'].includes(kind) || resourcesWithSnapshots.has(resource.id)) {
      continue;
    }
    seeded.push({ id: createId(), resourceId: resource.id, value: kind === 'weekly' ? resource.cap : 0, takenAt });
    resourcesWithSnapshots.add(resource.id);
  }

  return seeded.length > 0 ? { ...state, snapshots: [...state.snapshots, ...seeded] } : state;
}
