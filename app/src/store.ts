import { create } from 'zustand';
import { get as idbGet, set as idbSet } from 'idb-keyval';
import type {
  AlertRule,
  AppState,
  Cadence,
  FocusItem,
  Game,
  GameEvent,
  GamePreset,
  Reminder,
  Resource,
  Settings,
  Purchase,
  Task,
  Team,
  Wallet,
} from '@technogg/shared';
import { completionId, emptyState, latestSnapshots, mergeState, normalizeState, projectEnergy } from '@technogg/shared';
import { uid } from './util';

const IDB_KEY = 'technogg-state';
/** Matches the merge-side retention; generous so waste stats can look back weeks. */
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
  syncStatus: SyncStatus;
  syncError: string;
  lastSyncAt: number | null;

  load(): Promise<void>;
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

  setEnergy(resourceId: string, value: number): void;
  adjustEnergy(resourceId: string, delta: number): void;

  setTaskDone(taskId: string, periodKey: string, done: boolean): void;
  addTask(gameId: string, name: string, cadence: Cadence, intervalDays?: number): void;
  updateTask(id: string, patch: Partial<Task>): void;
  deleteTask(id: string): void;

  upsertEvent(ev: Partial<GameEvent> & { gameId: string }): void;
  deleteEvent(id: string): void;

  upsertRule(rule: Partial<AlertRule> & { type: AlertRule['type']; gameId: string | null }): void;

  addReminder(message: string, at: number, gameId: string | null): void;
  deleteReminder(id: string): void;

  addFocus(gameId: string, name: string): void;
  updateFocus(id: string, patch: Partial<FocusItem>): void;
  deleteFocus(id: string): void;
  /** Swap with the previous/next live focus item of the same game. */
  moveFocus(id: string, dir: -1 | 1): void;

  addTeam(gameId: string, name: string): void;
  updateTeam(id: string, patch: Partial<Team>): void;
  deleteTeam(id: string): void;

  /** Create-or-patch the game's wallet (id = gameId). */
  upsertWallet(gameId: string, patch: Partial<Wallet>): void;
  addPurchase(gameId: string, name: string, cycleDays: number): void;
  updatePurchase(id: string, patch: Partial<Purchase>): void;
  deletePurchase(id: string): void;
  /** Extend expiry by one cycle (from now if already lapsed). */
  renewPurchase(id: string): void;

  updateSettings(patch: Partial<Settings>): void;
  importJson(text: string): boolean;
}

