// The merge and validation the Windows app runs on its own data file.
//
// Bundled for QuickJS inside Memoria.exe (see desktop/tauri/src/core.rs), so
// the PC merges phone and window edits with exactly the code the app runs.
// Rust does the file reads and writes; everything about the document's shape
// stays here.
import { buildNotificationPlan, mergeState, normalizeState, safeParseAppState } from '@memoria/shared';

const parse = (raw) => (raw == null ? null : JSON.parse(raw));

/** The saved document, normalized, as JSON. `raw` is null when there is no file yet. */
export function read(raw) {
  return JSON.stringify(normalizeState(parse(raw)));
}

/** The same device plan as Android, evaluated against the current PC data file. */
export function notificationPlan(raw, now) {
  return JSON.stringify(buildNotificationPlan(normalizeState(parse(raw)), now));
}

/**
 * Merges an incoming document into the saved one.
 * Returns `{ status, json, changed }` or `{ status, error }`.
 */
export function merge(raw, incomingJson) {
  let incoming;
  try {
    incoming = JSON.parse(incomingJson);
  } catch {
    return { status: 400, error: 'Request body is not valid JSON.' };
  }
  const state = incoming?.state;
  const parsed = safeParseAppState(state);
  if (!parsed.success) return { status: 400, error: `Invalid app state: ${parsed.error}` };
  const current = normalizeState(parse(raw));
  let combined;
  try {
    // Normalizing the incoming copy first drops impossible future readings
    // before they can replace the current PC reading.
    combined = mergeState(current, normalizeState(state));
  } catch (error) {
    if (error?.name === 'StateCapacityError') return { status: 413, error: error.message };
    throw error;
  }
  const merged = safeParseAppState(combined);
  if (!merged.success) return { status: 500, error: 'The merged state failed validation. No data was changed.' };
  const json = JSON.stringify(merged.data);
  return { status: 200, json, changed: json !== JSON.stringify(current) };
}
