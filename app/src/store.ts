import { create } from 'zustand';
import { del as idbDel, get as idbGet, set as idbSet } from 'idb-keyval';
import type {
  AlertRule,
  AppState,
  Cadence,
  Game,
  GameEvent,
  GamePreset,
  Reminder,
  Resource,
  Settings,
  SettingsField,
  QuickChip,
  Task,
} from '@void/shared';
import {
  completionId,
  COMPLETION_RETENTION_MS,
  effectiveCountTarget,
  emptyState,
  latestSnapshots,
  mergeState,
  normalizeState,
  pruneCompletions,
  projectEnergy,
  missingPresetTasks,
} from '@void/shared';
import { clearLocalSecrets, migrateLegacySecrets, setLocalSecretsIdentity } from './secret-store';
import { storageKeyForIdentity } from './storage-identity';
import { uid } from './util';

const IDB_KEY = 'void-state';
const LEGACY_IDB_KEY = 'technogg-state';
/** Matches the merge-side retention. */
const SNAPSHOTS_KEPT = 200;

type SyncStatus = 'idle' | 'syncing' | 'ok' | 'error';

function now(): number {
  return Date.now();
}

function upsert<T extends { id: string }>(list: T[], item: T): T[] {
  const i = list.findIndex((x) => x.id === item.id);
  if (i < 0) return [...list, item];
  const next = list.slice();
  next[i] = item;
  return next;
}

function patchIn<T extends { id: string; updatedAt: number }>(list: T[], id: string, patch: Partial<T>): T[] {
  return list.map((x) => (x.id === id ? { ...x, ...patch, updatedAt: now() } : x));
}

type EventUpsert = Partial<GameEvent> & { gameId: string };

function applyEventUpsert(byId: Map<string, GameEvent>, ev: EventUpsert): void {
  if (ev.id) {
    const existing = byId.get(ev.id);
    if (existing) {
      byId.set(ev.id, { ...existing, ...ev, updatedAt: now() });
      return;
    }
  }
  const t = now();
  const item: GameEvent = {
    id: ev.id ?? uid(),
    gameId: ev.gameId,
    name: ev.name ?? 'Event',
    type: ev.type ?? 'event',
    start: ev.start ?? t,
    end: ev.end ?? t + 7 * 86_400_000,
    dailyTouch: ev.dailyTouch ?? false,
    notify: ev.notify ?? true,
    notes: ev.notes ?? '',
    sourceKey: ev.sourceKey,
    updatedAt: t,
  };
  byId.set(item.id, item);
}

function applyUpsertEvent(s: AppState, ev: EventUpsert): AppState {
  const byId = new Map(s.events.map((event) => [event.id, event]));
  applyEventUpsert(byId, ev);
  return { ...s, events: [...byId.values()] };
}

function tombstone<T extends { id: string; updatedAt: number; deleted?: boolean }>(
  list: T[],
  match: (x: T) => boolean,
): T[] {
  return list.map((x) => (match(x) ? { ...x, deleted: true, updatedAt: now() } : x));
}

let activeIdentity: string | null = null;
let activeIdbKey: string | null = null;
let activeLegacyIdbKey: string | null = null;
let identityRevision = 0;
let persistTimer: ReturnType<typeof setTimeout> | undefined;
let pendingPersist: { key: string; state: AppState } | null = null;

export function getActiveIdentity(): string | null {
  return activeIdentity;
}

export function getIdentityRevision(): number {
  return identityRevision;
}

function persist(state: AppState): void {
  const key = activeIdbKey;
  if (!key) return;
  clearTimeout(persistTimer);
  pendingPersist = { key, state };
  persistTimer = setTimeout(() => {
    void flushPersist().catch(() => undefined);
  }, 120);
}

/**
 * Flush the pending IndexedDB write on lifecycle boundaries. IndexedDB has no
 * synchronous API, so an instant process kill still leaves a small residual loss window.
 */
export async function flushPersist(): Promise<void> {
  clearTimeout(persistTimer);
  persistTimer = undefined;
  const pending = pendingPersist;
  pendingPersist = null;
  if (pending) await idbSet(pending.key, pending.state);
}

