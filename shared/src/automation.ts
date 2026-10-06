import { z } from 'zod';
import type { AppState, Completion, ObservationProvenance, Snapshot } from './types';
import { latestSnapshots } from './energy';
import { completionId } from './checklist';
import { taskPeriodKey } from './periods';
import { effectiveCountTarget, effectiveTaskMode } from './tracking';
import { AppStateSchema } from './validation';

export interface GameImportSource {
  kind: 'account' | 'screenshot';
  provider: string;
}

export interface ResourceObservation {
  resourceId: string;
  value: number | null;
  reserve?: number | null;
  confidence?: number;
  confirmed?: boolean;
}

export interface TaskObservation {
  taskId: string;
  done: boolean | null;
  countDone?: number | null;
  confidence?: number;
  confirmed?: boolean;
}

/** Evidence only. Account credentials and screenshot pixels never enter this object. */
export interface GameImportBatch {
  id: string;
  gameId: string;
  observedAt: number;
  source: GameImportSource;
  resources?: ResourceObservation[];
  tasks?: TaskObservation[];
}

const id = z.string().min(1).max(160);
const confidence = {
  confidence: z.number().finite().min(0).max(1).optional(),
  confirmed: z.boolean().optional(),
};

export const GameImportBatchSchema = z.object({
  id,
  gameId: id,
  observedAt: z.number().int().nonnegative(),
  source: z.object({ kind: z.enum(['account', 'screenshot']), provider: z.string().trim().min(1).max(80) }),
  resources: z
    .array(
      z.object({
        resourceId: id,
        value: z.number().finite().nonnegative().nullable(),
        reserve: z.number().finite().nonnegative().nullable().optional(),
        ...confidence,
      }),
    )
    .max(100)
    .optional(),
  tasks: z
    .array(
      z.object({
        taskId: id,
        done: z.boolean().nullable(),
        countDone: z.number().int().nonnegative().max(365).nullable().optional(),
        ...confidence,
      }),
    )
    .max(100)
    .optional(),
});

export type GameImportIssueReason =
  | 'invalid'
  | 'wrong-game'
  | 'stale'
  | 'duplicate'
  | 'unknown'
  | 'needs-review'
  | 'unsupported'
  | 'changed'
  | 'no-history';

export interface GameImportIssue {
  fieldId: string;
  reason: GameImportIssueReason;
  message: string;
}

export interface PlannedResourceImport {
  resourceId: string;
  value: number;
  reserve?: number;
}

export interface PlannedTaskImport {
  taskId: string;
  periodKey: string;
  done: boolean;
  countDone?: number;
}

export interface GameImportPlan {
  batch: GameImportBatch;
  resources: PlannedResourceImport[];
  tasks: PlannedTaskImport[];
  issues: GameImportIssue[];
}

export interface GameImportResult {
  batchId: string;
  applied: number;
  skipped: number;
  issues: GameImportIssue[];
}

/** Device-local undo receipts. These never enter the synced state document. */
export interface GameImportHistoryEntry extends GameImportResult {
  gameId: string;
  source: GameImportSource;
  observedAt: number;
  importedAt: number;
  status: 'applied' | 'undone' | 'partial';
  undoneAt?: number;
  resources: { resourceId: string; afterId: string; before?: Snapshot }[];
  tasks: { after: Completion; before?: Completion }[];
}

export const GameImportHistorySchema = z
  .array(
    z.object({
      batchId: id,
      gameId: id,
      source: GameImportBatchSchema.shape.source,
      observedAt: z.number().int().nonnegative(),
      importedAt: z.number().int().nonnegative(),
      applied: z.number().int().nonnegative().max(200),
      skipped: z.number().int().nonnegative().max(201),
      issues: z
        .array(
          z.object({
            fieldId: id,
            reason: z.enum([
              'invalid',
              'wrong-game',
              'stale',
              'duplicate',
              'unknown',
              'needs-review',
              'unsupported',
              'changed',
              'no-history',
            ]),
            message: z.string().max(500),
          }),
        )
        .max(201),
      status: z.enum(['applied', 'undone', 'partial']),
      undoneAt: z.number().int().nonnegative().optional(),
      resources: z
        .array(z.object({ resourceId: id, afterId: id, before: AppStateSchema.shape.snapshots.element.optional() }))
        .max(100),
      tasks: z
        .array(
          z.object({
            after: AppStateSchema.shape.completions.element,
            before: AppStateSchema.shape.completions.element.optional(),
          }),
        )
        .max(100),
    }),
  )
  .max(40);

