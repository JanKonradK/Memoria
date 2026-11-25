import {
  assertSyncProtocol,
  boundHistory,
  checkpoint,
  compactState,
  emptyHistory,
  localDayKey,
  presetTaskAnchor,
  recordAction,
  restoreCheckpoint,
  sameValue,
  stampChanges,
  TOMBSTONE_RETENTION_MS,
  undoAction,
  checklistFor,
  eventPartsPatch,
  eventProgressPatch,
  isTickableDaily,
  type EventProgress,
  type LocalHistory,
} from '@memoria/shared';
import { create } from 'zustand';
import { del as idbDel, get as idbGet, keys as idbKeys, set as idbSet } from 'idb-keyval';
import type {
  AlertRule,
  AppState,
  Cadence,
  Game,
  GameCode,
  GameEvent,
  GamePreset,
  RemoteEventImportResult,
  CustomQuest,
  Note,
  NotificationStyle,
  QuestState,
  Reminder,
  Resource,
  Settings,
  SettingsField,
  Snapshot,
  QuickChip,
  Task,
} from '@memoria/shared';
import {
  adoptGameNotes,
  collapseSourceTwins,
  CUSTOM_QUEST_PREFIX,
  nextNoteSort,
  questMarkId,
  sourceEventId,
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
  RemoteEventFeedSchema,
  MAX_EVENT_FEED_BYTES,
  applyConnectorObservation as applyObservation,
  taskPeriodKey,
  defaultRedeemUrl,
  MAX_CODE_LENGTH,
  type ConnectorObservation,
  type ObservationProvenance,
} from '@memoria/shared';
import {
  planSeedImport,
  pruneRetiredSeedEvents,
  SEED_RETENTION_MS,
  SEED_UPDATED,
  type PlannedSeed,
} from './data/seed-events';
import { uid } from './util';
import { launcherFetch, servedByLauncher } from './launcher';

const IDB_KEY = 'memoria-state';
const IDB_HISTORY_KEY = 'memoria-history';
/**
 * Every key this store has shipped under, newest first. The app has been renamed
 * twice and this is the user's ONLY copy of their data — a rename that dropped
 * it would silently look like a first run.
 */
const LEGACY_IDB_KEYS = ['void-state', 'technogg-state'] as const;
/** Matches the merge-side retention. */
const SNAPSHOTS_KEPT = 200;
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
    anchorAt: presetTaskAnchor(task, at),
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

/** Most codes one game keeps; matches GameSchema. */
const MAX_GAME_CODES = 200;

export interface GameCodeEntry {
  code: string;
  rewards?: string;
  expiresAt?: number;
  redeemUrl?: string;
}

/** Replaces one live game's saved codes under `label`, so the change lands in history and Undo. */
function patchGameCodes(
  batch: AppStore['batch'],
  gameId: string,
  label: string,
  change: (codes: GameCode[]) => GameCode[],
): void {
  batch((s) => {
    const game = s.games.find((item) => item.id === gameId && !item.deleted);
    if (!game) return s;
    return { ...s, games: patchIn(s.games, gameId, { codes: change(game.codes ?? []) }) };
  }, label);
}

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

function liveEvent(state: AppState, id: string): GameEvent | undefined {
  return state.events.find((event) => event.id === id && !event.deleted);
}

function tombstone<T extends { id: string; updatedAt: number; deleted?: boolean }>(
  list: T[],
  match: (x: T) => boolean,
): T[] {
  return list.map((x) => (match(x) ? { ...x, deleted: true, updatedAt: now() } : x));
}

/** Manual readings and resource-rule edits use the same ordering and retention. */
function recordEnergySnapshot(
  state: AppState,
  reading: Omit<Snapshot, 'id' | 'takenAt'>,
  at: number,
  takenAtOverride?: number,
): AppState {
  const mine = state.snapshots.filter((snapshot) => snapshot.resourceId === reading.resourceId);
  mine.sort((a, b) => b.takenAt - a.takenAt);
  // A new reading must win even when a seed or earlier edit has the same timestamp.
  const prevTakenAt = mine.find((item) => item.provenance?.kind !== 'estimate')?.takenAt ?? 0;
  const snapshot: Snapshot = {
    ...reading,
    provenance: reading.provenance ?? { kind: 'manual', observedAt: at, importedAt: at },
    id: uid(),
    takenAt: Math.max(takenAtOverride ?? at, prevTakenAt + 1),
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

export interface ScreenshotReadingsInput {
  gameId: string;
  observedAt: number;
  provider: string;
  readings: Array<{ resourceId: string; value: number; reserve?: number }>;
  tasks: Array<{ taskId: string; action: 'done' | 'count'; countDone?: number }>;
  savings?: { currency?: number; tickets?: number };
  /** Endgame cycles (Spiral Abyss, Memory of Chaos…) the screenshot showed progress on. */
  events?: Array<{ eventId: string; progress: EventProgress }>;
}

const MAX_SAVINGS_AMOUNT = 100_000_000;

function clampInt(value: number, max: number): number | undefined {
  return Number.isFinite(value) ? Math.min(max, Math.max(0, Math.round(value))) : undefined;
}

let persistTimer: ReturnType<typeof setTimeout> | undefined;
type LegacyStoredDocument = AppState & { localHistory?: LocalHistory };
let pendingState: AppState | null = null;
let pendingHistory: LocalHistory | null = null;
let pendingBroadcast = false;
let lastWrittenState: AppState | null = null;
let lastWrittenHistory: LocalHistory | null = null;
let persistInFlight: Promise<void> | null = null;
let storageEpoch = 0;
let storedReadInFlight: { epoch: number; promise: Promise<unknown> } | null = null;
let migrationWriteInFlight: Promise<void> | null = null;
let clearInFlight: Promise<void> | null = null;
const TAB_ID = uid();
let tabChannel: BroadcastChannel | null = null;

function withIdbLock<T>(fn: () => Promise<T>): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks && typeof navigator.locks.request === 'function') {
    return navigator.locks.request('memoria-idb-write', () => fn());
  }
  return fn();
}