function stateForStorage(raw: unknown): { state: AppState; pruned: boolean } {
  const normalized = normalizeState(raw);
  const state = pruneCompletions(normalized, now() - COMPLETION_RETENTION_MS);
  return { state, pruned: state.completions.length !== normalized.completions.length };
}

async function readStoredState(key: string, legacyKey: string | null): Promise<unknown> {
  const existing = await idbGet(key);
  if (existing !== undefined || !legacyKey || legacyKey === key) return existing;

  const legacy = await idbGet(legacyKey);
  if (legacy === undefined) return undefined;

  // Re-check immediately before writing so an already-created Void value wins.
  const current = await idbGet(key);
  if (current !== undefined) return current;

  await idbSet(key, legacy);
  const migrated = await idbGet(key);
  if (migrated !== undefined) {
    try {
      await idbDel(legacyKey);
    } catch {
      // The new copy is durable; leaving the old copy makes a later cleanup retry safe.
    }
  }
  return migrated;
}

function announceMutation(): void {
  document.dispatchEvent(new CustomEvent('tg-mutated'));
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  window.addEventListener('pagehide', () => {
    void flushPersist().catch(() => undefined);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) void flushPersist().catch(() => undefined);
  });
}

export interface AppStore {
  identity: string | null;
  state: AppState;
  loaded: boolean;
  loadError: string;
  syncStatus: SyncStatus;
  syncError: string;
  lastSyncAt: number | null;

  setIdentity(identity: string): Promise<void>;
  load(): Promise<void>;
  clearLocalData(): Promise<void>;
  /** Replace state (sync merge / import) without re-announcing a local mutation. */
  replaceState(next: AppState): void;
  setSyncStatus(status: SyncStatus, error?: string): void;
  mutate(fn: (s: AppState) => AppState): void;
  batch(fn: (s: AppState) => AppState): void;

  addGameFromPreset(preset: GamePreset, over: { tz?: string; capOverrides?: Record<number, number> }): string;
  addBlankGame(name: string): string;
  updateGame(id: string, patch: Partial<Game>): void;
  deleteGame(id: string): void;

  upsertResource(res: Partial<Resource> & { gameId: string }): void;
  deleteResource(id: string): void;
  upsertChip(chip: Partial<QuickChip> & { gameId: string }): void;
  deleteChip(id: string): void;

  setEnergy(resourceId: string, value: number, reserve?: number): void;
  adjustEnergy(resourceId: string, delta: number): void;

  setTaskDone(taskId: string, periodKey: string, done: boolean): void;
  startTaskTimer(taskId: string, periodKey: string): void;
  restartTaskTimer(taskId: string, periodKey: string): void;
  setTaskCount(taskId: string, periodKey: string, countDone: number): void;
  addTask(gameId: string, name: string, cadence: Cadence, intervalDays?: number): void;
  /** Add preset tasks this game is missing (presets grow; existing games do not). */
  addMissingPresetTasks(gameId: string): number;
  /** The same, for every tracked game, in one write. */
  addMissingPresetTasksEverywhere(): number;
  updateTask(id: string, patch: Partial<Task>): void;
  deleteTask(id: string): void;

  upsertEvent(ev: EventUpsert): void;
  upsertEvents(list: EventUpsert[]): void;
  deleteEvent(id: string): void;

  upsertRule(rule: Partial<AlertRule> & { type: AlertRule['type']; gameId: string | null }): void;
  clearRule(type: AlertRule['type'], gameId: string | null): void;

  addReminder(message: string, at: number, gameId: string | null): void;
  deleteReminder(id: string): void;

  updateSettings(patch: Partial<Settings>): void;
  importJson(text: string): boolean;
}

