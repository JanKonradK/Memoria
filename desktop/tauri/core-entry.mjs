// The merge and validation the Windows app runs on its own data file.
//
// Bundled for QuickJS inside Memoria.exe (see desktop/tauri/src/core.rs), so
// the PC merges phone and window edits with exactly the code the app runs.
// Rust does the file reads and writes; everything about the document's shape
// stays here.
import {
  assertSyncProtocol,
  boundHistory,
  checkpoint,
  compactState,
  emptyHistory,
  localDayKey,
  recordAction,
  buildNotificationPlan,
  mergeState,
  normalizeState,
  safeParseAppState,
  TOMBSTONE_RETENTION_MS,
} from '@memoria/shared';

const parse = (raw) => (raw == null ? null : JSON.parse(raw));

/** The document without the PC's local history, which older versions kept inside it. */
function withoutHistory(disk) {
  if (!disk || typeof disk !== 'object' || !('localHistory' in disk)) return disk;
  const { localHistory: ignored, ...state } = disk;
  void ignored;
  return state;
}

/** A saved history, or null when it is missing or not a history. */
function readHistory(value) {
  return value && typeof value === 'object' && Array.isArray(value.journal) && Array.isArray(value.checkpoints)
    ? value
    : null;
}

/** history.json, or null when it is missing or damaged. Local history never blocks a sync. */
function parseHistory(raw) {
  try {
    return readHistory(parse(raw));
  } catch {
    return null;
  }
}

/** The saved document, normalized, as JSON. `raw` is null when there is no file yet. */
export function read(raw) {
  return JSON.stringify(normalizeState(withoutHistory(parse(raw))));
}

/** The same device plan as Android, evaluated against the current PC data file. */
export function notificationPlan(raw, now) {
  return JSON.stringify(buildNotificationPlan(normalizeState(withoutHistory(parse(raw))), now));
}

/**
 * Merges an incoming document into the saved one.
 *
 * `rawState` is state.json, `rawHistory` is history.json (null when there is
 * none yet). A state.json written by an older version may still carry its
 * history inside; that is moved out here, and the returned state never has it.
 *
 * Returns `{ status, stateJson, historyJson, changed, historyChanged, json }`
 * (`json` is `stateJson`, kept for older callers) or `{ status, error }`.
 */
export function merge(rawState, rawHistory, incomingJson) {
  // The two-argument form of earlier builds: (rawState, incomingJson).
  if (incomingJson === undefined) {
    incomingJson = rawHistory;
    rawHistory = null;
  }
  let incoming;
  try {
    incoming = JSON.parse(incomingJson);
  } catch {
    return { status: 400, error: 'Request body is not valid JSON.' };
  }
  const state = incoming?.state;
  try {
    assertSyncProtocol(state);
  } catch (error) {
    return { status: 426, error: error.message };
  }
  const parsed = safeParseAppState(state);
  if (!parsed.success) return { status: 400, error: `Invalid app state: ${parsed.error}` };
  const raw = parse(rawState);
  // Older versions kept up to 16 MB of history inside state.json; cut it to today's limits.
  const legacyHistory = raw && typeof raw === 'object' ? readHistory(raw.localHistory) : null;
  // Moving history out of state.json rewrites it even when nothing else changed.
  const migratedHistory = Boolean(raw && typeof raw === 'object' && 'localHistory' in raw);
  const disk = withoutHistory(raw);
  const current = normalizeState(disk);
  let combined;
  try {
    // Normalizing the incoming copy first drops impossible future readings
    // before they can replace the current PC reading.
    combined = mergeState(current, normalizeState(state));
  } catch (error) {
    if (error?.name === 'StateCapacityError') return { status: 413, error: error.message };
    throw error;
  }
  // Tombstones older than the retention window have reached every device;
  // the phone drops them too, so the PC file does not keep growing.
  const now = Date.now();
  combined = compactState(combined, now - TOMBSTONE_RETENTION_MS);
  const merged = safeParseAppState(combined);
  if (!merged.success) return { status: 500, error: 'The merged state failed validation. No data was changed.' };
  const stateJson = JSON.stringify(merged.data);
  const arrived = stateJson !== JSON.stringify(current);
  let changed = migratedHistory || arrived;
  const savedHistory = parseHistory(rawHistory);
  let localHistory = savedHistory ?? (legacyHistory && boundHistory(legacyHistory)) ?? emptyHistory('PC core');
  let historyChanged = savedHistory == null && legacyHistory != null;
  if (disk && disk.schemaVersion !== current.schemaVersion) {
    localHistory = checkpoint(localHistory, disk, 'Before migration', now, `migration-${now}`);
    localHistory = recordAction(localHistory, disk, current, 'Migration', now, `migration-${now}`);
    changed = true;
    historyChanged = true;
  }
  const tz = merged.data.settings.localTz;
  const day = localDayKey(now, tz);
  if (!localHistory.checkpoints.some((item) => item.label === 'Daily checkpoint' && localDayKey(item.at, tz) === day)) {
    localHistory = checkpoint(localHistory, current, 'Daily checkpoint', now, `daily-${day}`);
    historyChanged = true;
  }
  if (arrived) {
    const before = localHistory;
    localHistory = recordAction(
      localHistory,
      current,
      merged.data,
      'Sync arrivals',
      now,
      `sync-${now}-${localHistory.journal.length}`,
    );
    if (localHistory !== before) historyChanged = true;
  }
  const historyJson = JSON.stringify(localHistory);
  return { status: 200, stateJson, historyJson, changed, historyChanged, json: stateJson };
}
