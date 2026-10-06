import { create } from 'zustand';
import { del as idbDel, get as idbGet, keys as idbKeys, set as idbSet } from 'idb-keyval';
import type {
  AlertRule,
  AppState,
  Cadence,
  Game,
  GameEvent,
  GamePreset,
  GameImportBatch,
  GameImportHistoryEntry,
  GameImportResult,
  RemoteEventImportResult,
  Reminder,
  Resource,
  Settings,
  SettingsField,
  Snapshot,
  QuickChip,
  Task,
} from '@memoria/shared';
import {
  completionId,
  assertStateCapacity,
  COMPLETION_RETENTION_MS,
  effectiveCountTarget,
  effectiveResourceKind,
  effectiveTimerDurationMinutes,
  emptyState,
  latestSnapshots,
  mergeState,
  normalizeState,
  pruneCompletions,
  safeParseAppState,
  seedMissingRegenSnapshots,
  settingsFieldClocks,
  projectEnergy,
  missingPresetTasks,
  presetForGame,
  planGameImport,
  importProvenance,
  GameImportHistorySchema,
  RemoteEventFeedSchema,
  MAX_EVENT_FEED_BYTES,
} from '@memoria/shared';
import {
  planSeedImport,
  pruneRetiredSeedEvents,
  SEED_RETENTION_MS,
  SEED_UPDATED,
  type PlannedSeed,
} from './data/seed-events';
import { uid } from './util';
import { sortTimelineEvents } from './timeline-sort';
import { launcherFetch, servedByLauncher } from './launcher';

const IDB_KEY = 'memoria-state';
/**
 * Every key this store has shipped under, newest first. The app has been renamed
 * twice and this is the user's ONLY copy of their data — a rename that dropped
 * it would silently look like a first run.
 */
const LEGACY_IDB_KEYS = ['void-state', 'technogg-state'] as const;
/** Matches the merge-side retention. */
const SNAPSHOTS_KEPT = 200;
const IMPORT_HISTORY_KEY = 'memoria-import-history';

