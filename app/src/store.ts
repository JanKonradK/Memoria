import { create } from 'zustand';
import { del as idbDel, get as idbGet, keys as idbKeys, set as idbSet } from 'idb-keyval';
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
} from '@memoria/shared';
import {
  completionId,
  COMPLETION_RETENTION_MS,
  effectiveCountTarget,
  emptyState,
  latestSnapshots,
  mergeState,
  normalizeState,
  pruneCompletions,
  safeParseAppState,
  seedMissingRegenSnapshots,
  projectEnergy,
  missingPresetTasks,
  presetForGame,
} from '@memoria/shared';
import { planSeedImport, SEED_UPDATED, type PlannedSeed } from './data/seed-events';
import { uid } from './util';

const IDB_KEY = 'memoria-state';
/**
 * Every key this store has shipped under, newest first. The app has been renamed
 * twice and this is the user's ONLY copy of their data — a rename that dropped
 * it would silently look like a first run.
 */
const LEGACY_IDB_KEYS = ['void-state', 'technogg-state'] as const;
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
    // Only the bundled feed sets this. A hand-made event stays unstamped, which
    // is what keeps the refresh from ever considering it its own to rewrite.
    ...(ev.seedHash === undefined ? {} : { seedHash: ev.seedHash }),
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

let persistTimer: ReturnType<typeof setTimeout> | undefined;
let pendingPersist: AppState | null = null;

function persist(state: AppState): void {
  clearTimeout(persistTimer);
  pendingPersist = state;
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
  // This is the last boundary shared by every local writer. Keeping the guard
  // here preserves debounce performance while making an invalid disk write
  // impossible even if a future mutation forgets its own range check.
  if (pending) await idbSet(IDB_KEY, normalizeState(pending));
}

