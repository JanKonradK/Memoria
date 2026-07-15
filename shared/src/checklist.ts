import type { AppState, Cadence, Game, GameEvent, Task, TaskMode } from './types';
import { taskNextReset, taskPeriodKey } from './periods';
import { effectiveCountTarget, effectiveTaskMode, effectiveTimerDurationMinutes } from './tracking';

/**
 * A concrete checklist item for "now": a task (or a daily-touch event exposed
 * as a pseudo-task) plus its current period key and completion state.
 */
export interface ChecklistItem {
  taskId: string;
  gameId: string;
  name: string;
  cadence: Cadence;
  periodKey: string;
  /** Epoch ms when this period resets. */
  resetAt: number;
  done: boolean;
  mode: TaskMode;
  countDone: number;
  countTarget: number;
  timerEndsAt: number | null;
  timerRunning: boolean;
  timerReady: boolean;
  /** True when this item comes from a dailyTouch event, not a real task. */
  fromEvent: boolean;
  sort: number;
}

function eventAsDailyTask(ev: GameEvent): Task {
  return {
    id: `evt:${ev.id}`,
    gameId: ev.gameId,
    name: ev.name,
    cadence: 'daily',
    intervalDays: 1,
    anchorAt: ev.start,
    sort: 1_000_000,
    updatedAt: ev.updatedAt,
  };
}

function isLive(x: { deleted?: boolean }): boolean {
  return !x.deleted;
}

function completionProgress(
  state: AppState,
  task: Task,
  periodKey: string,
  now: number,
): { done: boolean; countDone: number; countTarget: number; timerEndsAt: number | null } {
  const row = state.completions.find((item) => item.id === `${task.id}|${periodKey}` && isLive(item));
  const mode = effectiveTaskMode(task);
  const countTarget = effectiveCountTarget(task);
  const countDone = row?.countDone ?? 0;
  const timerEndsAt = task.timerEndsAt ?? null;
  if (mode === 'count') {
    const done = countDone >= countTarget || Boolean(row?.done);
    return { done, countDone, countTarget, timerEndsAt };
  }
  if (mode === 'timer') {
    const ready = timerEndsAt != null && timerEndsAt <= now;
    const done = Boolean(row?.done) || ready;
    return { done, countDone, countTarget, timerEndsAt };
  }
  return { done: Boolean(row?.done), countDone, countTarget, timerEndsAt };
}

/** All checklist items for a game right now (tasks + active dailyTouch events). */
export function checklistFor(state: AppState, game: Game, now: number): ChecklistItem[] {
  const tasks: Task[] = [
    ...state.tasks.filter((t) => t.gameId === game.id && isLive(t)),
    ...state.events
      .filter((e) => e.gameId === game.id && isLive(e) && !e.done && e.dailyTouch && e.start <= now && e.end > now)
      .map(eventAsDailyTask),
  ];
  return tasks
    .map((t) => {
      const periodKey = taskPeriodKey(game, t, now);
      const mode = effectiveTaskMode(t);
      const progress = completionProgress(state, t, periodKey, now);
      const timerEndsAt = progress.timerEndsAt;
      return {
        taskId: t.id,
        gameId: game.id,
        name: t.name,
        cadence: t.cadence,
        periodKey,
        resetAt: taskNextReset(game, t, now),
        done: progress.done,
        mode,
        countDone: progress.countDone,
        countTarget: progress.countTarget,
        timerEndsAt,
        timerRunning: timerEndsAt != null && timerEndsAt > now,
        timerReady: timerEndsAt != null && timerEndsAt <= now,
        fromEvent: t.id.startsWith('evt:'),
        sort: t.sort,
      };
    })
    .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
}

export function completionId(taskId: string, periodKey: string): string {
  return `${taskId}|${periodKey}`;
}

export function timerDurationMinutes(task: Task): number {
  return effectiveTimerDurationMinutes(task);
}
