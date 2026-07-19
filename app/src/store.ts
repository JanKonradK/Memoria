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
} from '@technogg/shared';
import {
  completionId,
  effectiveCountTarget,
  emptyState,
  latestSnapshots,
  mergeState,
  normalizeState,
  projectEnergy,
} from '@technogg/shared';
import { clearLocalSecrets, migrateLegacySecrets } from './secret-store';
import { uid } from './util';

const IDB_KEY = 'technogg-state';
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

function tombstone<T extends { id: string; updatedAt: number; deleted?: boolean }>(
  list: T[],
  match: (x: T) => boolean,
): T[] {
  return list.map((x) => (match(x) ? { ...x, deleted: true, updatedAt: now() } : x));
}

let persistTimer: ReturnType<typeof setTimeout> | undefined;
function persist(state: AppState): void {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    void idbSet(IDB_KEY, state);
  }, 250);
}

function announceMutation(): void {
  document.dispatchEvent(new CustomEvent('tg-mutated'));
}

export interface AppStore {
  state: AppState;
  loaded: boolean;
  loadError: string;
  syncStatus: SyncStatus;
  syncError: string;
  lastSyncAt: number | null;

  load(): Promise<void>;
  clearLocalData(): Promise<void>;
  /** Replace state (sync merge / import) without re-announcing a local mutation. */
  replaceState(next: AppState): void;
  setSyncStatus(status: SyncStatus, error?: string): void;
  mutate(fn: (s: AppState) => AppState): void;

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
  updateTask(id: string, patch: Partial<Task>): void;
  deleteTask(id: string): void;

  upsertEvent(ev: Partial<GameEvent> & { gameId: string }): void;
  deleteEvent(id: string): void;

  upsertRule(rule: Partial<AlertRule> & { type: AlertRule['type']; gameId: string | null }): void;
  clearRule(type: AlertRule['type'], gameId: string | null): void;

  addReminder(message: string, at: number, gameId: string | null): void;
  deleteReminder(id: string): void;

  updateSettings(patch: Partial<Settings>): void;
  importJson(text: string): boolean;
}

export const useApp = create<AppStore>((set, get) => ({
  state: emptyState(),
  loaded: false,
  loadError: '',
  syncStatus: 'idle',
  syncError: '',
  lastSyncAt: null,

  async load() {
    set({ loadError: '' });
    try {
      const raw = await idbGet(IDB_KEY);
      migrateLegacySecrets(raw);
      set({ state: normalizeState(raw), loaded: true, loadError: '' });
    } catch (error) {
      set({
        loaded: false,
        loadError: error instanceof Error ? error.message : 'Local data could not be opened.',
      });
    }
  },

  async clearLocalData() {
    try {
      await idbDel(IDB_KEY);
      clearLocalSecrets();
      set({ state: emptyState(), loaded: true, loadError: '' });
    } catch (error) {
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

  updateTask(id, patch) {
    get().mutate((s) => ({ ...s, tasks: patchIn(s.tasks, id, patch) }));
  },

  deleteTask(id) {
    get().mutate((s) => ({ ...s, tasks: tombstone(s.tasks, (t) => t.id === id) }));
  },

  upsertEvent(ev) {
    get().mutate((s) => {
      if (ev.id && s.events.some((e) => e.id === ev.id)) {
        return { ...s, events: patchIn(s.events, ev.id, ev) };
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
      return { ...s, events: [...s.events, item] };
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