/** Compare observed time, never fetch time: late imports cannot beat newer edits. */
export function planGameImport(state: AppState, input: GameImportBatch, now: number = Date.now()): GameImportPlan {
  const plan: GameImportPlan = { batch: input, resources: [], tasks: [], issues: [] };
  const issue = (fieldId: string, reason: GameImportIssueReason, message: string) => {
    plan.issues.push({ fieldId, reason, message });
  };
  const parsed = GameImportBatchSchema.safeParse(input);
  if (!parsed.success || !Number.isFinite(now)) {
    issue('batch', 'invalid', 'The import has invalid fields. No values were changed.');
    return plan;
  }
  const batch = parsed.data;
  plan.batch = batch;
  if (batch.observedAt > now) {
    issue('batch', 'invalid', 'The reading time is in the future.');
    return plan;
  }
  const game = state.games.find((item) => item.id === batch.gameId && !item.deleted);
  if (!game) {
    issue('batch', 'wrong-game', 'Choose an existing game account for this import.');
    return plan;
  }
  if ([...state.snapshots, ...state.completions].some((row) => row.provenance?.batchId === batch.id)) {
    issue('batch', 'duplicate', 'This import was already applied.');
    return plan;
  }
  const latest = latestSnapshots(state.snapshots);
  const repeatedResources = new Set(
    (batch.resources ?? [])
      .filter((item, index, list) => list.findIndex((other) => other.resourceId === item.resourceId) !== index)
      .map((item) => item.resourceId),
  );
  const repeatedTasks = new Set(
    (batch.tasks ?? [])
      .filter((item, index, list) => list.findIndex((other) => other.taskId === item.taskId) !== index)
      .map((item) => item.taskId),
  );
  const needsReview = (observation: { confidence?: number; confirmed?: boolean }) =>
    batch.source.kind === 'screenshot' && !observation.confirmed && (observation.confidence ?? 0) < 0.9;

  for (const observation of batch.resources ?? []) {
    const fieldId = observation.resourceId;
    if (repeatedResources.has(fieldId)) {
      issue(fieldId, 'duplicate', 'The resource appears more than once.');
      continue;
    }
    const resource = state.resources.find((item) => item.id === fieldId && !item.deleted);
    const previous = latest.get(fieldId);
    const initialEstimate = previous?.provenance?.kind === 'estimate' && resource?.updatedAt === previous.takenAt;
    if (!resource || resource.gameId !== game.id) {
      issue(fieldId, 'wrong-game', 'This resource does not belong to the selected account.');
    } else if (observation.value == null) {
      issue(fieldId, 'unknown', 'No resource reading was supplied.');
    } else if (needsReview(observation)) {
      issue(fieldId, 'needs-review', 'Confirm the detected value before importing it.');
    } else if (
      observation.value > resource.cap ||
      (observation.reserve != null && observation.reserve > resource.reserveCap)
    ) {
      issue(fieldId, 'invalid', 'The detected value exceeds the configured capacity.');
    } else if (
      (!initialEstimate && resource.updatedAt > batch.observedAt) ||
      (previous?.provenance?.kind !== 'estimate' && (previous?.takenAt ?? -1) >= batch.observedAt)
    ) {
      issue(fieldId, 'stale', 'A newer reading or resource edit is already saved.');
    } else {
      plan.resources.push({
        resourceId: fieldId,
        value: observation.value,
        ...(observation.reserve == null ? {} : { reserve: observation.reserve }),
      });
    }
  }

  for (const observation of batch.tasks ?? []) {
    const fieldId = observation.taskId;
    if (repeatedTasks.has(fieldId)) {
      issue(fieldId, 'duplicate', 'The task appears more than once.');
      continue;
    }
    const task = state.tasks.find((item) => item.id === fieldId && !item.deleted);
    if (!task || task.gameId !== game.id) {
      issue(fieldId, 'wrong-game', 'This task does not belong to the selected account.');
      continue;
    }
    if (observation.done == null && observation.countDone == null) {
      issue(fieldId, 'unknown', 'No task progress was supplied.');
      continue;
    }
    if (needsReview(observation)) {
      issue(fieldId, 'needs-review', 'Confirm the detected task progress before importing it.');
      continue;
    }
    if (task.cadence === 'custom' || effectiveTaskMode(task) === 'timer') {
      issue(fieldId, 'unsupported', 'Timer and custom-window tasks still need manual input.');
      continue;
    }
    const periodKey = taskPeriodKey(game, task, batch.observedAt);
    if (periodKey !== taskPeriodKey(game, task, now)) {
      issue(fieldId, 'stale', 'This task reading is from an earlier reset period.');
      continue;
    }
    const existing = state.completions.find((row) => row.id === completionId(fieldId, periodKey));
    if (task.updatedAt > batch.observedAt || (existing?.updatedAt ?? -1) >= batch.observedAt) {
      issue(fieldId, 'stale', 'A newer task edit is already saved.');
      continue;
    }
    const isCount = effectiveTaskMode(task) === 'count';
    const target = effectiveCountTarget(task);
    // "Not complete" cannot tell us how many runs remain. Preserve that unknown.
    if (isCount && observation.countDone == null && observation.done !== true) {
      issue(fieldId, 'unknown', 'The number completed is unknown.');
      continue;
    }
    if (!isCount && observation.done == null) {
      issue(fieldId, 'unknown', 'Completion is unknown for this task.');
      continue;
    }
    const countDone = isCount ? (observation.countDone ?? target) : undefined;
    if (countDone != null && countDone > target) {
      issue(fieldId, 'invalid', 'Task progress exceeds the configured target.');
      continue;
    }
    plan.tasks.push({
      taskId: fieldId,
      periodKey,
      done: countDone == null ? observation.done! : countDone >= target,
      ...(countDone == null ? {} : { countDone }),
    });
  }
  return plan;
}

export function importProvenance(batch: GameImportBatch, importedAt: number): ObservationProvenance {
  return { ...batch.source, observedAt: batch.observedAt, importedAt, batchId: batch.id };
}
