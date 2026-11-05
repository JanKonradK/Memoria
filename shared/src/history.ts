import type { AppState, Hlc, SettingsField } from './types';
import { RECORD_COLLECTIONS, compareHlc, legacyHlc, recordHlc, stateClocks, tickHlc } from './hlc';

type Collection = (typeof RECORD_COLLECTIONS)[number] | 'settings';
type Row = Record<string, unknown>;
export interface RecordChange {
  collection: Collection;
  id: string;
  before?: Row;
  after?: Row;
}
export interface JournalEntry {
  id: string;
  at: number;
  label: string;
  changes: RecordChange[];
  undone?: boolean;
}
export interface Checkpoint {
  id: string;
  at: number;
  label: string;
  state: AppState;
}
/** Device-local only. Persist beside state in the SAME atomic write; never export it. */
export interface LocalHistory {
  deviceId: string;
  clock?: Hlc;
  journal: JournalEntry[];
  checkpoints: Checkpoint[];
}
export function emptyHistory(deviceId: string): LocalHistory {
  return { deviceId, journal: [], checkpoints: [] };
}
const META = new Set(['hlc', 'deviceId', 'updatedAt', 'fieldHlc', 'fieldUpdatedAt']);
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}
export const sameValue = (a: unknown, b: unknown): boolean =>
  JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
