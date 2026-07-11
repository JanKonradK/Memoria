import type { AppState, Cadence, Game, GameEvent, Task } from './types';
import { taskNextReset, taskPeriodKey } from './periods';

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

/** All checklist items for a game right now (tasks + active dailyTouch events). */
export function checklistFor(state: AppState, game: Game, now: number): ChecklistItem[] {
  const doneByKey = new Map<string, boolean>();
  for (const c of state.completions) {
    if (isLive(c)) doneByKey.set(c.id, c.done);
  }
  const tasks: Task[] = [
    ...state.tasks.filter((t) => t.gameId === game.id && isLive(t)),
    ...state.events
      .filter((e) => e.gameId === game.id && isLive(e) && e.dailyTouch && e.start <= now && e.end > now)
      .map(eventAsDailyTask),
  ];
  return tasks
    .map((t) => {
      const periodKey = taskPeriodKey(game, t, now);
      return {
        taskId: t.id,
        gameId: game.id,
        name: t.name,
        cadence: t.cadence,
        periodKey,
        resetAt: taskNextReset(game, t, now),
        done: doneByKey.get(`${t.id}|${periodKey}`) ?? false,
        fromEvent: t.id.startsWith('evt:'),
        sort: t.sort,
      };
    })
    .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
}

export function completionId(taskId: string, periodKey: string): string {
  return `${taskId}|${periodKey}`;
}
