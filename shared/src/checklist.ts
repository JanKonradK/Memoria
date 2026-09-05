import type { AppState, Cadence, Completion, Game, GameEvent, Task, TaskMode } from './types';
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
  timerStepMinutes?: number;
  sort: number;
  /** Pays the game's premium pull currency — see Task.core. */
  core: boolean;
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

export interface ChecklistIndex {
  /** Live completion rows keyed by `${taskId}|${periodKey}`. */
  completions: Map<string, Completion>;
  tasksByGame: Map<string, Task[]>;
  /** Live, unfinished events grouped by game. */
  eventsByGame: Map<string, GameEvent[]>;
}

export function buildChecklistIndex(state: AppState): ChecklistIndex {
  const completions = new Map<string, Completion>();
  for (const completion of state.completions) {
    // `find` returned the first live row if malformed input contained duplicate
    // ids, so preserve that ordering instead of letting Map#set choose the last.
    if (isLive(completion) && !completions.has(completion.id)) completions.set(completion.id, completion);
  }

  const tasksByGame = new Map<string, Task[]>();
  for (const task of state.tasks) {
    if (!isLive(task)) continue;
    const tasks = tasksByGame.get(task.gameId);
    if (tasks) tasks.push(task);
    else tasksByGame.set(task.gameId, [task]);
  }

  const eventsByGame = new Map<string, GameEvent[]>();
  for (const event of state.events) {
    if (!isLive(event) || event.done) continue;
    const events = eventsByGame.get(event.gameId);
    if (events) events.push(event);
    else eventsByGame.set(event.gameId, [event]);
  }

  return { completions, tasksByGame, eventsByGame };
}

function completionProgress(
  completions: Map<string, Completion>,
  task: Task,
  periodKey: string,
): { done: boolean; countDone: number; countTarget: number; timerEndsAt: number | null } {
  const row = completions.get(`${task.id}|${periodKey}`);
  const mode = effectiveTaskMode(task);
  const countTarget = effectiveCountTarget(task);
  const countDone = row?.countDone ?? 0;
  const timerEndsAt = task.timerEndsAt ?? null;
  if (mode === 'count') {
    const done = countDone >= countTarget || Boolean(row?.done);
    return { done, countDone, countTarget, timerEndsAt };
  }
  // Timer tasks fall through to the same rule as checkboxes, and that is the
  // whole point. `done` used to be `row.done || timerReady`, so a dispatch was
  // marked complete for the period the moment it came BACK — a fresh day opened
  // with the expedition already ticked and struck through, before the user had
  // touched it, at exactly the moment there was something to go and collect.
  // Completion belongs to the period's own row, written when the user actually
  // collects and resends; `timerReady` is reported separately and the card shows
  // it as work owed.
  return { done: Boolean(row?.done), countDone, countTarget, timerEndsAt };
}

/** All checklist items for a game right now. */
export function checklistFor(
  state: AppState,
  game: Game,
  now: number,
  index: ChecklistIndex = buildChecklistIndex(state),
): ChecklistItem[] {
  const tasks = index.tasksByGame.get(game.id) ?? [];
  const liveEvents = index.eventsByGame.get(game.id) ?? [];
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
    const progress = completionProgress(index.completions, t, periodKey);
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
      timerStepMinutes: t.timerStepMinutes,
      sort: t.sort,
      core: t.core === true,
    });
  }
  // Core tasks first: missing one costs pulls, missing a side chore costs
  // nothing, and the card should not make you hunt for the difference. Within
  // each group the user's own order still wins.
  return out.sort((a, b) => Number(b.core) - Number(a.core) || a.sort - b.sort || a.name.localeCompare(b.name));
}

export function completionId(taskId: string, periodKey: string): string {
  return `${taskId}|${periodKey}`;
}

export function timerDurationMinutes(task: Task): number {
  return effectiveTimerDurationMinutes(task);
}
