import type { AppState, Hlc, Syncable } from './types';
import { CURRENT_SCHEMA_VERSION } from './types';

export const RECORD_COLLECTIONS = [
  'games',
  'resources',
  'snapshots',
  'tasks',
  'completions',
  'events',
  'chips',
  'alertRules',
  'reminders',
] as const;
export const UNKNOWN_DEVICE = 'Unknown device';
export function legacyHlc(at = 0): Hlc {
  return {
    wall: Number.isFinite(at) ? Math.max(0, Math.min(Number.MAX_SAFE_INTEGER - 1, Math.round(at))) : 0,
    counter: 0,
    device: UNKNOWN_DEVICE,
  };
}
export function compareHlc(a: Hlc, b: Hlc): number {
  return a.wall - b.wall || a.counter - b.counter || (a.device < b.device ? -1 : a.device > b.device ? 1 : 0);
}
export function recordHlc(row: Partial<Syncable> & { takenAt?: number }): Hlc {
  return row.hlc ?? legacyHlc(row.updatedAt ?? row.takenAt);
}
/** Receive first, then tick. No wall-clock bound: a slow clock can still edit. */
export function tickHlc(device: string, at: number, ...observed: Hlc[]): Hlc {
  const wall = Math.max(Math.max(0, Math.round(at)), ...observed.map((clock) => clock.wall));
  const counter = Math.max(-1, ...observed.filter((clock) => clock.wall === wall).map((clock) => clock.counter)) + 1;
  if (!Number.isSafeInteger(wall) || !Number.isSafeInteger(counter) || counter >= Number.MAX_SAFE_INTEGER - 1)
    throw new Error('The change clock is full. Export a backup.');
  return { wall, counter, device };
}
export function stateClocks(state: AppState): Hlc[] {
  return [
    recordHlc(state.settings),
    ...Object.values(state.settings.fieldHlc ?? {}),
    ...RECORD_COLLECTIONS.flatMap((key) => state[key].map(recordHlc)),
  ];
}
export class SyncProtocolError extends Error {
  constructor() {
    super('Update Memoria on all devices before syncing or importing this backup. No data was changed.');
    this.name = 'SyncProtocolError';
  }
}
/** Check the original document, before normalization can migrate it. */
export function assertSyncProtocol(raw: unknown): void {
  if (!raw || typeof raw !== 'object' || (raw as { schemaVersion?: unknown }).schemaVersion !== CURRENT_SCHEMA_VERSION)
    throw new SyncProtocolError();
}