function ensureTabChannel(): void {
  if (tabChannel || servedByLauncher() || typeof BroadcastChannel === 'undefined') return;
  const channel = new BroadcastChannel('memoria-state');
  channel.addEventListener('message', (event: MessageEvent<{ type?: unknown; sender?: unknown }>) => {
    const data = event.data;
    if (!data || typeof data !== 'object' || data.sender === TAB_ID) return;
    if (data.type === 'cleared') {
      void useApp.getState().load();
      return;
    }
    if (data.type === 'saved') {
      const epoch = storageEpoch;
      void Promise.resolve(idbGet(IDB_KEY))
        .then((latest) => {
          if (epoch !== storageEpoch || !latest) return;
          const parsed = safeParseAppState(latest);
          if (!parsed.success) return;
          useApp.getState().replaceState(mergeState(useApp.getState().state, normalizeState(parsed.data)));
        })
        .catch(() => undefined);
    }
  });
  tabChannel = channel;
}

function notifyOtherTabs(type: 'saved' | 'cleared'): void {
  if (servedByLauncher()) return;
  ensureTabChannel();
  try {
    tabChannel?.postMessage({ type, sender: TAB_ID });
  } catch {
    tabChannel = null;
  }
}

export function closeTabSyncForTest(): void {
  try {
    tabChannel?.close();
  } catch {
    // Ignore already-closed test channels.
  }
  tabChannel = null;
}

function ensureDailyCheckpoint(
  history: LocalHistory,
  state: AppState,
  at: number,
): { history: LocalHistory; added: boolean } {
  const day = localDayKey(at, state.settings.localTz);
  if (
    history.checkpoints.some(
      (item) => item.label === 'Daily checkpoint' && localDayKey(item.at, state.settings.localTz) === day,
    )
  ) {
    return { history, added: false };
  }
  return { history: checkpoint(history, state, 'Daily checkpoint', at, uid()), added: true };
}