function body(row?: Row): Row | undefined {
  return row && Object.fromEntries(Object.entries(row).filter(([key]) => !META.has(key)));
}
function rows(state: AppState, key: Collection): Row[] {
  return (
    (key === 'settings' ? [state.settings ?? {}] : Array.isArray(state[key]) ? state[key] : []) as unknown[]
  ).filter((row): row is Row => !!row && typeof row === 'object');
}
function rowId(row: Row): string {
  return typeof row.id === 'string' ? row.id : 'settings';
}
function put(state: AppState, key: Collection, list: Row[]): void {
  (state as unknown as Row)[key] = key === 'settings' ? list[0] : list;
}
export function diffState(before: AppState, after: AppState): RecordChange[] {
  const changes: RecordChange[] = [];
  for (const collection of [...RECORD_COLLECTIONS, 'settings'] as Collection[]) {
    const left = new Map(rows(before, collection).map((row) => [rowId(row), row]));
    const right = new Map(rows(after, collection).map((row) => [rowId(row), row]));
    for (const id of new Set([...left.keys(), ...right.keys()])) {
      const a = left.get(id),
        b = right.get(id);
      if (!sameValue(a, b)) changes.push({ collection, id, ...(a ? { before: a } : {}), ...(b ? { after: b } : {}) });
    }
  }
  return changes;
}
/** Stamp all changed rows once per action, after observing every received clock. */
export function stampChanges(
  before: AppState,
  candidate: AppState,
  history: LocalHistory,
  at: number,
): { state: AppState; clock: Hlc } {
  const observed = [
    ...stateClocks(before),
    ...stateClocks(candidate),
    ...(history.clock ? [history.clock] : []),
  ].reduce((a, b) => (compareHlc(a, b) >= 0 ? a : b), legacyHlc());
  const clock = tickHlc(history.deviceId, at, observed);
  const state = { ...candidate };
  for (const collection of [...RECORD_COLLECTIONS, 'settings'] as Collection[]) {
    const previous = new Map(rows(before, collection).map((row) => [rowId(row), row]));
    const candidateRows = rows(candidate, collection);
    const stampedRows = candidateRows.map((row) => {
      const old = previous.get(rowId(row));
      if (sameValue(body(old), body(row))) return old ?? row;
      const result = { ...row, hlc: clock, deviceId: history.deviceId, updatedAt: at };
      if (collection === 'settings') {
        const fieldHlc = { ...before.settings.fieldHlc };
        for (const field of ['quietStart', 'quietEnd', 'localTz', 'sleepHours'] as SettingsField[]) {
          fieldHlc[field] = sameValue(old?.[field], row[field])
            ? (before.settings.fieldHlc?.[field] ?? {
                ...recordHlc(before.settings),
                wall: before.settings.fieldUpdatedAt?.[field] ?? recordHlc(before.settings).wall,
              })
            : clock;
        }
        Object.assign(result, { fieldHlc });
      }
      return result;
    });
    const unchanged = stampedRows.every((row, index) => row === candidateRows[index]);
    if (!unchanged) put(state, collection, stampedRows);
  }
  return { state, clock };
}
/** UTF-8 bytes without TextEncoder (the PC QuickJS runtime has none). */
function jsonBytes(value: unknown): number {
  const text = JSON.stringify(value);
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes++;
    else if (code < 0x800) bytes += 2;
    else if (
      code >= 0xd800 &&
      code <= 0xdbff &&
      i + 1 < text.length &&
      text.charCodeAt(i + 1) >= 0xdc00 &&
      text.charCodeAt(i + 1) <= 0xdfff
    ) {
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return bytes;
}
function bounded<T>(items: T[], count: number, bytes: number): T[] {
  let result = items.slice(-count);
  while (result.length && jsonBytes(result) > bytes) result = result.slice(1);
  return result;
}
export function checkpoint(
  history: LocalHistory,
  state: AppState,
  label: string,
  at: number,
  id: string,
): LocalHistory {
  return { ...history, checkpoints: bounded([...history.checkpoints, { id, at, label, state }], 12, 4_000_000) };
}
export function recordAction(
  history: LocalHistory,
  before: AppState,
  after: AppState,
  label: string,
  at: number,
  id: string,
): LocalHistory {
  const changes = diffState(before, after);
  if (!changes.length && before.schemaVersion === after.schemaVersion) return history;
  const first = changes.find((change) => change.collection === 'games') ?? changes[0];
  const name = first?.after?.name ?? first?.before?.name ?? first?.collection;
  const actionLabel =
    label === 'Edit'
      ? `${first?.after?.deleted && !first.before?.deleted ? 'Delete' : !first?.before ? 'Add' : 'Edit'}: ${name}`
      : label;
  return {
    ...history,
    journal: bounded([...history.journal, { id, at, label: actionLabel, changes }], 500, 4_000_000),
  };
}
/** New tombstones remove rows created since the checkpoint. The caller stamps ALL differences. */
export function restoreCheckpoint(current: AppState, saved: AppState): AppState {
  const result = { ...saved };
  for (const collection of RECORD_COLLECTIONS) {
    const wanted = new Set(rows(saved, collection).map(rowId));
    put(result, collection, [
      ...rows(saved, collection),
      ...rows(current, collection)
        .filter((row) => !wanted.has(rowId(row)))
        .map((row) => ({ ...row, deleted: true })),
    ]);
  }
  return result;
}
/** Conditional inverse, per field. Later actions protect even fields set back to the same value. */
export function undoAction(current: AppState, entry: JournalEntry, later: JournalEntry[] = []): AppState {
  const result = { ...current };
  for (const change of entry.changes) {
    const list = rows(result, change.collection).slice();
    const index = list.findIndex((row) => rowId(row) === change.id);
    const live = list[index];
    const protectedFields = new Set(
      later.flatMap((action) =>
        action.changes
          .filter((item) => item.collection === change.collection && item.id === change.id)
          .flatMap((item) =>
            [...new Set([...Object.keys(body(item.before) ?? {}), ...Object.keys(body(item.after) ?? {})])].filter(
              (field) => !sameValue(item.before?.[field], item.after?.[field]),
            ),
          ),
      ),
    );
    if (!change.before) {
      // A later edit to a newly created item keeps that item.
      if (live && !protectedFields.size && sameValue(body(live), body(change.after)))
        list[index] = { ...live, deleted: true };
    } else if (!live) {
      if (!protectedFields.size) list.push(change.before);
    } else {
      const restored = { ...live };
      for (const field of new Set([...Object.keys(change.before), ...Object.keys(change.after ?? {})])) {
        if (
          META.has(field) ||
          field === 'id' ||
          protectedFields.has(field) ||
          sameValue(change.before[field], change.after?.[field])
        )
          continue;
        if (!sameValue(live[field], change.after?.[field])) continue;
        if (field in change.before) restored[field] = change.before[field];
        else delete restored[field];
      }
      list[index] = restored;
    }
    put(result, change.collection, list);
  }
  return result;
}