function readImportHistory(): GameImportHistoryEntry[] {
  try {
    const raw = localStorage.getItem(IMPORT_HISTORY_KEY);
    if (!raw || raw.length > 2_000_000) return [];
    const parsed = GameImportHistorySchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

/** Keep undo on this device. Neither cookies nor image data is accepted by its schema. */
function saveImportHistory(history: GameImportHistoryEntry[]): GameImportHistoryEntry[] {
  let bounded = history.slice(0, 40);
  while (bounded.length > 1 && JSON.stringify(bounded).length > 2_000_000) bounded = bounded.slice(0, -1);
  try {
    localStorage.setItem(IMPORT_HISTORY_KEY, JSON.stringify(bounded));
  } catch {
    // A full or restricted store must not prevent the import. Undo remains
    // available in this session; synced readings retain their provenance.
  }
  return bounded;
}

type SyncStatus = 'idle' | 'syncing' | 'ok' | 'error';
/**
 * Cloud-folder sync (cloud-sync.ts) reports separately from the launcher sync
 * above. The two are independent — a launcher window may also be syncing a file
 * in Drive — and collapsing them into one status would make either one's error
 * look like the other's.
 */
export type CloudStatus = 'unsupported' | 'off' | 'needs-permission' | 'idle' | 'syncing' | 'ok' | 'error';

function now(): number {
  return Date.now();
}

/** Used for both new accounts and missing routines on existing accounts. */
function tasksFromPreset(tasks: GamePreset['tasks'], gameId: string, at: number, sortBase = 0): Task[] {
  return tasks.map((task, index) => ({
    id: uid(),
    gameId,
    name: task.name,
    cadence: task.cadence,
    intervalDays: task.intervalDays ?? 1,
    anchorAt: at,
    mode: task.mode,
    timerDurationMinutes: task.timerDurationMinutes,
    timerStepMinutes: task.timerStepMinutes,
    countTarget: task.countTarget,
    timerEndsAt: task.mode === 'timer' ? null : undefined,
    core: task.core,
    timelineLinked: task.timelineLinked,
    presetTaskKey: task.key,
    sort: sortBase + index,
    updatedAt: at,
  }));
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
    category: ev.category,
    bannerKind: ev.bannerKind,
    sort: ev.sort,
    start: ev.start ?? t,
    end: ev.end ?? t + 7 * 86_400_000,
    dailyTouch: ev.dailyTouch ?? false,
    notify: ev.notify ?? true,
    done: ev.done,
    notes: ev.notes ?? '',
    sourceKey: ev.sourceKey,
    // Only the bundled feed sets this. A hand-made event stays unstamped, which
    // is what keeps the refresh from ever considering it its own to rewrite.
    ...(ev.seedHash === undefined ? {} : { seedHash: ev.seedHash }),
    updatedAt: t,
  };
  byId.set(item.id, item);
}

function tombstone<T extends { id: string; updatedAt: number; deleted?: boolean }>(
  list: T[],
  match: (x: T) => boolean,
): T[] {
  return list.map((x) => (match(x) ? { ...x, deleted: true, updatedAt: now() } : x));
}

/** Manual readings and resource-rule edits use the same ordering and retention. */
function recordEnergySnapshot(state: AppState, reading: Omit<Snapshot, 'id' | 'takenAt'>, at: number): AppState {
  const mine = state.snapshots.filter((snapshot) => snapshot.resourceId === reading.resourceId);
  mine.sort((a, b) => b.takenAt - a.takenAt);
  // A new reading must win even when a seed or earlier edit has the same timestamp.
  const snapshot: Snapshot = {
    ...reading,
    provenance: reading.provenance ?? { kind: 'manual', observedAt: at, importedAt: at },
    id: uid(),
    takenAt: Math.max(at, (mine.find((item) => item.provenance?.kind !== 'estimate')?.takenAt ?? 0) + 1),
  };
  const keep = new Set(mine.slice(0, SNAPSHOTS_KEPT - 1).map((item) => item.id));
  return {
    ...state,
    snapshots: [
      ...state.snapshots.filter((item) => item.resourceId !== reading.resourceId || keep.has(item.id)),
      snapshot,
    ],
  };
}

let persistTimer: ReturnType<typeof setTimeout> | undefined;
let pendingPersist: AppState | null = null;
let persistInFlight: Promise<void> | null = null;
let storageEpoch = 0;
let storedReadInFlight: { epoch: number; promise: Promise<unknown> } | null = null;
let migrationWriteInFlight: Promise<void> | null = null;
let clearInFlight: Promise<void> | null = null;

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
  if (persistInFlight) {
    await persistInFlight;
    return flushPersist();
  }
  const pending = pendingPersist;
  if (!pending) return;
  pendingPersist = null;
  // This is the last boundary shared by every local writer. Keeping the guard
  // here preserves debounce performance while making an invalid disk write
  // impossible even if a future mutation forgets its own range check.
  persistInFlight = (async () => {
    try {
      assertStateCapacity(pending);
      await idbSet(IDB_KEY, normalizeState(pending));
      if (useApp.getState().saveError) useApp.setState({ saveError: '' });
    } catch (error) {
      // A newer edit takes priority. Otherwise retain this exact document for retry.
      pendingPersist ??= pending;
      useApp.setState({
        saveError: error instanceof Error ? error.message : 'The device could not save your changes.',
      });
      throw error;
    }
  })();
  try {
    await persistInFlight;
  } finally {
    persistInFlight = null;
  }
  if (pendingPersist) await flushPersist();
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
  const swept = pruneRetiredSeedEvents(pruned, now() - SEED_RETENTION_MS);
  const badgeMigrated = migrateGenshinBadge(swept);
  const state = badgeMigrated.state;
  const parsed = safeParseAppState(raw);
  // Successful transforms matter too: future clocks and inferred legacy fields
  // are safe in memory only after repair, so leave no poisoned original on disk.
  const schemaChanged =
    raw !== undefined && (!parsed.success || !sameJson(parsed.data, raw) || !sameJson(parsed.data, normalized));
  return {
    state,
    repaired:
      schemaChanged ||
      badgeMigrated.repaired ||
      state.completions.length !== normalized.completions.length ||
      // A sweep that is not written back runs again on every single load.
      state.events.length !== normalized.events.length,
  };
}