export const useApp = create<AppStore>((set, get) => ({
  state: emptyState(),
  loaded: false,
  syncStatus: 'idle',
  syncError: '',
  lastSyncAt: null,

  async load() {
    const raw = await idbGet(IDB_KEY);
    set({ state: normalizeState(raw), loaded: true });
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
        { id: uid(), gameId, name: 'Energy', icon: 'bolt', cap: 100, regenMinutes: 6, reserveCap: 0, sort: 0, updatedAt: t },
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
        sort: res.sort ?? s.resources.filter((r) => r.gameId === res.gameId).length,
        updatedAt: now(),
      };
      return { ...s, resources: [...s.resources, item] };
    });
  },

  deleteResource(id) {
    get().mutate((s) => ({ ...s, resources: tombstone(s.resources, (r) => r.id === id) }));
  },

  setEnergy(resourceId, value) {
    get().mutate((s) => {
      const snap = { id: uid(), resourceId, value: Math.max(0, Math.round(value)), takenAt: now() };
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
    if (!res) return;
    const proj = projectEnergy(res, latestSnapshots(s.snapshots).get(resourceId), now());
    get().setEnergy(resourceId, Math.max(0, proj.value + delta));
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

  addReminder(message, at, gameId) {
    get().mutate((s) => ({
      ...s,
      reminders: [...s.reminders, { id: uid(), gameId, message, at, updatedAt: now() } satisfies Reminder],
    }));
  },

  deleteReminder(id) {
    get().mutate((s) => ({ ...s, reminders: tombstone(s.reminders, (r) => r.id === id) }));
  },

  addFocus(gameId, name) {
    get().mutate((s) => ({
      ...s,
      focus: [
        ...s.focus,
        {
          id: uid(),
          gameId,
          name,
          note: '',
          done: false,
          sort: Math.max(0, ...s.focus.filter((f) => f.gameId === gameId).map((f) => f.sort + 1)),
          updatedAt: now(),
        },
      ],
    }));
  },

  updateFocus(id, patch) {
    get().mutate((s) => ({ ...s, focus: patchIn(s.focus, id, patch) }));
  },

  deleteFocus(id) {
    get().mutate((s) => ({ ...s, focus: tombstone(s.focus, (f) => f.id === id) }));
  },

  addTeam(gameId, name) {
    get().mutate((s) => ({
      ...s,
      teams: [
        ...s.teams,
        {
          id: uid(),
          gameId,
          name,
          members: [],
          sort: Math.max(0, ...s.teams.filter((t) => t.gameId === gameId).map((t) => t.sort + 1)),
          updatedAt: now(),
        },
      ],
    }));
  },

  updateTeam(id, patch) {
    get().mutate((s) => ({ ...s, teams: patchIn(s.teams, id, patch) }));
  },

  deleteTeam(id) {
    get().mutate((s) => ({ ...s, teams: tombstone(s.teams, (t) => t.id === id) }));
  },

  upsertWallet(gameId, patch) {
    get().mutate((s) => {
      const existing = s.wallets.find((w) => w.id === gameId);
      if (existing) return { ...s, wallets: patchIn(s.wallets, gameId, patch) };
      const t = now();
      const wallet: Wallet = {
        id: gameId,
        gameId,
        balance: 0,
        balanceAt: t,
        dailyIncome: 60,
        pullCost: 160,
        nextPatchAt: null,
        patchDays: 42,
        updatedAt: t,
        ...patch,
      };
      return { ...s, wallets: [...s.wallets, wallet] };
    });
  },

  addPurchase(gameId, name, cycleDays) {
    const t = now();
    get().mutate((s) => ({
      ...s,
      purchases: [
        ...s.purchases,
        { id: uid(), gameId, name, cycleDays, expiresAt: t + cycleDays * 86_400_000, notify: true, updatedAt: t },
      ],
    }));
  },

  updatePurchase(id, patch) {
    get().mutate((s) => ({ ...s, purchases: patchIn(s.purchases, id, patch) }));
  },

  deletePurchase(id) {
    get().mutate((s) => ({ ...s, purchases: tombstone(s.purchases, (p) => p.id === id) }));
  },

  renewPurchase(id) {
    const t = now();
    get().mutate((s) => ({
      ...s,
      purchases: s.purchases.map((p) =>
        p.id === id ? { ...p, expiresAt: Math.max(t, p.expiresAt) + p.cycleDays * 86_400_000, updatedAt: t } : p,
      ),
    }));
  },

  moveFocus(id, dir) {
    get().mutate((s) => {
      const item = s.focus.find((f) => f.id === id);
      if (!item) return s;
      const siblings = s.focus.filter((f) => f.gameId === item.gameId && !f.deleted).sort((a, b) => a.sort - b.sort);
      const i = siblings.findIndex((f) => f.id === id);
      const other = siblings[i + dir];
      if (!other) return s;
      const t = now();
      return {
        ...s,
        focus: s.focus.map((f) =>
          f.id === item.id ? { ...f, sort: other.sort, updatedAt: t } : f.id === other.id ? { ...f, sort: item.sort, updatedAt: t } : f,
        ),
      };
    });
  },

  updateSettings(patch) {
    get().mutate((s) => ({ ...s, settings: { ...s.settings, ...patch, updatedAt: now() } }));
  },

  importJson(text) {
    try {
      const incoming = normalizeState(JSON.parse(text));
      get().mutate((s) => mergeState(s, incoming));
      return true;
    } catch {
      return false;
    }
  },
}));
