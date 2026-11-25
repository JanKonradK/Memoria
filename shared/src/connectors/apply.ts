import { completionId } from '../checklist';
import { eventProgress, eventProgressPatch } from '../event-parts';
import { taskPeriodKey } from '../periods';
import { effectiveCountTarget, effectiveResourceKind, effectiveTaskMode } from '../tracking';
import type { AppState, Completion, GameEvent, ObservationProvenance, Resource, Snapshot, Task } from '../types';
import type { ConnectorObservation, EnergyObservation, EventObservation, TaskObservation } from './hoyolab-map';

/** Readings kept per resource; matches the app store and merge retention. */
export const SNAPSHOTS_KEPT = 200;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

function sameName(a: string | undefined, b: string | undefined): boolean {
  return a != null && b != null && a.trim().toLowerCase() === b.trim().toLowerCase();
}

function matchResource(resources: readonly Resource[], energy: EnergyObservation): Resource | undefined {
  if (energy.primary) {
    const regen = resources.find((res) => effectiveResourceKind(res) === 'regen');
    if (regen) return regen;
  }
  return resources.find((res) => sameName(res.name, energy.resourceName));
}

/**
 * When the reading was "really" taken. The API reports a whole point and the
 * seconds until full; the point in progress has already been ticking for a
 * while. Backdating the snapshot by that much keeps Memoria's projection on
 * the game's own regen phase instead of restarting the partial point.
 */
function readingTakenAt(res: Resource, cap: number, value: number, energy: EnergyObservation, observedAt: number) {
  if (
    energy.recoverySeconds == null ||
    effectiveResourceKind(res) !== 'regen' ||
    !(res.regenMinutes > 0) ||
    value >= cap
  )
    return observedAt;
  const regenSecs = res.regenMinutes * 60;
  const totalFullSecs = (cap - value) * regenSecs;
  const elapsed = clamp(totalFullSecs - energy.recoverySeconds, 0, regenSecs - 1);
  return observedAt - Math.round(elapsed * 1000);
}

function applyEnergy(
  state: AppState,
  res: Resource,
  energy: EnergyObservation,
  obs: ConnectorObservation,
  provenance: ObservationProvenance,
  importedAt: number,
  makeId: () => string,
): AppState {
  const nextCap = energy.cap != null && energy.cap > 0 ? Math.round(energy.cap) : res.cap;
  let resources = state.resources;
  let current = res;
  if (nextCap !== res.cap) {
    current = { ...res, cap: nextCap, updatedAt: importedAt };
    resources = resources.map((row) => (row.id === res.id ? current : row));
  }
  const value = clamp(Math.round(energy.value), 0, nextCap);
  const target = readingTakenAt(current, nextCap, value, energy, obs.observedAt);

  const mine = state.snapshots.filter((snap) => snap.resourceId === res.id);
  mine.sort((a, b) => b.takenAt - a.takenAt);
  // A new reading must win over every real one already stored, even a manual edit made this same millisecond.
  const prevTakenAt = mine.find((snap) => snap.provenance?.kind !== 'estimate')?.takenAt ?? 0;
  const reserve =
    energy.reserve != null && current.reserveCap > 0
      ? clamp(Math.round(energy.reserve), 0, current.reserveCap)
      : undefined;
  const snapshot: Snapshot = {
    id: makeId(),
    resourceId: res.id,
    value,
    takenAt: Math.max(target, prevTakenAt + 1),
    ...(reserve !== undefined ? { reserve } : {}),
    provenance,
    updatedAt: importedAt,
  };
  const keep = new Set(mine.slice(0, SNAPSHOTS_KEPT - 1).map((snap) => snap.id));
  return {
    ...state,
    resources,
    snapshots: [...state.snapshots.filter((snap) => snap.resourceId !== res.id || keep.has(snap.id)), snapshot],
  };
}

function writeCompletion(state: AppState, row: Completion): AppState {
  const index = state.completions.findIndex((item) => item.id === row.id);
  if (index < 0) return { ...state, completions: [...state.completions, row] };
  const completions = state.completions.slice();
  completions[index] = row;
  return { ...state, completions };
}