function applySeedPlan(state: AppState, plan: PlannedSeed[], version = SEED_UPDATED): AppState {
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
    const existing = item.eventId ? byId.get(item.eventId) : undefined;
    if (existing && existing.seedHash === undefined) {
      // Legacy rows have no baseline. Correct only the historical importer fields;
      // notes and alert preferences may already belong to the user.
      applyEventUpsert(byId, {
        id: existing.id,
        gameId: item.gameId,
        name: seed.name,
        start: item.start,
        end: item.end,
        seedHash: item.hash,
      });
      continue;
    }
    applyEventUpsert(byId, {
      ...(item.eventId ? { id: item.eventId } : {}),
      gameId: item.gameId,
      name: seed.name,
      type: seed.type,
      category: seed.category,
      bannerKind: seed.bannerKind,
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
  if (state.settings.seedImportedVersion === version) return { ...state, events };
  // Record the stamp so the refresh pass does not re-apply the bundled name and
  // dates over a user's edit on every subsequent load.
  return {
    ...state,
    events,
    settings: {
      ...state.settings,
      seedImportedVersion: version,
      fieldUpdatedAt: settingsFieldClocks(state.settings),
      updatedAt: now(),
    },
  };
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

async function readStoredState(epoch: number): Promise<unknown> {
  // StrictMode and Refresh can overlap. Share adoption work within one storage
  // lifetime, while allowing a new lifetime to ignore a stale pending read.
  if (storedReadInFlight?.epoch === epoch) return storedReadInFlight.promise;
  const promise = readAndAdoptStoredState(epoch);
  storedReadInFlight = { epoch, promise };
  try {
    return await promise;
  } finally {
    if (storedReadInFlight?.promise === promise) storedReadInFlight = null;
  }
}

async function readAndAdoptStoredState(epoch: number): Promise<unknown> {
  const existing = await idbGet(IDB_KEY);
  if (epoch !== storageEpoch) return undefined;
  if (existing !== undefined) return existing;

  const candidates = await legacyCandidates();
  if (epoch !== storageEpoch) return undefined;
  for (const candidate of candidates) {
    // Re-check immediately before writing so an already-created value wins.
    const current = await idbGet(IDB_KEY);
    if (epoch !== storageEpoch) return undefined;
    if (current !== undefined) return current;

    const write = idbSet(IDB_KEY, candidate.value);
    migrationWriteInFlight = write;
    try {
      await write;
    } finally {
      if (migrationWriteInFlight === write) migrationWriteInFlight = null;
    }
    if (epoch !== storageEpoch) return undefined;
    const migrated = await idbGet(IDB_KEY);
    if (epoch !== storageEpoch) return undefined;
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
  if (servedByLauncher()) {
    // A new desktop profile must read the existing PC document before its first
    // sync write. Merging fresh defaults first can replace zero-clock settings.
    // A failed read stays on the recovery screen instead of posting an empty app.
    const response = await launcherFetch('/api/state', { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`The PC data could not be opened (HTTP ${response.status}).`);
    const body = (await response.json()) as { state?: unknown } | null;
    const parsed = safeParseAppState(body?.state);
    if (!parsed.success) throw new Error('The PC data is invalid. Update Memoria and try again.');
    if (epoch !== storageEpoch) return undefined;
    // Clear or another writer may have filled the key during the request.
    const current = await idbGet(IDB_KEY);
    if (epoch !== storageEpoch) return undefined;
    if (current !== undefined) return current;
    const write = idbSet(IDB_KEY, parsed.data);
    migrationWriteInFlight = write;
    try {
      await write;
    } finally {
      if (migrationWriteInFlight === write) migrationWriteInFlight = null;
    }
    if (epoch !== storageEpoch) return undefined;
    return parsed.data;
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
  saveError: string;
  syncStatus: SyncStatus;
  syncError: string;
  lastSyncAt: number | null;
  cloudStatus: CloudStatus;
  cloudError: string;
  cloudFileName: string;
  lastCloudSyncAt: number | null;
  importHistory: GameImportHistoryEntry[];

  load(): Promise<void>;
  clearLocalData(): Promise<void>;
  /** Replace state (sync merge / import) without re-announcing a local mutation. */
  replaceState(next: AppState): void;
  setSyncStatus(status: SyncStatus, error?: string): void;
  setCloudStatus(status: CloudStatus, error?: string): void;
  setCloudFileName(name: string): void;
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
  moveResource(id: string, direction: -1 | 1): void;
  upsertChip(chip: Partial<QuickChip> & { gameId: string }): void;
  deleteChip(id: string): void;

  setEnergy(resourceId: string, value: number, reserve?: number): void;
  adjustEnergy(resourceId: string, delta: number): void;
  applyGameImport(batch: GameImportBatch): GameImportResult;
  undoGameImport(batchId: string): GameImportResult;
  importRemoteEvents(payload: unknown): RemoteEventImportResult;

  setTaskDone(taskId: string, periodKey: string, done: boolean): void;
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
  reorderEvents(gameId: string, orderedIds: string[]): void;
  resetEventOrder(gameId: string): void;
  deleteEvent(id: string): void;

  upsertRule(rule: Partial<AlertRule> & { type: AlertRule['type']; gameId: string | null }): void;
  clearRule(type: AlertRule['type'], gameId: string | null): void;

  addReminder(message: string, at: number, gameId: string | null): void;
  deleteReminder(id: string): void;
  updateReminder(id: string, patch: Pick<Reminder, 'message' | 'at'>): void;

  updateSettings(patch: Partial<Settings>): void;
  importJson(text: string): boolean;
}

export const useApp = create<AppStore>((set, get) => ({
  state: emptyState(),
  loaded: false,
  loadError: '',
  saveError: '',
  syncStatus: 'idle',
  syncError: '',
  lastSyncAt: null,
  cloudStatus: 'off',
  cloudError: '',
  cloudFileName: '',
  lastCloudSyncAt: null,
  importHistory: [],

  async load() {
    // A refresh started during Clear must read the result of Clear, not adopt
    // a legacy key while the deletion is still working through those keys.
    if (clearInFlight) await clearInFlight;
    const epoch = storageEpoch;
    set({ loadError: '' });
    purgeRetiredSecrets();
    const before = get().state;
    // Refresh must not replace an edit made during the debounce window.
    try {
      await flushPersist();
    } catch {
      // Keep the current view available so the user can retry or export it.
      if (get().loaded) return;
    }
    if (epoch !== storageEpoch) return;
    try {
      const stored = stateForStorage(await readStoredState(epoch));
      if (epoch !== storageEpoch) return;
      const editedWhileLoading = get().loaded && get().state !== before;
      const next = editedWhileLoading ? mergeState(stored.state, get().state) : stored.state;
      set({ state: next, loaded: true, loadError: '', importHistory: readImportHistory() });
      if (stored.repaired || editedWhileLoading) persist(next);
      const seedPlan = planSeedImport(get().state, now());
      if (seedPlan.length > 0) get().batch((state) => applySeedPlan(state, seedPlan));
    } catch (error) {
      if (epoch !== storageEpoch) return;
      set({
        loaded: false,
        loadError: error instanceof Error ? error.message : 'Local data could not be opened.',
      });
    }
  },

  async clearLocalData() {
    if (clearInFlight) return clearInFlight;
    ++storageEpoch;
    clearTimeout(persistTimer);
    persistTimer = undefined;
    pendingPersist = null;
    const clearing = (async () => {
      try {
        // Finish an older write before deleting, so it cannot restore cleared data.
        await persistInFlight?.catch(() => undefined);
        // An adoption write may have already started before this epoch changed.
        // Wait only for that write; stale reads can finish later and are ignored.
        await migrationWriteInFlight?.catch(() => undefined);
        pendingPersist = null;
        await idbDel(IDB_KEY);
        // Every legacy document, INCLUDING the identity-suffixed ones the reader
        // deliberately leaves in place. Adoption is conservative because it must
        // not destroy data; an explicit wipe is the opposite, and leaving another
        // identity's copy behind here would make "clear local data" a lie.
        for (const { key } of await legacyCandidates()) await idbDel(key);
        // The same applies to the retired notification credentials, or the one
        // action a user takes to wipe the device leaves their bot token behind.
        purgeRetiredSecrets();
        try {
          localStorage.removeItem(IMPORT_HISTORY_KEY);
        } catch {
          // Restricted localStorage must not prevent clearing the main database.
        }
        set({ state: emptyState(), loaded: true, loadError: '', saveError: '', importHistory: [] });
      } catch (error) {
        set({ loadError: error instanceof Error ? error.message : 'Local data could not be cleared.' });
      }
    })();
    clearInFlight = clearing;
    try {
      await clearing;
    } finally {
      if (clearInFlight === clearing) clearInFlight = null;
    }
  },

  replaceState(next) {
    persist(next);
    set({ state: next });
  },

  setSyncStatus(status, error = '') {
    set({ syncStatus: status, syncError: error, ...(status === 'ok' ? { lastSyncAt: now() } : {}) });
  },

  setCloudStatus(status, error = '') {
    set({ cloudStatus: status, cloudError: error, ...(status === 'ok' ? { lastCloudSyncAt: now() } : {}) });
  },

  setCloudFileName(name) {
    set({ cloudFileName: name });
  },

  mutate(fn) {
    get().batch(fn);
  },

  batch(fn) {
    const state = get().state;
    const next = fn(state);
    if (next === state) return;
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
        // The accent, which was dropped here for as long as this function has
        // existed. `gameRim` PREFERS the accent — it is the badge edge and the
        // card rim, the two things a user picks a game out of a rail by — so
        // every preset game fell back to its secondary and Genshin's navy
        // `#2f4078` never reached a pixel. Seven of the nine presets ship an
        // accent that differs from their secondary. It also kept `sameTrio` in
        // resolveGameIdentityColors from ever matching a game to its own preset.
        color3: preset.color3,
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
      const tasks = tasksFromPreset(preset.tasks, gameId, t);
      const created = seedMissingRegenSnapshots(
        {
          ...s,
          games: [...s.games, game],
          resources: [...s.resources, ...resources],
          tasks: [...s.tasks, ...tasks],
          chips: [
            ...s.chips,
            ...(preset.chips ?? []).map((chip, sort) => ({ ...chip, id: uid(), gameId, sort, updatedAt: t })),
          ],
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
      alertRules: tombstone(s.alertRules, (rule) => rule.gameId === id),
      reminders: tombstone(s.reminders, (reminder) => reminder.gameId === id),
    }));
  },

  upsertResource(res) {
    get().mutate((s) => {
      const existing = res.id ? s.resources.find((resource) => resource.id === res.id) : undefined;
      if (existing) {
        const updated = { ...existing, ...res, updatedAt: now() };
        const next = { ...s, resources: upsert(s.resources, updated) };
        const rulesChanged =
          effectiveResourceKind(existing) !== effectiveResourceKind(updated) ||
          existing.cap !== updated.cap ||
          existing.regenMinutes !== updated.regenMinutes ||
          existing.reserveCap !== updated.reserveCap ||
          existing.reserveRegenMinutes !== updated.reserveRegenMinutes;
        if (!rulesChanged || existing.deleted || updated.deleted) return next;
        const snapshot = latestSnapshots(s.snapshots).get(existing.id);
        if (!snapshot) return seedMissingRegenSnapshots(next, updated.updatedAt, uid);
        const game = s.games.find((item) => item.id === existing.gameId);
        // Apply the old rules until this edit, then begin the new rules from the
        // current reading. A lower cap must not discard already-held energy or reserve.
        const projection = projectEnergy(existing, snapshot, updated.updatedAt, game);
        return recordEnergySnapshot(
          next,
          {
            resourceId: existing.id,
            value: projection.value,
            reserve:
              projection.reserve == null ? snapshot.reserve : Math.max(projection.reserve, snapshot.reserve ?? 0),
          },
          updated.updatedAt,
        );
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

  moveResource(id, direction) {
    get().mutate((s) => {
      const resource = s.resources.find((item) => item.id === id && !item.deleted);
      if (!resource) return s;
      const ordered = s.resources
        .filter((item) => item.gameId === resource.gameId && !item.deleted)
        .sort((a, b) => a.sort - b.sort);
      const index = ordered.findIndex((item) => item.id === id);
      const other = index + direction;
      if (other < 0 || other >= ordered.length) return s;
      [ordered[index], ordered[other]] = [ordered[other]!, ordered[index]!];
      const positions = new Map(ordered.map((item, position) => [item.id, position]));
      const updatedAt = now();
      return {
        ...s,
        resources: s.resources.map((item) => {
          const sort = positions.get(item.id);
          return sort == null || sort === item.sort ? item : { ...item, sort, updatedAt };
        }),
      };
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
      return recordEnergySnapshot(
        s,
        { resourceId, value: clamped, ...(clampedReserve != null ? { reserve: clampedReserve } : {}) },
        now(),
      );
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

  applyGameImport(input) {
    const at = now();
    const state = get().state;
    const plan = planGameImport(state, input, at);
    const batch = plan.batch;
    const result: GameImportResult = {
      batchId: batch.id,
      applied: 0,
      skipped: plan.issues.length,
      issues: plan.issues,
    };
    if (get().importHistory.some((entry) => entry.batchId === batch.id)) {
      return {
        batchId: batch.id,
        applied: 0,
        skipped: 1,
        issues: [{ fieldId: 'batch', reason: 'duplicate', message: 'This import was already applied.' }],
      };
    }
    if (plan.resources.length + plan.tasks.length === 0) return result;
    const provenance = importProvenance(batch, at);
    const receipt: GameImportHistoryEntry = {
      ...result,
      gameId: batch.gameId,
      source: batch.source,
      observedAt: batch.observedAt,
      importedAt: at,
      status: 'applied',
      resources: [],
      tasks: [],
    };
    const previous = latestSnapshots(state.snapshots);
    get().batch((current) => {
      let next = current;
      for (const reading of plan.resources) {
        const before = previous.get(reading.resourceId);
        const resource = current.resources.find((item) => item.id === reading.resourceId)!;
        const game = current.games.find((item) => item.id === resource.gameId);
        // A missing reserve reading is unknown, not an instruction to set it to zero.
        const reserve =
          reading.reserve ??
          (before?.reserve == null
            ? undefined
            : (projectEnergy(resource, before, batch.observedAt, game).reserve ?? undefined));
        next = recordEnergySnapshot(
          next,
          { ...reading, ...(reserve == null ? {} : { reserve }), provenance },
          batch.observedAt,
        );
        const after = next.snapshots[next.snapshots.length - 1]!;
        receipt.resources.push({ resourceId: reading.resourceId, afterId: after.id, ...(before ? { before } : {}) });
      }
      for (const reading of plan.tasks) {
        const id = completionId(reading.taskId, reading.periodKey);
        const before = current.completions.find((item) => item.id === id);
        const after = { ...reading, id, updatedAt: batch.observedAt, provenance };
        next = { ...next, completions: upsert(next.completions, after) };
        receipt.tasks.push({ after, ...(before ? { before } : {}) });
      }
      assertStateCapacity(next);
      return next;
    });
    receipt.applied = plan.resources.length + plan.tasks.length;
    set({ importHistory: saveImportHistory([receipt, ...get().importHistory]) });
    return { ...result, applied: receipt.applied };
  },

  importRemoteEvents(payload) {
    let bytes = Infinity;
    try {
      bytes = new TextEncoder().encode(JSON.stringify(payload)).byteLength;
    } catch {
      /* Invalid input is rejected below. */
    }
    const parsed = bytes <= MAX_EVENT_FEED_BYTES ? RemoteEventFeedSchema.safeParse(payload) : null;
    if (!parsed?.success)
      return { applied: 0, skipped: true, error: 'The public calendar is invalid. Existing events were kept.' };
    const feed = parsed.data;
    const at = now();
    const generatedAt = Date.parse(feed.generatedAt);
    const current = get().state.settings.remoteFeedVersion;
    if (generatedAt > at + 300_000 || feed.seedUpdated > new Date(at).toISOString().slice(0, 10))
      return { applied: 0, skipped: true, error: 'The public calendar has a future publication date.' };
    if (
      feed.seedUpdated < SEED_UPDATED ||
      (current && (generatedAt < Date.parse(current.generatedAt) || feed.seedUpdated < current.seedUpdated))
    )
      return { applied: 0, skipped: true };
    // Equal publication time with different contents is ambiguous. A reviewed
    // correction must carry a later publication timestamp.
    if (current && generatedAt === Date.parse(current.generatedAt) && feed.revision !== current.revision)
      return { applied: 0, skipped: true };
    const plan = planSeedImport(get().state, at, feed);
    if (!plan.length && current?.revision === feed.revision) return { applied: 0, skipped: true };
    get().batch((state) => {
      const next = applySeedPlan(state, plan, feed.seedUpdated);
      const result = {
        ...next,
        settings: {
          ...next.settings,
          remoteFeedVersion: {
            generatedAt: feed.generatedAt,
            seedUpdated: feed.seedUpdated,
            revision: feed.revision,
            receivedAt: at,
          },
          fieldUpdatedAt: settingsFieldClocks(state.settings),
          updatedAt: at,
        },
      };
      assertStateCapacity(result);
      return result;
    });
    return { applied: plan.length, skipped: false };
  },

  undoGameImport(batchId) {
    const receipt = get().importHistory.find((entry) => entry.batchId === batchId);
    const result: GameImportResult = { batchId, applied: 0, skipped: 0, issues: [] };
    const skip = (fieldId: string, reason: 'changed' | 'no-history', message: string) => {
      result.skipped += 1;
      result.issues.push({ fieldId, reason, message });
    };
    if (!receipt || receipt.undoneAt != null) {
      skip('batch', 'no-history', 'This import has no available undo record on this device.');
      return result;
    }
    const at = now();
    get().batch((state) => {
      let next = state;
      const latest = latestSnapshots(state.snapshots);
      for (const record of receipt.resources) {
        const resource = state.resources.find((item) => item.id === record.resourceId && !item.deleted);
        const game = state.games.find((item) => item.id === resource?.gameId && !item.deleted);
        const current = latest.get(record.resourceId);
        if (
          !resource ||
          !game ||
          current?.id !== record.afterId ||
          current.provenance?.batchId !== batchId ||
          resource.updatedAt > receipt.importedAt
        ) {
          skip(record.resourceId, 'changed', 'This resource changed after the import. Its current value was kept.');
          continue;
        }
        if (!record.before) {
          skip(record.resourceId, 'no-history', 'There is no earlier reading to restore.');
          continue;
        }
        const restored = projectEnergy(resource, record.before, at, game);
        next = recordEnergySnapshot(
          next,
          {
            resourceId: record.resourceId,
            value: restored.value,
            ...(restored.reserve == null ? {} : { reserve: restored.reserve }),
          },
          at,
        );
        result.applied += 1;
      }
      for (const record of receipt.tasks) {
        const current = state.completions.find((item) => item.id === record.after.id);
        const task = state.tasks.find((item) => item.id === record.after.taskId && !item.deleted);
        if (
          !current ||
          !task ||
          !state.games.some((game) => game.id === task.gameId && !game.deleted) ||
          current.provenance?.batchId !== batchId ||
          current.updatedAt !== record.after.updatedAt ||
          current.done !== record.after.done ||
          current.countDone !== record.after.countDone ||
          current.deleted ||
          task.updatedAt > receipt.importedAt
        ) {
          skip(record.after.taskId, 'changed', 'This task changed after the import. Its current value was kept.');
          continue;
        }
        const restored = record.before ?? {
          id: current.id,
          taskId: current.taskId,
          periodKey: current.periodKey,
          done: false,
          deleted: true,
        };
        next = {
          ...next,
          completions: upsert(next.completions, {
            ...restored,
            updatedAt: Math.max(at, current.updatedAt + 1),
            provenance: { kind: 'manual', observedAt: at, importedAt: at },
          }),
        };
        result.applied += 1;
      }
      return next;
    });
    set({
      importHistory: saveImportHistory(
        get().importHistory.map((entry) =>
          entry.batchId === batchId ? { ...entry, status: result.skipped ? 'partial' : 'undone', undoneAt: at } : entry,
        ),
      ),
    });
    return result;
  },

  setTaskDone(taskId, periodKey, done) {
    const at = now();
    get().mutate((s) => ({
      ...s,
      completions: upsert(s.completions, {
        id: completionId(taskId, periodKey),
        taskId,
        periodKey,
        done,
        updatedAt: at,
        provenance: { kind: 'manual', observedAt: at, importedAt: at },
      }),
    }));
  },

  /**
   * One press means one thing: "I have just collected this dispatch and sent it
   * out again". It records the period as done and restarts the return timer.
   *
   * There used to be a separate `startTaskTimer` with a byte-identical body,
   * chosen by whether a timer happened to be running. The card no longer asks
   * that question — start, restart and collect are the same user act — so the
   * twin is gone.
   */
  restartTaskTimer(taskId, periodKey) {
    const t = now();
    const task = get().state.tasks.find((item) => item.id === taskId);
    if (!task) return;
    const duration = effectiveTimerDurationMinutes(task) * 60_000;
    get().mutate((s) => ({
      ...s,
      tasks: patchIn(s.tasks, taskId, { timerEndsAt: t + duration }),
      completions: upsert(s.completions, {
        id: completionId(taskId, periodKey),
        taskId,
        periodKey,
        done: true,
        updatedAt: t,
        provenance: { kind: 'manual', observedAt: t, importedAt: t },
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
        provenance: { kind: 'manual', observedAt: t, importedAt: t },
      }),
    }));
  },

  setTaskCount(taskId, periodKey, countDone) {
    const at = now();
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
        updatedAt: at,
        provenance: { kind: 'manual', observedAt: at, importedAt: at },
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
      const sortBase = Math.max(0, ...existing.map((task) => task.sort + 1));
      const added = tasksFromPreset(missing, gameId, t, sortBase);
      return { ...s, tasks: [...s.tasks, ...added] };
    });
    return missing.length;
  },

  addMissingPresetTasksEverywhere() {
    const state = get().state;
    const t = now();
    const added: Task[] = [];
    for (const game of state.games) {
      if (game.deleted) continue;
      const existing = state.tasks.filter((task) => task.gameId === game.id);
      const missing = missingPresetTasks(game, existing);
      const sortBase = Math.max(0, ...existing.map((task) => task.sort + 1));
      added.push(...tasksFromPreset(missing, game.id, t, sortBase));
    }
    if (added.length === 0) return 0;
    get().mutate((s) => ({ ...s, tasks: [...s.tasks, ...added] }));
    return added.length;
  },

  updateTask(id, patch) {
    get().mutate((s) => ({ ...s, tasks: patchIn(s.tasks, id, patch) }));
  },

  deleteTask(id) {
    get().mutate((s) => ({ ...s, tasks: tombstone(s.tasks, (t) => t.id === id) }));
  },

  upsertEvent(ev) {
    get().upsertEvents([ev]);
  },

  upsertEvents(list) {
    if (list.length === 0) return;
    get().batch((s) => {
      const byId = new Map(s.events.map((event) => [event.id, event]));
      for (const event of list) applyEventUpsert(byId, event);
      return { ...s, events: [...byId.values()] };
    });
  },

  reorderEvents(gameId, orderedIds) {
    const state = get().state;
    if (!state.games.some((game) => game.id === gameId && !game.deleted)) return;
    const events = sortTimelineEvents(state.events.filter((event) => event.gameId === gameId && !event.deleted));
    const selected = new Set(orderedIds);
    if (selected.size !== orderedIds.length || orderedIds.some((id) => !events.some((event) => event.id === id)))
      return;
    if (orderedIds.length < 2) return;
    // Replace only visible slots. Search, history, and time-window exclusions keep their place.
    let cursor = 0;
    const order = events.map((event) => (selected.has(event.id) ? orderedIds[cursor++] : event.id));
    if (order.every((id, index) => id === events[index].id)) return;
    get().upsertEvents(order.map((id, sort) => ({ id, gameId, sort })));
  },

  resetEventOrder(gameId) {
    get().upsertEvents(
      get()
        .state.events.filter((event) => event.gameId === gameId && !event.deleted && event.sort !== undefined)
        .map((event) => ({ id: event.id, gameId, sort: undefined })),
    );
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

  updateReminder(id, patch) {
    if (!patch.message.trim() || !Number.isFinite(patch.at)) return;
    get().mutate((s) => {
      if (!s.reminders.some((item) => item.id === id && !item.deleted)) return s;
      return { ...s, reminders: patchIn(s.reminders, id, { message: patch.message.trim(), at: patch.at }) };
    });
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
            ...settingsFieldClocks(s.settings),
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
      // Keep original clocks so impossible future readings are discarded before
      // merge, as they are for sync. Schema transforms would promote them to now.
      const migrated = migrateGenshinBadge(normalizeState(raw)).state;
      get().mutate((s) => mergeState(s, migrated));
      return true;
    } catch {
      return false;
    }
  },
}));
