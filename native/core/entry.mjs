// The state rules the Rust desktop host runs in QuickJS. The parity test
// (native/core/parity.mjs) checks QuickJS gives the same answers as Node.
// Rust owns disk, size limits and locking. This file only decides content.
import { mergeState, normalizeState, safeParseAppState } from '@memoria/shared';

const fail = (status, error) => ({ status, error });

/** @param {string | null} raw state.json text, or null when there is none. */
export function read(raw) {
  return { state: normalizeState(raw === null ? null : JSON.parse(raw)) };
}

/**
 * @param {string | null} raw state.json text, or null when there is none.
 * @param {string} body the request body, already checked to be JSON by Rust.
 */
export function merge(raw, body) {
  const incoming = JSON.parse(body)?.state;
  const parsed = safeParseAppState(incoming);
  if (!parsed.success) return fail(400, `Invalid app state: ${parsed.error}`);
  const current = normalizeState(raw === null ? null : JSON.parse(raw));
  let combined;
  try {
    // Normalize the incoming copy with its original clocks, so impossible
    // future readings are dropped before they can replace the PC reading.
    combined = mergeState(current, normalizeState(incoming));
  } catch (error) {
    if (error?.name === 'StateCapacityError') return fail(413, error.message);
    throw error;
  }
  const merged = safeParseAppState(combined);
  if (!merged.success) return fail(500, 'The merged state failed validation. No data was changed.');
  const json = JSON.stringify(merged.data);
  return { json, changed: json !== JSON.stringify(current) };
}