function sameJson(left: unknown, right: unknown): boolean {
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

function migrateGenshinBadge(state: AppState): { state: AppState; repaired: boolean } {
  let repaired = false;
  const updatedAt = now();
  const games = state.games.map((game) => {
    if (presetForGame(game)?.key !== 'genshin') return game;
    const legacyBadge = game.short.toLowerCase() === 'gi';
    const legacyPalette = game.color.toLowerCase() === '#fefef3';
    if (!legacyBadge && !legacyPalette) return game;
    repaired = true;
    return {
      ...game,
      ...(legacyBadge ? { short: 'Genshin' } : {}),
      ...(legacyPalette ? { color: '#f8efdb', color2: '#d8c9b4' } : {}),
      updatedAt,
    };
  });
  // The cream palette shipped at the current schema version, so the versioned
  // migration cannot see it. Delete these repairs after the install base turns over.
  return repaired ? { state: { ...state, games }, repaired } : { state, repaired };
}

function stateForStorage(raw: unknown): { state: AppState; repaired: boolean } {
  const normalized = seedMissingRegenSnapshots(normalizeState(raw), now(), uid);
  const pruned = pruneCompletions(normalized, now() - COMPLETION_RETENTION_MS);
  const badgeMigrated = migrateGenshinBadge(pruned);
  const state = badgeMigrated.state;
  const parsed = safeParseAppState(raw);
  // Successful transforms matter too: future clocks and inferred legacy fields
  // are safe in memory only after repair, so leave no poisoned original on disk.
  const schemaChanged =
    raw !== undefined && (!parsed.success || !sameJson(parsed.data, raw) || !sameJson(parsed.data, normalized));
  return {
    state,
    repaired: schemaChanged || badgeMigrated.repaired || state.completions.length !== normalized.completions.length,
  };
}

function applySeedPlan(state: AppState, plan: PlannedSeed[]): AppState {
  const byId = new Map(state.events.map((event) => [event.id, event]));
  for (const item of plan) {
    // A row the bundle has withdrawn. Tombstoned rather than dropped, so the
    // withdrawal survives a merge instead of the row reappearing from a peer.
    if (item.kind === 'remove') {
      const existing = item.eventId ? byId.get(item.eventId) : undefined;
      if (existing) byId.set(existing.id, { ...existing, deleted: true, updatedAt: now() });
      continue;
    }
    // Baseline-only: record what the bundle believes without rewriting the row,
    // so an existing note or muted alert is not the price of getting stamped.
    if (item.kind === 'stamp') {
      const existing = item.eventId ? byId.get(item.eventId) : undefined;
      if (existing) byId.set(existing.id, { ...existing, seedHash: item.hash, updatedAt: now() });
      continue;
    }
    const seed = item.seed;
    if (!seed || item.start === undefined || item.end === undefined) continue;
    applyEventUpsert(byId, {
      ...(item.eventId ? { id: item.eventId } : {}),
      gameId: item.gameId,
      name: seed.name,
      type: seed.type,
      start: item.start,
      end: item.end,
      dailyTouch: seed.dailyTouch ?? false,
      notify: seed.notify ?? true,
      notes: seed.notes ?? '',
      sourceKey: seed.sourceKey,
      // Records what the bundle wrote, so the next refresh can recognise an
      // untouched row and, just as importantly, recognise an edited one.
      seedHash: item.hash,
    });
  }
  const events = [...byId.values()];
  if (state.settings.seedImportedVersion === SEED_UPDATED) return { ...state, events };
  // Record the stamp so the refresh pass does not re-apply the bundled name and
  // dates over a user's edit on every subsequent load.
  return { ...state, events, settings: { ...state.settings, seedImportedVersion: SEED_UPDATED, updatedAt: now() } };
}

/**
 * Plan against the full document. The refresh stamp is global, so scoping this
 * to one new game could mark older accounts refreshed before they get fixes.
 */
export function seedBundledEvents(state: AppState, at: number): AppState {
  const plan = planSeedImport(state, at);
  return plan.length > 0 ? applySeedPlan(state, plan) : state;
}

/** How many real games a candidate document holds — the tie-breaker below. */
export function countTrackedGames(document: unknown): number {
  if (!document || typeof document !== 'object') return 0;
  const games = (document as { games?: unknown }).games;
  if (!Array.isArray(games)) return 0;
  return games.filter((game) => game && typeof game === 'object' && !(game as { deleted?: boolean }).deleted).length;
}

/**
 * Legacy documents this build can still adopt, richest first.
 *
 * Builds that had accounts stored each identity under a SUFFIXED key —
 * `void-state::user:<id>` — and left the bare key for local mode only. Accounts
 * are gone, but a user upgrading from one of those builds may have their only
 * copy under a suffix, and reading just the bare key would show them an empty
 * first run while their real data sat one key away. That is silent data loss,
 * so the suffixes are enumerated rather than assumed absent.
 */
async function legacyCandidates(): Promise<Array<{ key: IDBValidKey; value: unknown }>> {
  // Unscoped keys first, newest name first. The bare key is what LOCAL mode
  // wrote, and local mode is what this build is — a suffixed key belongs to a
  // signed-in identity the product no longer has a concept of. Ranking these by
  // richness instead would let a stale account document outrank the very
  // document this install has been writing all along.
  const unscoped: Array<{ key: IDBValidKey; value: unknown }> = [];
  for (const legacyKey of LEGACY_IDB_KEYS) {
    const value = await idbGet(legacyKey);
    if (value !== undefined) unscoped.push({ key: legacyKey, value });
  }

  let stored: IDBValidKey[] = [];
  try {
    stored = await idbKeys();
  } catch {
    // Enumeration is best-effort; the bare keys above are still handled.
    return unscoped;
  }

  const scoped: Array<{ key: IDBValidKey; value: unknown }> = [];
  for (const key of stored) {
    if (typeof key !== 'string') continue;
    if (!LEGACY_IDB_KEYS.some((legacyKey) => key.startsWith(`${legacyKey}::`))) continue;
    const value = await idbGet(key);
    if (value !== undefined) scoped.push({ key, value });
  }

  // Among identities there is no principled winner, so pick the fullest and
  // break ties by key — the same device then always resolves the same way.
  scoped.sort(
    (a, b) => countTrackedGames(b.value) - countTrackedGames(a.value) || String(a.key).localeCompare(String(b.key)),
  );
  return [...unscoped, ...scoped];
}

async function readStoredState(): Promise<unknown> {
  const existing = await idbGet(IDB_KEY);
  if (existing !== undefined) return existing;

  const candidates = await legacyCandidates();
  for (const candidate of candidates) {
    // Re-check immediately before writing so an already-created value wins.
    const current = await idbGet(IDB_KEY);
    if (current !== undefined) return current;

    await idbSet(IDB_KEY, candidate.value);
    const migrated = await idbGet(IDB_KEY);
    if (migrated === undefined) continue;

    // Only the key that was actually adopted is cleared. Any other identity's
    // document stays exactly where it is: it is not what this build loads, but
    // deleting someone's only copy of data we chose not to adopt is worse than
    // leaving a stale key behind.
    try {
      await idbDel(candidate.key);
    } catch {
      // The new copy is durable; leaving the old one makes a later retry safe.
    }
    return migrated;
  }
  return undefined;
}

/**
 * One-time purge of the retired local secret store.
 *
 * Discord and Telegram support is gone, but the credentials that feature kept
 * were PLAINTEXT in localStorage — a Discord webhook URL and a Telegram bot
 * token. Deleting the code without deleting the data would leave live,
 * long-lived credentials sitting on disk indefinitely for every existing user,
 * which is a worse outcome than the feature existing. Cheap and idempotent, so
 * it runs on every load rather than needing a migration flag.
 */
const RETIRED_SECRET_KEYS = ['void-local-secrets-v1', 'technogg-local-secrets-v1'];

function purgeRetiredSecrets(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    // Accounts are gone, but their identity-suffixed keys (`base::user:abc`)
    // can still be on disk from an earlier signed-in install — match those too.
    for (const key of Object.keys(localStorage)) {
      if (RETIRED_SECRET_KEYS.some((base) => key === base || key.startsWith(`${base}::`))) {
        localStorage.removeItem(key);
      }
    }
  } catch {
    // Private-mode or quota-locked storage: nothing to purge that we can reach.
  }
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
  batch(fn: (s: AppState) => AppState): void;

  addGameFromPreset(
    preset: GamePreset,
    over: {
      tz?: string;
      capOverrides?: Record<number, number>;
      name?: string;
      short?: string;
      accountLabel?: string;
    },
  ): string;
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
  advanceTaskTimer(taskId: string, periodKey: string, minutes: number): void;
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
  state: emptyState(),
  loaded: false,
  loadError: '',
  syncStatus: 'idle',
  syncError: '',
  lastSyncAt: null,

  async load() {
    set({ loadError: '' });
    purgeRetiredSecrets();
    try {
      const stored = stateForStorage(await readStoredState());
      set({ state: stored.state, loaded: true, loadError: '' });
      if (stored.repaired) persist(stored.state);
      const seedPlan = planSeedImport(get().state, now());
      if (seedPlan.length > 0) get().batch((state) => applySeedPlan(state, seedPlan));
    } catch (error) {
      set({
        loaded: false,
        loadError: error instanceof Error ? error.message : 'Local data could not be opened.',
      });
    }
  },

  async clearLocalData() {
    clearTimeout(persistTimer);
    persistTimer = undefined;
    pendingPersist = null;
    try {
      await idbDel(IDB_KEY);
      // Every legacy document, INCLUDING the identity-suffixed ones the reader
      // deliberately leaves in place. Adoption is conservative because it must
      // not destroy data; an explicit wipe is the opposite, and leaving another
      // identity's copy behind here would make "clear local data" a lie.
      for (const { key } of await legacyCandidates()) await idbDel(key);
      // The same applies to the retired notification credentials, or the one
      // action a user takes to wipe the device leaves their bot token behind.
      purgeRetiredSecrets();
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
        name: over.name ?? preset.name,
        presetKey: preset.key,
        accountLabel: over.accountLabel,
        short: over.short ?? preset.short,
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
        timerStepMinutes: tk.timerStepMinutes,
        countTarget: tk.countTarget,
        timerEndsAt: tk.mode === 'timer' ? null : undefined,
        core: tk.core,
        timelineLinked: tk.timelineLinked,
        sort: i,
        updatedAt: t,
      }));
      const created = seedMissingRegenSnapshots(
        {
          ...s,
          games: [...s.games, game],
          resources: [...s.resources, ...resources],
          tasks: [...s.tasks, ...tasks],
        },
        t,
        uid,
      );
      return seedBundledEvents(created, t);
    });
    return gameId;
  },

  addBlankGame(name) {
    const gameId = uid();
    const t = now();
    get().mutate((s) =>
      seedMissingRegenSnapshots(
        {
          ...s,
          games: [
            ...s.games,
            {
              id: gameId,
              name,
              short: name.slice(0, 4),
              // Brand accent, so a custom game starts on-system and the user can
              // change it to whatever that game actually looks like.
              color: '#7c5cff',
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
              cap: 100,
              regenMinutes: 6,
              reserveCap: 0,
              sort: 0,
              updatedAt: t,
            },
          ],
        },
        t,
        uid,
      ),
    );
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
        cap: res.cap ?? 100,
        regenMinutes: res.regenMinutes ?? 6,
        reserveCap: res.reserveCap ?? 0,
        reserveRegenMinutes: res.reserveRegenMinutes,
        kind: res.kind,
        reserveLabel: res.reserveLabel,
        sort: res.sort ?? s.resources.filter((r) => r.gameId === res.gameId).length,
        updatedAt: now(),
      };
      return seedMissingRegenSnapshots({ ...s, resources: [...s.resources, item] }, item.updatedAt, uid);
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
      const mine = s.snapshots.filter((x) => x.resourceId === resourceId);
      mine.sort((a, b) => b.takenAt - a.takenAt);
      // A reading the user just gave must WIN, and `latestSnapshots` breaks a
      // same-millisecond tie by comparing uuids — a coin flip. That was harmless
      // while snapshots only ever came from typing, and became data loss the
      // moment resources started seeding themselves at zero: onboarding writes
      // the seed and the typed value in the same tick, so which one you saw was
      // random. Stepping one millisecond past the newest existing snapshot makes
      // the newest write win by timestamp, deterministically.
      const newest = mine[0]?.takenAt ?? 0;
      const snap = {
        id: uid(),
        resourceId,
        value: clamped,
        takenAt: Math.max(now(), newest + 1),
        ...(clampedReserve != null ? { reserve: clampedReserve } : {}),
      };
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

  advanceTaskTimer(taskId, periodKey, minutes) {
    const t = now();
    const task = get().state.tasks.find((item) => item.id === taskId);
    if (!task) return;
    if (task.timerStepMinutes == null) {
      get().restartTaskTimer(taskId, periodKey);
      return;
    }
    if (task.timerEndsAt == null || !Number.isFinite(minutes) || minutes <= 0) return;
    const timerEndsAt = Math.max(t, task.timerEndsAt - minutes * 60_000);
    get().mutate((s) => ({
      ...s,
      tasks: patchIn(s.tasks, taskId, { timerEndsAt }),
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
        timerStepMinutes: task.timerStepMinutes,
        countTarget: task.countTarget,
        timerEndsAt: task.mode === 'timer' ? null : undefined,
        core: task.core,
        timelineLinked: task.timelineLinked,
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
          timerStepMinutes: task.timerStepMinutes,
          countTarget: task.countTarget,
          timerEndsAt: task.mode === 'timer' ? null : undefined,
          core: task.core,
          timelineLinked: task.timelineLinked,
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
      // Schema-validate the CANDIDATE, not just the preview. Settings.tsx
      // already validates what it shows the user, but this used to commit the
      // original object through `normalizeState`, which only coerces — so a
      // hand-edited or corrupt backup could put values into storage that the
      // launcher would later reject, leaving the device wedged. Refuse the
      // whole import instead: unlike a load, there is a real user standing here
      // who can be told the file is bad, and their existing state is intact.
      const parsed = safeParseAppState(raw);
      if (!parsed.success) return false;
      // Imports do not go through stateForStorage, so apply the shared schema
      // migrations and the temporary legacy badge repair at this boundary too.
      const migrated = migrateGenshinBadge(normalizeState(parsed.data)).state;
      get().mutate((s) => mergeState(s, migrated));
      return true;
    } catch {
      return false;
    }
  },
}));