export const useApp = create<AppStore>((set, get) => ({
  identity: null,
  state: emptyState(),
  loaded: false,
  loadError: '',
  syncStatus: 'idle',
  syncError: '',
  lastSyncAt: null,

  async setIdentity(identity) {
    if (identity === activeIdentity) return;

    await flushPersist();
    activeIdentity = identity;
    activeIdbKey = storageKeyForIdentity(IDB_KEY, identity);
    activeLegacyIdbKey = storageKeyForIdentity(LEGACY_IDB_KEY, identity);
    identityRevision += 1;
    setLocalSecretsIdentity(identity);
    set({
      identity,
      state: emptyState(),
      loaded: false,
      loadError: '',
      syncStatus: 'idle',
      syncError: '',
      lastSyncAt: null,
    });

    if (!activeIdbKey) {
      set({ loaded: true });
      return;
    }

    const key = activeIdbKey;
    const legacyKey = activeLegacyIdbKey;
    const revision = identityRevision;
    try {
      const raw = await readStoredState(key, legacyKey);
      if (revision !== identityRevision) return;
      migrateLegacySecrets(raw, identity);
      const stored = stateForStorage(raw);
      set({ state: stored.state, loaded: true, loadError: '' });
      if (stored.pruned) persist(stored.state);
    } catch (error) {
      if (revision !== identityRevision) return;
      set({
        loaded: false,
        loadError: error instanceof Error ? error.message : 'Local data could not be opened.',
      });
    }
  },

  async load() {
    const identity = activeIdentity;
    const key = activeIdbKey;
    const legacyKey = activeLegacyIdbKey;
    const revision = identityRevision;
    set({ loadError: '' });
    if (!identity) return;
    if (!key) {
      set({ state: emptyState(), loaded: true });
      return;
    }
    try {
      const raw = await readStoredState(key, legacyKey);
      if (revision !== identityRevision) return;
      migrateLegacySecrets(raw, identity);
      const stored = stateForStorage(raw);
      set({ state: stored.state, loaded: true, loadError: '' });
      if (stored.pruned) persist(stored.state);
    } catch (error) {
      if (revision !== identityRevision) return;
      set({
        loaded: false,
        loadError: error instanceof Error ? error.message : 'Local data could not be opened.',
      });
    }
  },

  async clearLocalData() {
    const identity = activeIdentity;
    const key = activeIdbKey;
    const legacyKey = activeLegacyIdbKey;
    const revision = identityRevision;
    clearTimeout(persistTimer);
    persistTimer = undefined;
    pendingPersist = null;
    try {
      if (key) await idbDel(key);
      if (legacyKey && legacyKey !== key) await idbDel(legacyKey);
      if (identity) clearLocalSecrets(identity);
      if (revision !== identityRevision) return;
      set({ state: emptyState(), loaded: true, loadError: '' });
    } catch (error) {
      if (revision !== identityRevision) return;
      set({ loadError: error instanceof Error ? error.message : 'Local data could not be cleared.' });
    }
  },

  replaceState(next) {
    persist(next);
    set({ state: next });
  },

  setSyncStatus(status, error = '') {
    set({ syncStatus: status, syncError: error, ...(status === 'ok' ? { lastSyncAt: now() } : {}) });
  },

  mutate(fn) {
    get().batch(fn);
  },

  batch(fn) {
    const next = fn(get().state);
    persist(next);
    set({ state: next });
    announceMutation();
  },

  addGameFromPreset(preset, over) {
    const gameId = uid();
    const t = now();
    get().mutate((s) => {
      const maxSort = Math.max(0, ...s.games.map((g) => g.sort + 1));
      const game: Game = {
        id: gameId,
        name: preset.name,
        short: preset.short,
        color: preset.color,
        color2: preset.color2,
        titleFont: preset.titleFont,
        icon: preset.icon,
        platform: preset.platform,
        tz: over.tz ?? preset.tz,
        dailyResetHour: preset.dailyResetHour,
        weeklyResetDay: preset.weeklyResetDay,
        monthlyResetDay: preset.monthlyResetDay,
        paused: false,
        sort: maxSort,
        notes: preset.notes,
        processNames: preset.processNames,
        updatedAt: t,
      };
      const resources: Resource[] = preset.resources.map((r, i) => ({
        id: uid(),
        gameId,
        name: r.name,
        icon: r.icon,
        cap: over.capOverrides?.[i] ?? r.cap,
        regenMinutes: r.regenMinutes,
        reserveCap: r.reserveCap,
        reserveRegenMinutes: r.reserveRegenMinutes,
        kind: r.kind,
        reserveLabel: r.reserveLabel,
        sort: i,
        updatedAt: t,
      }));
      const tasks: Task[] = preset.tasks.map((tk, i) => ({
        id: uid(),
        gameId,
        name: tk.name,
        cadence: tk.cadence,
        intervalDays: tk.intervalDays ?? 1,
        anchorAt: t,
        mode: tk.mode,
        timerDurationMinutes: tk.timerDurationMinutes,
        countTarget: tk.countTarget,
        timerEndsAt: tk.mode === 'timer' ? null : undefined,
        sort: i,
        updatedAt: t,
      }));
      return {
        ...s,
        games: [...s.games, game],
        resources: [...s.resources, ...resources],
        tasks: [...s.tasks, ...tasks],
      };
    });
    return gameId;
  },

  addBlankGame(name) {
    const gameId = uid();
    const t = now();
    get().mutate((s) => ({
      ...s,
      games: [
        ...s.games,
        {
          id: gameId,
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
          sort: Math.max(0, ...s.games.map((g) => g.sort + 1)),
          updatedAt: t,
        },
      ],
      resources: [
        ...s.resources,
        {
          id: uid(),
          gameId,
          name: 'Energy',
          icon: 'bolt',
          cap: 100,
          regenMinutes: 6,
          reserveCap: 0,
          sort: 0,
          updatedAt: t,
        },
      ],
    }));
    return gameId;
  },

  updateGame(id, patch) {
    get().mutate((s) => ({ ...s, games: patchIn(s.games, id, patch) }));
  },

  deleteGame(id) {
    get().mutate((s) => ({
      ...s,
      games: tombstone(s.games, (g) => g.id === id),
      resources: tombstone(s.resources, (r) => r.gameId === id),
      tasks: tombstone(s.tasks, (t) => t.gameId === id),
      chips: tombstone(s.chips, (c) => c.gameId === id),
      events: tombstone(s.events, (e) => e.gameId === id),
    }));
  },

  upsertResource(res) {
    get().mutate((s) => {
      if (res.id && s.resources.some((r) => r.id === res.id)) {
        return { ...s, resources: patchIn(s.resources, res.id, res) };
      }
      const item: Resource = {
        id: res.id ?? uid(),
        gameId: res.gameId,
        name: res.name ?? 'Energy',
        icon: res.icon ?? 'bolt',
        cap: res.cap ?? 100,
        regenMinutes: res.regenMinutes ?? 6,
        reserveCap: res.reserveCap ?? 0,
        reserveRegenMinutes: res.reserveRegenMinutes,
        kind: res.kind,
        reserveLabel: res.reserveLabel,
        sort: res.sort ?? s.resources.filter((r) => r.gameId === res.gameId).length,
        updatedAt: now(),
      };
      return { ...s, resources: [...s.resources, item] };
    });
  },

  deleteResource(id) {
    get().mutate((s) => ({ ...s, resources: tombstone(s.resources, (r) => r.id === id) }));
  },

  upsertChip(chip) {
    get().mutate((s) => {
      if (chip.id && s.chips.some((c) => c.id === chip.id)) {
        return { ...s, chips: patchIn(s.chips, chip.id, chip) };
      }
      const item: QuickChip = {
        id: chip.id ?? uid(),
        gameId: chip.gameId,
        label: chip.label ?? 'Spend',
        delta: chip.delta ?? -20,
        sort: chip.sort ?? s.chips.filter((c) => c.gameId === chip.gameId && !c.deleted).length,
        updatedAt: now(),
      };
      return { ...s, chips: [...s.chips, item] };
    });
  },

  deleteChip(id) {
    get().mutate((s) => ({ ...s, chips: tombstone(s.chips, (c) => c.id === id) }));
  },

  setEnergy(resourceId, value, reserve) {
    get().mutate((s) => {
      const res = s.resources.find((item) => item.id === resourceId && !item.deleted);
      if (!res) return s;
      const clamped = Math.min(res.cap, Math.max(0, Math.round(value)));
      const clampedReserve =
        reserve != null && res.reserveCap > 0 ? Math.min(res.reserveCap, Math.max(0, Math.round(reserve))) : undefined;
      const snap = {
        id: uid(),
        resourceId,
        value: clamped,
        takenAt: now(),
        ...(clampedReserve != null ? { reserve: clampedReserve } : {}),
      };
      const mine = s.snapshots.filter((x) => x.resourceId === resourceId);
      mine.sort((a, b) => b.takenAt - a.takenAt);
      const keep = new Set(mine.slice(0, SNAPSHOTS_KEPT - 1).map((x) => x.id));
      return {
        ...s,
        snapshots: [...s.snapshots.filter((x) => x.resourceId !== resourceId || keep.has(x.id)), snap],
      };
    });
  },

  adjustEnergy(resourceId, delta) {
    const s = get().state;
    const res = s.resources.find((r) => r.id === resourceId);
    const game = s.games.find((g) => g.id === res?.gameId);
    if (!res) return;
    const snap = latestSnapshots(s.snapshots).get(resourceId);
    const proj = projectEnergy(res, snap, now(), game);
    const next = Math.max(0, Math.min(res.cap, proj.value + delta));
    // Persist the PROJECTED reserve, not the snapshot's — reserve keeps growing
    // while the bar is capped and a quick adjustment must not roll it back.
    get().setEnergy(resourceId, next, proj.reserve ?? snap?.reserve);
  },

  setTaskDone(taskId, periodKey, done) {
    get().mutate((s) => ({
      ...s,
      completions: upsert(s.completions, {
        id: completionId(taskId, periodKey),
        taskId,
        periodKey,
        done,
        updatedAt: now(),
      }),
    }));
  },

  startTaskTimer(taskId, periodKey) {
    const t = now();
    const task = get().state.tasks.find((item) => item.id === taskId);
    if (!task) return;
    const duration = (task.timerDurationMinutes ?? 20 * 60) * 60_000;
    get().mutate((s) => ({
      ...s,
      tasks: patchIn(s.tasks, taskId, { timerEndsAt: t + duration }),
      completions: upsert(s.completions, {
        id: completionId(taskId, periodKey),
        taskId,
        periodKey,
        done: true,
        updatedAt: t,
      }),
    }));
  },

  restartTaskTimer(taskId, periodKey) {
    const t = now();
    const task = get().state.tasks.find((item) => item.id === taskId);
    if (!task) return;
    const duration = (task.timerDurationMinutes ?? 20 * 60) * 60_000;
    get().mutate((s) => ({
      ...s,
      tasks: patchIn(s.tasks, taskId, { timerEndsAt: t + duration }),
      completions: upsert(s.completions, {
        id: completionId(taskId, periodKey),
        taskId,
        periodKey,
        done: true,
        updatedAt: t,
      }),
    }));
  },

  setTaskCount(taskId, periodKey, countDone) {
    const task = get().state.tasks.find((item) => item.id === taskId);
    const target = task ? effectiveCountTarget(task) : 1;
    const done = countDone >= target;
    get().mutate((s) => ({
      ...s,
      completions: upsert(s.completions, {
        id: completionId(taskId, periodKey),
        taskId,
        periodKey,
        done,
        countDone,
        updatedAt: now(),
      }),
    }));
  },

  addTask(gameId, name, cadence, intervalDays = 2) {
    const t = now();
    get().mutate((s) => ({
      ...s,
      tasks: [
        ...s.tasks,
        {
          id: uid(),
          gameId,
          name,
          cadence,
          intervalDays,
          anchorAt: t,
          sort: s.tasks.filter((x) => x.gameId === gameId).length,
          updatedAt: t,
        },
      ],
    }));
  },

  addMissingPresetTasks(gameId) {
    const state = get().state;
    const game = state.games.find((candidate) => candidate.id === gameId);
    if (!game) return 0;
    const existing = state.tasks.filter((task) => task.gameId === gameId);
    const missing = missingPresetTasks(game, existing);
    if (missing.length === 0) return 0;

    const t = now();
    get().mutate((s) => {
      const sortBase = Math.max(0, ...s.tasks.filter((task) => task.gameId === gameId).map((task) => task.sort + 1));
      const added: Task[] = missing.map((task, index) => ({
        id: uid(),
        gameId,
        name: task.name,
        cadence: task.cadence,
        intervalDays: task.intervalDays ?? 1,
        anchorAt: t,
        mode: task.mode,
        timerDurationMinutes: task.timerDurationMinutes,
        countTarget: task.countTarget,
        timerEndsAt: task.mode === 'timer' ? null : undefined,
        sort: sortBase + index,
        updatedAt: t,
      }));
      return { ...s, tasks: [...s.tasks, ...added] };
    });
    return missing.length;
  },

  addMissingPresetTasksEverywhere() {
    const state = get().state;
    const t = now();
    let total = 0;
    const added: Task[] = [];
    for (const game of state.games) {
      if (game.deleted) continue;
      const existing = state.tasks.filter((task) => task.gameId === game.id);
      const missing = missingPresetTasks(game, existing);
      const sortBase = Math.max(0, ...existing.map((task) => task.sort + 1));
      missing.forEach((task, index) => {
        added.push({
          id: uid(),
          gameId: game.id,
          name: task.name,
          cadence: task.cadence,
          intervalDays: task.intervalDays ?? 1,
          anchorAt: t,
          mode: task.mode,
          timerDurationMinutes: task.timerDurationMinutes,
          countTarget: task.countTarget,
          timerEndsAt: task.mode === 'timer' ? null : undefined,
          sort: sortBase + index,
          updatedAt: t,
        });
      });
      total += missing.length;
    }
    if (total === 0) return 0;
    get().mutate((s) => ({ ...s, tasks: [...s.tasks, ...added] }));
    return total;
  },

  updateTask(id, patch) {
    get().mutate((s) => ({ ...s, tasks: patchIn(s.tasks, id, patch) }));
  },

  deleteTask(id) {
    get().mutate((s) => ({ ...s, tasks: tombstone(s.tasks, (t) => t.id === id) }));
  },

  upsertEvent(ev) {
    get().batch((s) => applyUpsertEvent(s, ev));
  },

  upsertEvents(list) {
    if (list.length === 0) return;
    get().batch((s) => {
      const byId = new Map(s.events.map((event) => [event.id, event]));
      for (const event of list) applyEventUpsert(byId, event);
      return { ...s, events: [...byId.values()] };
    });
  },

  deleteEvent(id) {
    get().mutate((s) => ({ ...s, events: tombstone(s.events, (e) => e.id === id) }));
  },

  upsertRule(rule) {
    get().mutate((s) => {
      const existing = s.alertRules.find((r) => r.type === rule.type && r.gameId === rule.gameId && !r.deleted);
      if (existing) {
        return { ...s, alertRules: patchIn(s.alertRules, existing.id, rule) };
      }
      const item: AlertRule = {
        id: uid(),
        gameId: rule.gameId,
        type: rule.type,
        thresholdMinutes: rule.thresholdMinutes ?? 120,
        enabled: rule.enabled ?? true,
        updatedAt: now(),
      };
      return { ...s, alertRules: [...s.alertRules, item] };
    });
  },

  clearRule(type, gameId) {
    get().mutate((s) => ({
      ...s,
      alertRules: tombstone(s.alertRules, (r) => r.type === type && r.gameId === gameId && !r.deleted),
    }));
  },

  addReminder(message, at, gameId) {
    get().mutate((s) => ({
      ...s,
      reminders: [...s.reminders, { id: uid(), gameId, message, at, updatedAt: now() } satisfies Reminder],
    }));
  },

  deleteReminder(id) {
    get().mutate((s) => ({ ...s, reminders: tombstone(s.reminders, (r) => r.id === id) }));
  },

  updateSettings(patch) {
    get().mutate((s) => {
      const updatedAt = now();
      const fields = Object.keys(patch).filter(
        (field): field is SettingsField => field !== 'updatedAt' && field !== 'deleted' && field !== 'fieldUpdatedAt',
      );
      return {
        ...s,
        settings: {
          ...s.settings,
          ...patch,
          updatedAt,
          fieldUpdatedAt: {
            ...s.settings.fieldUpdatedAt,
            ...Object.fromEntries(fields.map((field) => [field, updatedAt])),
          },
        },
      };
    });
  },

  importJson(text) {
    try {
      const raw = JSON.parse(text) as unknown;
      migrateLegacySecrets(raw);
      const incoming = normalizeState(raw);
      get().mutate((s) => mergeState(s, incoming));
      return true;
    } catch {
      return false;
    }
  },
}));