/** Returns the new state, or null when the observation changes nothing. */
function applyTask(
  state: AppState,
  task: Task,
  taskObs: TaskObservation,
  obs: ConnectorObservation,
  provenance: ObservationProvenance,
  importedAt: number,
): AppState | null {
  const game = state.games.find((g) => g.id === task.gameId);
  if (!game) return null;
  const periodKey = taskPeriodKey(game, task, obs.observedAt);
  const id = completionId(task.id, periodKey);
  const existing = state.completions.find((row) => row.id === id && !row.deleted);
  const mode = effectiveTaskMode(task);
  const markDone = (extra: Partial<Completion> = {}): Completion => ({
    id,
    taskId: task.id,
    periodKey,
    done: true,
    ...extra,
    provenance,
    updatedAt: importedAt,
  });

  if (mode === 'count' && taskObs.countDone != null && Number.isFinite(taskObs.countDone)) {
    const countTarget = effectiveCountTarget(task);
    const before = existing?.countDone ?? 0;
    const countDone = clamp(Math.max(before, Math.round(taskObs.countDone)), 0, countTarget);
    const done = countDone >= countTarget;
    if (existing ? existing.countDone === countDone && existing.done === done : countDone === 0) return null;
    return writeCompletion(state, { ...markDone({ countDone }), done });
  }

  if (mode === 'timer' && taskObs.timerEndsAt !== undefined) {
    let next = state;
    let changed = false;
    if ((task.timerEndsAt ?? null) !== taskObs.timerEndsAt) {
      const updated: Task = { ...task, timerEndsAt: taskObs.timerEndsAt, updatedAt: importedAt };
      next = { ...next, tasks: next.tasks.map((row) => (row.id === task.id ? updated : row)) };
      changed = true;
    }
    // A finished dispatch only ever ticks the row; it never clears a tick the player made.
    const done = taskObs.done !== undefined ? taskObs.done : true;
    if (done && !existing?.done) {
      next = writeCompletion(next, markDone(existing?.countDone != null ? { countDone: existing.countDone } : {}));
      changed = true;
    }
    return changed ? next : null;
  }

  // Check tasks: a reading can tick a row, never un-tick one.
  if (taskObs.done !== true || existing?.done) return null;
  return writeCompletion(state, markDone(existing?.countDone != null ? { countDone: existing.countDone } : {}));
}

/**
 * Writes one connector observation into a game: a snapshot per energy reading
 * (stamped with where it came from) and ticks or counts on the preset tasks it
 * recognises, and raises progress on matching timeline endgame cycles. Pure;
 * `applied` counts the records that changed.
 */
export function applyConnectorObservation(
  state: AppState,
  gameId: string,
  obs: ConnectorObservation,
  importedAt: number,
  batchId: string,
  makeId: () => string,
): { state: AppState; applied: number } {
  const game = state.games.find((g) => g.id === gameId && !g.deleted);
  if (!game) return { state, applied: 0 };
  const provenance: ObservationProvenance = {
    kind: 'account',
    provider: obs.provider,
    observedAt: obs.observedAt,
    importedAt,
    batchId,
  };

  let next = state;
  let applied = 0;
  const liveResources = () =>
    next.resources.filter((res) => res.gameId === gameId && !res.deleted).sort((a, b) => a.sort - b.sort);
  for (const energy of obs.energies) {
    if (!Number.isFinite(energy.value)) continue;
    const res = matchResource(liveResources(), energy);
    if (!res) continue;
    next = applyEnergy(next, res, energy, obs, provenance, importedAt, makeId);
    applied += 1;
  }

  for (const taskObs of obs.tasks) {
    const task = next.tasks.find(
      (row) => row.gameId === gameId && !row.deleted && row.presetTaskKey === taskObs.presetTaskKey,
    );
    if (!task) continue;
    const result = applyTask(next, task, taskObs, obs, provenance, importedAt);
    if (!result) continue;
    next = result;
    applied += 1;
  }

  for (const evObs of obs.events ?? []) {
    const event = matchCycleEvent(next.events, gameId, evObs, obs.observedAt);
    if (!event) continue;
    // Monotonic: a reading never un-ticks an event or turns done back into partly done.
    const current = eventProgress(event);
    if (current === 'done' || (current === 'partial' && evObs.progress === 'partial')) continue;
    const updated: GameEvent = { ...event, ...eventProgressPatch(event, evObs.progress), updatedAt: importedAt };
    next = { ...next, events: next.events.map((row) => (row.id === event.id ? updated : row)) };
    applied += 1;
  }
  return { state: next, applied };
}

/** The live timeline cycle for this game whose window covers the reading and whose name starts with the cycle's. */
function matchCycleEvent(
  events: readonly GameEvent[],
  gameId: string,
  evObs: EventObservation,
  at: number,
): GameEvent | undefined {
  const prefix = evObs.eventName.trim().toLowerCase();
  if (!prefix) return undefined;
  return events.find(
    (ev) =>
      ev.gameId === gameId &&
      !ev.deleted &&
      ev.type === 'cycle' &&
      ev.start <= at &&
      ev.end > at &&
      ev.name.trim().toLowerCase().startsWith(prefix),
  );
}
