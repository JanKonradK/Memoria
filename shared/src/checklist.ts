import type { AppState, Cadence, Game, GameEvent, Task, TaskMode } from './types';
import { taskNextReset, taskPeriodKey } from './periods';
import { effectiveCountTarget, effectiveTaskMode, effectiveTimerDurationMinutes } from './tracking';

/**
 * A concrete checklist item for "now": a task plus its current period key and
 * completion state. Events never appear here — they live in the card's
 * (non-checkable) event strip and on the Timeline.
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
  timerDurationMinutes: number;
  sort: number;
}

/** Generic words that would create false timeline matches ("cycle" appears everywhere). */
const MATCH_STOPWORDS = new Set(['the', 'and', 'per', 'for', 'with', 'cycle', 'event', 'version', 'weekly']);

function words(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function matchTokens(name: string): string[] {
  return words(name).filter((word) => word.length >= 3 && !MATCH_STOPWORDS.has(word));
}

/** First letters of the alphabetic words: "Memory of Chaos 3.5" → "moc". */
function acronymOf(name: string): string {
  return words(name)
    .filter((word) => /^[a-z]/.test(word))
    .map((word) => word[0])
    .join('');
}

/**
 * Does this timeline event belong to the task (explicit keyword, else fuzzy
 * match)? Fuzzy = shared long token ("Hazard"), or a short task token read as
 * an acronym of the event name ("MoC" ↔ "Memory of Chaos").
 */
function eventMatchesTask(task: Task, ev: GameEvent): boolean {
  const keyword = task.timelineMatch?.trim().toLowerCase();
  if (keyword) return ev.name.toLowerCase().includes(keyword);
  const eventTokens = new Set(matchTokens(ev.name));
  if (matchTokens(task.name).some((token) => eventTokens.has(token))) return true;
  const acronym = acronymOf(ev.name);
  if (acronym.length < 2) return false;
  return words(task.name).some(
    (word) => word.length >= 2 && word.length <= 4 && !MATCH_STOPWORDS.has(word) && word === acronym,
  );
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

/** All checklist items for a game right now. */
export function checklistFor(state: AppState, game: Game, now: number): ChecklistItem[] {
  const tasks: Task[] = state.tasks.filter((t) => t.gameId === game.id && isLive(t));
  const liveEvents = state.events.filter((e) => e.gameId === game.id && isLive(e) && !e.done);
  const out: ChecklistItem[] = [];
  for (const t of tasks) {
    let periodKey: string;
    let resetAt: number;
    // Custom cycles follow the Timeline: the check lives inside the matching
    // window (resets when it ends) and hides between windows. Only windows that
    // can still become active count — degenerate (start === end) or fully past
    // events fall back to the internal interval (personal cooldowns).
    const matches =
      t.cadence === 'custom' && t.timelineLinked !== false
        ? liveEvents.filter((e) => e.end > now && e.end > e.start && eventMatchesTask(t, e))
        : [];
    if (matches.length > 0) {
      const active = matches.filter((e) => e.start <= now && e.end > now).sort((a, b) => a.end - b.end)[0];
      if (!active) continue;
      periodKey = `win:${active.id}`;
      resetAt = active.end;
    } else {
      periodKey = taskPeriodKey(game, t, now);
      resetAt = taskNextReset(game, t, now);
    }
    const mode = effectiveTaskMode(t);
    const progress = completionProgress(state, t, periodKey, now);
    const timerEndsAt = progress.timerEndsAt;
    out.push({
      taskId: t.id,
      gameId: game.id,
      name: t.name,
      cadence: t.cadence,
      periodKey,
      resetAt,
      done: progress.done,
      mode,
      countDone: progress.countDone,
      countTarget: progress.countTarget,
      timerEndsAt,
      timerRunning: timerEndsAt != null && timerEndsAt > now,
      timerReady: timerEndsAt != null && timerEndsAt <= now,
      timerDurationMinutes: effectiveTimerDurationMinutes(t),
      sort: t.sort,
    });
  }
  return out.sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
}

export function completionId(taskId: string, periodKey: string): string {
  return `${taskId}|${periodKey}`;
}

export function timerDurationMinutes(task: Task): number {
  return effectiveTimerDurationMinutes(task);
}