function persist(
  state: AppState,
  history: LocalHistory = useApp.getState().history,
  options: { broadcast?: boolean } = {},
): void {
  clearTimeout(persistTimer);
  pendingState = state;
  pendingHistory = history;
  if (options.broadcast) pendingBroadcast = true;
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
  const state = pendingState;
  const history = pendingHistory;
  const broadcast = pendingBroadcast;
  if (!state && !history) return;
  pendingState = null;
  pendingHistory = null;
  pendingBroadcast = false;
  // This is the last boundary shared by every local writer. Keeping the guard
  // here preserves debounce performance while making an invalid disk write
  // impossible even if a future mutation forgets its own range check.
  persistInFlight = (async () => {
    let wroteState = false;
    try {
      await withIdbLock(async () => {
        if (state && state !== lastWrittenState) {
          assertStateCapacity(state);
          await idbSet(IDB_KEY, normalizeState(state));
          lastWrittenState = state;
          wroteState = true;
        }
        if (history && history !== lastWrittenHistory) {
          await idbSet(IDB_HISTORY_KEY, history);
          lastWrittenHistory = history;
        }
      });
      if (useApp.getState().saveError) useApp.setState({ saveError: '' });
      if (broadcast && wroteState) notifyOtherTabs('saved');
    } catch (error) {
      // A newer edit takes priority. Otherwise retain unfinished writes for retry.
      if (!wroteState && state) pendingState ??= state;
      if (history && history !== lastWrittenHistory) pendingHistory ??= history;
      pendingBroadcast ||= broadcast;
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
  if (pendingState || pendingHistory) await flushPersist();
}

function sameJson(left: unknown, right: unknown): boolean {
  try {
    return sameValue(left, right);
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

/**
 * Games made before preset keys existed carry none, so their logos had no
 * artwork and their names no title face. Stamp the key once, and fill the face
 * in that same pass only: after that the key is there, so a face the player
 * later clears on purpose stays cleared.
 */
export function migrateLegacyIdentity(state: AppState): { state: AppState; repaired: boolean } {
  let repaired = false;
  const updatedAt = now();
  const games = state.games.map((game) => {
    if (game.deleted || game.presetKey) return game;
    const preset = presetForGame(game);
    if (!preset) return game;
    repaired = true;
    return {
      ...game,
      presetKey: preset.key,
      ...(!game.titleFont && preset.titleFont ? { titleFont: preset.titleFont } : {}),
      updatedAt: Math.max(updatedAt, game.updatedAt + 1),
    };
  });
  return repaired ? { state: { ...state, games }, repaired } : { state, repaired };
}

/**
 * Quick spends arrived in the presets after many games were added. A game with
 * no quick-spend rows at all, not even deleted ones, gets its preset's. The ids
 * are fixed, so two devices doing this before they sync still agree.
 */
function seedPresetChips(state: AppState): AppState {
  const added: QuickChip[] = [];
  for (const game of state.games) {
    if (game.deleted || state.chips.some((chip) => chip.gameId === game.id)) continue;
    const chips = presetForGame(game)?.chips ?? [];
    chips.forEach((chip, sort) =>
      added.push({ ...chip, id: `preset-chip:${game.id}:${sort}`, gameId: game.id, sort, updatedAt: 1 }),
    );
  }
  return added.length ? { ...state, chips: [...state.chips, ...added] } : state;
}

function stateForStorage(raw: unknown): { state: AppState; repaired: boolean } {
  const normalized = seedMissingRegenSnapshots(normalizeState(raw), now(), uid);
  const pruned = pruneCompletions(normalized, now() - COMPLETION_RETENTION_MS);
  const swept = pruneRetiredSeedEvents(pruned, now() - SEED_RETENTION_MS);
  const badgeMigrated = migrateGenshinBadge(swept);
  const identity = migrateLegacyIdentity(badgeMigrated.state);
  const state = seedPresetChips(collapseSourceTwins(identity.state, now()));
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
      identity.repaired ||
      state !== badgeMigrated.state ||
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
      id: item.eventId ?? sourceEventId(item.gameId, seed.sourceKey),
      gameId: item.gameId,
      name: seed.name,
      type: seed.type,
      category: seed.category,
      bannerKind: seed.bannerKind,
      start: item.start,
      end: item.end,
      dailyTouch: seed.dailyTouch ?? false,
      reward: seed.reward,
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
    assertSyncProtocol(body?.state);
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
  history: LocalHistory;
  undoActivity(id: string): void;
  restoreSavedCheckpoint(id: string): void;
  completeDailies(gameId: string): string | undefined;
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

  load(): Promise<void>;
  clearLocalData(): Promise<void>;
  /** Replace state (sync merge / import) without re-announcing a local mutation. */
  replaceState(next: AppState): void;
  setSyncStatus(status: SyncStatus, error?: string): void;
  setCloudStatus(status: CloudStatus, error?: string): void;
  setCloudFileName(name: string): void;
  mutate(fn: (s: AppState) => AppState): void;
  batch(fn: (s: AppState) => AppState, label?: string): void;

  addGameFromPreset(
    preset: GamePreset,
    over: {
      tz?: string;
      server?: string;
      capOverrides?: Record<number, number>;
      name?: string;
      short?: string;
      accountLabel?: string;
    },
  ): string;
  addBlankGame(name: string): string;
  updateGame(id: string, patch: Partial<Game>): void;
  deleteGame(id: string): void;
  /** Saves new redemption codes for one game, skipping any it has (any case). Returns how many were added. */
  addGameCodes(gameId: string, entries: GameCodeEntry[]): number;
  toggleGameCodeRedeemed(gameId: string, codeId: string): void;
  removeGameCode(gameId: string, codeId: string): void;

  upsertResource(res: Partial<Resource> & { gameId: string }): void;
  deleteResource(id: string): void;
  moveResource(id: string, direction: -1 | 1): void;
  upsertChip(chip: Partial<QuickChip> & { gameId: string }): void;
  deleteChip(id: string): void;

  /** `provenance` marks a reading that came from somewhere other than the player's hand (a screenshot). */
  setEnergy(resourceId: string, value: number, reserve?: number, provenance?: ObservationProvenance): void;
  /**
   * Everything the player confirmed from one screenshot, as one history entry:
   * bars, task progress and savings. One Undo restores all of it.
   */
  applyScreenshotReadings(input: ScreenshotReadingsInput): void;
  /** Writes a live account reading into one game. Returns how many records changed. */
  applyConnectorObservation(gameId: string, obs: ConnectorObservation): number;
  adjustEnergy(resourceId: string, delta: number): void;
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
  deleteEvent(id: string): void;
  /** Every surface that ticks an event goes through these three, so a stored part count is kept. */
  setEventProgress(eventId: string, progress: EventProgress): void;
  /** Done when not done; not started when done. */
  toggleEventDone(eventId: string): void;
  setEventPartsDone(eventId: string, partsDone: number): void;

  upsertRule(rule: Partial<AlertRule> & { type: AlertRule['type']; gameId: string | null }): void;
  clearRule(type: AlertRule['type'], gameId: string | null): void;

  addReminder(message: string, at: number, gameId: string | null, repeatDays?: number, style?: NotificationStyle): void;
  deleteReminder(id: string): void;
  updateReminder(
    id: string,
    patch: Pick<Reminder, 'message' | 'at'> & { repeatDays?: number | null; style?: NotificationStyle | null },
  ): void;

  updateSettings(patch: Partial<Settings>): void;
  /** Sets or clears (null) marks on quests and quest parts; one mark and many take the same path. */
  setQuestMarks(gameId: string, marks: { questId: string; partId?: string; state: QuestState | null }[]): void;
  saveCustomQuest(quest: Omit<CustomQuest, 'updatedAt' | 'id'> & { id?: string }): string;
  /** Creates a note, or changes the fields given of an existing one. Returns its id. */
  saveNote(note: Partial<Omit<Note, 'updatedAt'>>): string;
  deleteNote(id: string): void;
  /** Brings a deleted note back, as it was. */
  restoreNote(id: string): void;
  deleteCustomQuest(id: string): void;
  /** Record catch-up digests as read for a game preset, on every device. */
  markCatchUpRead(presetKey: string, keys: string[]): void;
  importJson(text: string): boolean;
}

export const useApp = create<AppStore>((set, get) => ({
  history: emptyHistory(uid()),
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
      ensureTabChannel();
      const [disk, storedHistory] = await Promise.all([readStoredState(epoch), idbGet<LocalHistory>(IDB_HISTORY_KEY)]);
      const legacyHistory = (disk as LegacyStoredDocument | undefined)?.localHistory;
      const raw =
        disk && typeof disk === 'object'
          ? Object.fromEntries(Object.entries(disk).filter(([key]) => key !== 'localHistory'))
          : disk;
      const stored = stateForStorage(raw);
      if (epoch !== storageEpoch) return;
      const at = now();
      const editedWhileLoading = get().loaded && get().state !== before;
      const boundedStoredHistory = storedHistory ? boundHistory(storedHistory) : undefined;
      let history = editedWhileLoading
        ? get().history
        : boundedStoredHistory
          ? boundedStoredHistory
          : legacyHistory
            ? boundHistory(legacyHistory)
            : emptyHistory(uid());
      let next = editedWhileLoading ? collapseSourceTwins(mergeState(stored.state, get().state), at) : stored.state;
      if (stored.repaired && raw) {
        // Keep the original pre-migration document for recovery, including removed fields.
        const original = { ...(raw as LegacyStoredDocument) };
        delete original.localHistory;
        history = checkpoint(history, original as AppState, 'Before migration', at, uid());
        const baseline = normalizeState(raw);
        const stamped = stampChanges(baseline, next, history, at);
        next = stamped.state;
        history = recordAction({ ...history, clock: stamped.clock }, raw as AppState, next, 'Migration', at, uid());
      }
      const compacted = compactState(next, at - TOMBSTONE_RETENTION_MS);
      const compactedSomething =
        compacted.games.length !== next.games.length ||
        compacted.resources.length !== next.resources.length ||
        compacted.tasks.length !== next.tasks.length ||
        compacted.completions.length !== next.completions.length ||
        compacted.events.length !== next.events.length ||
        compacted.chips.length !== next.chips.length ||
        compacted.alertRules.length !== next.alertRules.length ||
        compacted.reminders.length !== next.reminders.length ||
        compacted.questMarks.length !== next.questMarks.length ||
        compacted.customQuests.length !== next.customQuests.length ||
        compacted.notes.length !== next.notes.length;
      if (compactedSomething) next = compacted;
      const daily = ensureDailyCheckpoint(history, next, at);
      history = daily.history;
      const stateUnchangedOnDisk =
        raw !== undefined &&
        !editedWhileLoading &&
        !stored.repaired &&
        legacyHistory === undefined &&
        !compactedSomething;
      const historyUnchangedOnDisk =
        raw !== undefined &&
        !editedWhileLoading &&
        !stored.repaired &&
        legacyHistory === undefined &&
        storedHistory !== undefined &&
        history === storedHistory;
      lastWrittenState = stateUnchangedOnDisk ? next : null;
      lastWrittenHistory = historyUnchangedOnDisk ? history : null;
      set({ state: next, history, loaded: true, loadError: '' });
      if (raw !== undefined || editedWhileLoading || legacyHistory !== undefined || storedHistory !== undefined) {
        persist(next, history, { broadcast: false });
      }
      // Each game's old single notes box becomes a note of its own (notes.ts).
      if (get().state.games.some((game) => game.notes)) get().batch((state) => adoptGameNotes(state, now()), 'Notes');
      const seedPlan = planSeedImport(get().state, now());
      if (seedPlan.length > 0) get().batch((state) => applySeedPlan(state, seedPlan), 'Feed import');
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
    pendingState = null;
    pendingHistory = null;
    pendingBroadcast = false;
    lastWrittenState = null;
    lastWrittenHistory = null;
    const clearing = (async () => {
      try {
        // Finish an older write before deleting, so it cannot restore cleared data.
        await persistInFlight?.catch(() => undefined);
        // An adoption write may have already started before this epoch changed.
        // Wait only for that write; stale reads can finish later and are ignored.
        await migrationWriteInFlight?.catch(() => undefined);
        pendingState = null;
        pendingHistory = null;
        pendingBroadcast = false;
        lastWrittenState = null;
        lastWrittenHistory = null;
        await idbDel(IDB_KEY);
        await idbDel(IDB_HISTORY_KEY);
        // Every legacy document, INCLUDING the identity-suffixed ones the reader
        // deliberately leaves in place. Adoption is conservative because it must
        // not destroy data; an explicit wipe is the opposite, and leaving another
        // identity's copy behind here would make "clear local data" a lie.
        for (const { key } of await legacyCandidates()) await idbDel(key);
        // The same applies to the retired notification credentials, or the one
        // action a user takes to wipe the device leaves their bot token behind.
        purgeRetiredSecrets();
        try {
          // Left by the retired readings import and Calendar changes review.
          localStorage.removeItem('memoria-import-history');
          localStorage.removeItem('memoria-calendar-changes');
        } catch {
          // Restricted localStorage must not prevent clearing the main database.
        }
        set({ state: emptyState(), history: emptyHistory(uid()), loaded: true, loadError: '', saveError: '' });
        notifyOtherTabs('cleared');
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
    // A merge can bring in another device's copy of an imported event. The
    // repair tombstones it, and that change has to go back out to the peers.
    const collapsed = collapseSourceTwins(next, now());
    const repair = collapsed !== next ? stampChanges(next, collapsed, get().history, now()) : null;
    const repaired = repair?.state ?? next;
    const before = get().state;
    if (sameJson(before, repaired)) return;
    const history = recordAction(
      repair ? { ...get().history, clock: repair.clock } : get().history,
      before,
      repaired,
      'Sync arrivals',
      now(),
      uid(),
    );
    set({ state: repaired, history });
    persist(repaired, history, { broadcast: false });
    if (repaired !== next) announceMutation();
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

  batch(fn, label = 'Edit') {
    const state = get().state;
    const changed = fn(state);
    if (changed === state) return;
    let history = get().history;
    const at = now();
    if (label.includes('import') || label === 'Feed import' || label === 'Restore checkpoint')
      history = checkpoint(history, state, `Before ${label.toLowerCase()}`, at, uid());
    const daily = ensureDailyCheckpoint(history, state, at);
    history = daily.history;
    const stamped = stampChanges(state, collapseSourceTwins(changed, at), history, at);
    if (sameJson(state, stamped.state)) return;
    history = recordAction({ ...history, clock: stamped.clock }, state, stamped.state, label, at, uid());
    const finalState = daily.added ? compactState(stamped.state, at - TOMBSTONE_RETENTION_MS) : stamped.state;
    set({ state: finalState, history });
    persist(finalState, history, { broadcast: true });
    announceMutation();
  },

  undoActivity(id) {
    const history = get().history;
    const index = history.journal.findIndex((entry) => entry.id === id);
    const entry = history.journal[index];
    if (!entry || entry.undone) return;
    const next = undoAction(get().state, entry, history.journal.slice(index + 1));
    // Mark together with the inverse in the same durable document.
    set({
      history: {
        ...history,
        journal: history.journal.map((item) => (item.id === id ? { ...item, undone: true } : item)),
      },
    });
    get().batch(() => next, `Undo: ${entry.label}`);
    persist(get().state, get().history, { broadcast: true });
  },

  restoreSavedCheckpoint(id) {
    const saved = get().history.checkpoints.find((item) => item.id === id);
    if (saved) get().batch((state) => restoreCheckpoint(state, normalizeState(saved.state)), 'Restore checkpoint');
  },

  completeDailies(gameId) {
    const state = get().state;
    const game = state.games.find((item) => item.id === gameId && !item.deleted);
    if (!game || game.paused) return;
    const tasks = checklistFor(state, game, now()).filter(isTickableDaily);
    if (!tasks.length) return;
    get().batch((s) => {
      const t = now();
      let completions = s.completions;
      let stateTasks = s.tasks;
      for (const item of tasks) {
        completions = upsert(completions, {
          id: completionId(item.taskId, item.periodKey),
          taskId: item.taskId,
          periodKey: item.periodKey,
          done: true,
          updatedAt: t,
        });
        // Collect-and-resend, exactly as pressing the row would.
        if (item.mode === 'timer') {
          const task = stateTasks.find((entry) => entry.id === item.taskId);
          if (task)
            stateTasks = patchIn(stateTasks, task.id, {
              timerEndsAt: t + effectiveTimerDurationMinutes(task) * 60_000,
            });
        }
      }
      return { ...s, tasks: stateTasks, completions };
    }, `Complete dailies: ${game.name}`);
    return get().history.journal.at(-1)?.id;
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
        server: over.server,
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

  addGameCodes(gameId, entries) {
    const game = get().state.games.find((item) => item.id === gameId && !item.deleted);
    if (!game) return 0;
    const presetKey = game.presetKey ?? presetForGame(game)?.key;
    const existing = game.codes ?? [];
    const seen = new Set(existing.map((item) => item.code.toLowerCase()));
    const room = MAX_GAME_CODES - existing.length;
    const addedAt = now();
    const added: GameCode[] = [];
    for (const entry of entries) {
      if (added.length >= room) break;
      const code = entry.code.trim();
      if (!code || code.length > MAX_CODE_LENGTH || seen.has(code.toLowerCase())) continue;
      seen.add(code.toLowerCase());
      const rewards = entry.rewards?.trim().slice(0, 200);
      const link = entry.redeemUrl?.trim();
      const redeemUrl =
        link && link.startsWith('https://') && link.length <= 500 ? link : defaultRedeemUrl(presetKey, code);
      const expiresAt =
        entry.expiresAt !== undefined && Number.isFinite(entry.expiresAt) && entry.expiresAt > 0
          ? Math.round(entry.expiresAt)
          : undefined;
      added.push({
        id: uid(),
        code,
        addedAt,
        ...(rewards ? { rewards } : {}),
        ...(expiresAt !== undefined ? { expiresAt } : {}),
        ...(redeemUrl ? { redeemUrl } : {}),
      });
    }
    if (added.length === 0) return 0;
    patchGameCodes(get().batch, gameId, 'Add codes', (codes) => [...codes, ...added]);
    return added.length;
  },

  toggleGameCodeRedeemed(gameId, codeId) {
    const game = get().state.games.find((item) => item.id === gameId && !item.deleted);
    const code = game?.codes?.find((item) => item.id === codeId);
    if (!code) return;
    patchGameCodes(get().batch, gameId, code.redeemed ? 'Unmark code' : 'Mark code redeemed', (codes) =>
      codes.map((item) => (item.id === codeId ? { ...item, redeemed: !item.redeemed } : item)),
    );
  },

  removeGameCode(gameId, codeId) {
    const game = get().state.games.find((item) => item.id === gameId && !item.deleted);
    if (!game?.codes?.some((item) => item.id === codeId)) return;
    patchGameCodes(get().batch, gameId, 'Remove code', (codes) => codes.filter((item) => item.id !== codeId));
  },

  deleteGame(id) {
    get().mutate((s) => ({
      ...s,
      games: tombstone(s.games, (g) => g.id === id),
      resources: tombstone(s.resources, (r) => r.gameId === id),
      snapshots: s.snapshots.map((reading) =>
        s.resources.some((resource) => resource.id === reading.resourceId && resource.gameId === id)
          ? { ...reading, deleted: true }
          : reading,
      ),
      completions: tombstone(s.completions, (completion) =>
        s.tasks.some((task) => task.id === completion.taskId && task.gameId === id),
      ),
      tasks: tombstone(s.tasks, (t) => t.gameId === id),
      chips: tombstone(s.chips, (c) => c.gameId === id),
      events: tombstone(s.events, (e) => e.gameId === id),
      alertRules: tombstone(s.alertRules, (rule) => rule.gameId === id),
      reminders: tombstone(s.reminders, (reminder) => reminder.gameId === id),
      questMarks: tombstone(s.questMarks, (mark) => mark.gameId === id),
      customQuests: tombstone(s.customQuests, (quest) => quest.gameId === id),
      notes: tombstone(s.notes, (note) => note.gameId === id),
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

  setEnergy(resourceId, value, reserve, provenance) {
    get().mutate((s) => {
      const res = s.resources.find((item) => item.id === resourceId && !item.deleted);
      if (!res) return s;
      const clamped = Math.min(res.cap, Math.max(0, Math.round(value)));
      // A reading of the main bar alone says nothing about the reserve, so the
      // reserve carries over as projected. Dropping it zeroed the reserve
      // whenever only the main number was entered.
      let keptReserve = reserve;
      if (keptReserve == null && res.reserveCap > 0) {
        const game = s.games.find((item) => item.id === res.gameId);
        const snap = latestSnapshots(s.snapshots).get(resourceId);
        keptReserve = snap ? (projectEnergy(res, snap, now(), game).reserve ?? snap.reserve) : undefined;
      }
      const clampedReserve =
        keptReserve != null && res.reserveCap > 0
          ? Math.min(res.reserveCap, Math.max(0, Math.round(keptReserve)))
          : undefined;
      const at = now();
      // A screenshot shows the bar as it was when it was taken, so the reading dates from then.
      const takenAt = provenance && provenance.kind !== 'manual' ? Math.min(at, provenance.observedAt) : undefined;
      return recordEnergySnapshot(
        s,
        {
          resourceId,
          value: clamped,
          ...(clampedReserve != null ? { reserve: clampedReserve } : {}),
          ...(provenance ? { provenance } : {}),
        },
        at,
        takenAt,
      );
    });
  },

  applyScreenshotReadings(input) {
    get().batch((start) => {
      const game = start.games.find((item) => item.id === input.gameId && !item.deleted);
      if (!game) return start;
      const at = now();
      const observedAt =
        Number.isFinite(input.observedAt) && input.observedAt > 0 ? Math.min(at, Math.round(input.observedAt)) : at;
      const provenance: ObservationProvenance = {
        kind: 'screenshot',
        provider: input.provider,
        observedAt,
        importedAt: at,
      };
      let s = start;
      for (const reading of input.readings) {
        const res = s.resources.find(
          (item) => item.id === reading.resourceId && item.gameId === game.id && !item.deleted,
        );
        const value = res ? clampInt(reading.value, res.cap) : undefined;
        if (!res || value == null) continue;
        let reserve =
          reading.reserve != null && res.reserveCap > 0 ? clampInt(reading.reserve, res.reserveCap) : undefined;
        // A reading of the main bar alone carries the projected reserve over, as setEnergy does.
        if (reserve == null && res.reserveCap > 0) {
          const snap = latestSnapshots(s.snapshots).get(res.id);
          const kept = snap ? (projectEnergy(res, snap, at, game).reserve ?? snap.reserve) : undefined;
          reserve = kept != null ? clampInt(kept, res.reserveCap) : undefined;
        }
        s = recordEnergySnapshot(
          s,
          { resourceId: res.id, value, ...(reserve != null ? { reserve } : {}), provenance },
          at,
          observedAt,
        );
      }
      for (const item of input.tasks) {
        const task = s.tasks.find((t) => t.id === item.taskId && t.gameId === game.id && !t.deleted);
        if (!task) continue;
        // An older screenshot ticks the period it was taken in, not the one open now.
        const periodKey = taskPeriodKey(game, task, observedAt);
        const target = effectiveCountTarget(task);
        const countDone = item.action === 'count' ? clampInt(item.countDone ?? NaN, target) : undefined;
        if (item.action === 'count' && countDone == null) continue;
        s = {
          ...s,
          completions: upsert(s.completions, {
            id: completionId(task.id, periodKey),
            taskId: task.id,
            periodKey,
            done: countDone == null ? true : countDone >= target,
            ...(countDone != null ? { countDone } : {}),
            updatedAt: at,
            provenance,
          }),
        };
      }
      const currency =
        input.savings?.currency != null ? clampInt(input.savings.currency, MAX_SAVINGS_AMOUNT) : undefined;
      const tickets = input.savings?.tickets != null ? clampInt(input.savings.tickets, MAX_SAVINGS_AMOUNT) : undefined;
      if (currency != null || tickets != null) {
        const current = game.savings;
        const savings = {
          ...(current ?? { participation: 1, goals: [] }),
          currency: currency ?? current?.currency ?? 0,
          tickets: tickets ?? current?.tickets ?? 0,
          takenAt: Math.max(1, observedAt),
        };
        s = { ...s, games: patchIn(s.games, game.id, { savings }) };
      }
      for (const item of input.events ?? []) {
        const event = s.events.find((ev) => ev.id === item.eventId && ev.gameId === game.id && !ev.deleted);
        if (event) s = { ...s, events: patchIn(s.events, event.id, eventProgressPatch(event, item.progress)) };
      }
      return s;
    }, 'Screenshot reading');
  },

  applyConnectorObservation(gameId, obs) {
    let applied = 0;
    get().batch((s) => {
      const result = applyObservation(s, gameId, obs, now(), uid(), uid);
      applied = result.applied;
      return result.applied > 0 ? result.state : s;
    }, 'Live reading sync');
    return applied;
  },

  adjustEnergy(resourceId, delta) {
    get().mutate((s) => {
      const res = s.resources.find((r) => r.id === resourceId && !r.deleted);
      if (!res) return s;
      const game = s.games.find((g) => g.id === res.gameId);
      const snap = latestSnapshots(s.snapshots).get(resourceId);
      const at = now();
      const proj = projectEnergy(res, snap, at, game);
      const next = Math.max(0, Math.min(res.cap, proj.value + delta));
      // Persist the PROJECTED reserve, not the snapshot's — reserve keeps growing
      // while the bar is capped and a quick adjustment must not roll it back.
      const rawReserve = res.reserveCap > 0 ? (proj.reserve ?? snap?.reserve) : undefined;
      const clampedReserve =
        rawReserve != null ? Math.min(res.reserveCap, Math.max(0, Math.round(rawReserve))) : undefined;
      // Preserve fractional regeneration phase across +/- spends when below cap.
      let takenAtOverride: number | undefined;
      if (
        effectiveResourceKind(res) === 'regen' &&
        res.regenMinutes > 0 &&
        snap &&
        proj.value < res.cap &&
        next < res.cap
      ) {
        const frac = proj.precise - Math.floor(proj.precise);
        if (frac > 1e-6 && frac < 1 - 1e-6) {
          takenAtOverride = at - Math.round(frac * res.regenMinutes * 60_000);
        }
      }
      return recordEnergySnapshot(
        s,
        { resourceId, value: next, ...(clampedReserve != null ? { reserve: clampedReserve } : {}) },
        at,
        takenAtOverride,
      );
    });
  },

  importRemoteEvents(payload) {
    let bytes = Infinity;
    try {
      bytes = new TextEncoder().encode(JSON.stringify(payload)).byteLength;
    } catch {
      /* Invalid input is rejected below. */
    }
    const parsed = bytes <= MAX_EVENT_FEED_BYTES ? RemoteEventFeedSchema.safeParse(payload) : null;
    if (!parsed?.success) return { applied: 0, skipped: true, error: 'Event update was invalid. Kept saved events.' };
    const feed = parsed.data;
    const at = now();
    const generatedAt = Date.parse(feed.generatedAt);
    const current = get().state.settings.remoteFeedVersion;
    if (generatedAt > at + 300_000 || feed.seedUpdated > new Date(at).toISOString().slice(0, 10))
      return { applied: 0, skipped: true, error: 'Event update has a future date.' };
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
    }, 'Feed import');
    return { applied: plan.length, skipped: false };
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

  deleteEvent(id) {
    get().mutate((s) => ({ ...s, events: tombstone(s.events, (e) => e.id === id) }));
  },

  setEventProgress(eventId, progress) {
    const event = liveEvent(get().state, eventId);
    if (event) get().upsertEvent({ id: event.id, gameId: event.gameId, ...eventProgressPatch(event, progress) });
  },

  toggleEventDone(eventId) {
    const event = liveEvent(get().state, eventId);
    if (event) get().setEventProgress(eventId, event.done === true ? 'none' : 'done');
  },

  setEventPartsDone(eventId, partsDone) {
    const event = liveEvent(get().state, eventId);
    if (event) get().upsertEvent({ id: event.id, gameId: event.gameId, ...eventPartsPatch(event, partsDone) });
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

  addReminder(message, at, gameId, repeatDays, style) {
    const repeat = repeatDays && repeatDays >= 1 ? { repeatDays: Math.min(365, Math.round(repeatDays)) } : {};
    get().mutate((s) => ({
      ...s,
      reminders: [
        ...s.reminders,
        { id: uid(), gameId, message, at, ...repeat, ...(style ? { style } : {}), updatedAt: now() } satisfies Reminder,
      ],
    }));
  },

  updateReminder(id, patch) {
    if (!patch.message.trim() || !Number.isFinite(patch.at)) return;
    get().mutate((s) => {
      if (!s.reminders.some((item) => item.id === id && !item.deleted)) return s;
      const changes: Partial<Reminder> = { message: patch.message.trim(), at: patch.at };
      if (patch.repeatDays !== undefined)
        changes.repeatDays = patch.repeatDays ? Math.min(365, Math.round(patch.repeatDays)) : undefined;
      if (patch.style !== undefined) changes.style = patch.style ?? undefined;
      return { ...s, reminders: patchIn(s.reminders, id, changes) };
    });
  },

  deleteReminder(id) {
    get().mutate((s) => ({ ...s, reminders: tombstone(s.reminders, (r) => r.id === id) }));
  },

  setQuestMarks(gameId, marks) {
    if (!marks.length) return;
    get().mutate((s) => {
      const byId = new Map(s.questMarks.map((mark) => [mark.id, mark]));
      let changed = false;
      const at = now();
      for (const { questId, partId, state } of marks) {
        const id = questMarkId(gameId, questId, partId);
        const existing = byId.get(id);
        const live = existing && !existing.deleted ? existing.state : null;
        if (live === state) continue;
        changed = true;
        if (state == null) byId.set(id, { ...existing!, deleted: true, updatedAt: at });
        else
          byId.set(id, {
            id,
            gameId,
            questId,
            ...(partId != null ? { partId } : {}),
            state,
            updatedAt: at,
          });
      }
      return changed ? { ...s, questMarks: [...byId.values()] } : s;
    });
  },

  saveCustomQuest(quest) {
    const id = quest.id ?? uid();
    get().mutate((s) => {
      const row: CustomQuest = { ...quest, id, updatedAt: now() };
      const exists = s.customQuests.some((item) => item.id === id);
      return {
        ...s,
        customQuests: exists ? s.customQuests.map((item) => (item.id === id ? row : item)) : [...s.customQuests, row],
      };
    });
    return id;
  },

  saveNote(patch) {
    const id = patch.id ?? uid();
    get().mutate((s) => {
      const existing = s.notes.find((note) => note.id === id);
      const row: Note = existing
        ? { ...existing, ...patch, id, updatedAt: now() }
        : {
            gameId: null,
            title: '',
            body: '',
            sort: nextNoteSort(s.notes),
            ...patch,
            id,
            updatedAt: now(),
          };
      // Saving what is already there (a blur with no edit) changes nothing.
      const same = (Object.keys(patch) as (keyof typeof patch)[]).every((key) =>
        Object.is(existing?.[key], patch[key]),
      );
      if (existing && !existing.deleted && same) return s;
      return { ...s, notes: existing ? s.notes.map((note) => (note.id === id ? row : note)) : [...s.notes, row] };
    });
    return id;
  },

  deleteNote(id) {
    get().mutate((s) =>
      s.notes.some((note) => note.id === id && !note.deleted)
        ? { ...s, notes: tombstone(s.notes, (note) => note.id === id) }
        : s,
    );
  },

  restoreNote(id) {
    get().mutate((s) =>
      s.notes.some((note) => note.id === id && note.deleted)
        ? {
            ...s,
            notes: s.notes.map((note) => (note.id === id ? { ...note, deleted: false, updatedAt: now() } : note)),
          }
        : s,
    );
  },

  deleteCustomQuest(id) {
    get().mutate((s) => {
      const quest = s.customQuests.find((item) => item.id === id);
      if (!quest) return s;
      const lineId = `${CUSTOM_QUEST_PREFIX}${id}`;
      return {
        ...s,
        customQuests: tombstone(s.customQuests, (item) => item.id === id),
        questMarks: tombstone(
          s.questMarks,
          (mark) => mark.gameId === quest.gameId && mark.questId === lineId && !mark.deleted,
        ),
      };
    });
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

  markCatchUpRead(presetKey, keys) {
    get().mutate((s) => {
      const current = s.settings.catchUpSeen?.[presetKey] ?? [];
      const next = [...new Set([...current, ...keys])].sort();
      if (next.length === current.length) return s;
      return {
        ...s,
        settings: {
          ...s.settings,
          catchUpSeen: { ...s.settings.catchUpSeen, [presetKey]: next },
          updatedAt: now(),
          fieldUpdatedAt: settingsFieldClocks(s.settings),
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
      // A backup file is not a peer: an older one is migrated like local data
      // (the schema refuses a newer one). The protocol gate is for live sync.
      const parsed = safeParseAppState(raw);
      if (!parsed.success) return false;
      // Imports do not go through stateForStorage, so apply the shared schema
      // migrations and the temporary legacy badge repair at this boundary too.
      // Keep original clocks so impossible future readings are discarded before
      // merge, as they are for sync. Schema transforms would promote them to now.
      const migrated = migrateLegacyIdentity(migrateGenshinBadge(normalizeState(raw)).state).state;
      get().batch((s) => mergeState(s, migrated), 'Backup import');
      return true;
    } catch {
      return false;
    }
  },
}));
