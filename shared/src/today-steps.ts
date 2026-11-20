import type { AppState, Game, GameEvent, Resource } from './types';
import type { ChecklistItem } from './checklist';
import { measuredSnapshot, projectEnergy } from './energy';
import { energyBank, type EnergyBank } from './bank';
import { actBy, nextQuietWindow, type QuietWindow } from './quiet';
import { morningOf, playEnd } from './play-day';
import { effectiveResourceKind } from './tracking';
import { buildUrgencyContext, type UrgencyContext } from './urgency';

/**
 * Today's steps: one ordered to-do list across every game, for the next day.
 *
 * A step is something the player can do now that a clock will otherwise take
 * from them: an energy bar to spend before it caps, a daily (or a weekly due
 * within the day) to finish before its reset, or an unfinished event to finish
 * before it ends. Further out, the same three facts are "This week": known,
 * but nothing to do yet.
 */

const HOUR = 3_600_000;
/** Steps cover the next day; the day strip draws the same span. */
export const TODAY_STEPS_HOURS = 24;
const HORIZON = TODAY_STEPS_HOURS * HOUR;
const WEEK = 7 * 24 * HOUR;
/** Events of one game that end this close together are one step. */
const EVENT_MERGE_MS = HOUR;
/** Day-strip markers this close together share one marker. */
const MARK_MERGE_MS = 45 * 60_000;
/** Only these are things a player finishes; banners, cycles and livestreams are not. */
const STEP_EVENT_TYPES = new Set<GameEvent['type']>(['event', 'custom']);

interface StepBase {
  key: string;
  gameId: string;
  /** The deadline itself: the cap, the reset or the end. `now` for a bar already full. */
  at: number;
  /** When it really has to be done: a deadline inside quiet hours is due when they begin. */
  actBy: number;
  done: boolean;
}

export interface EnergyStep extends StepBase {
  kind: 'energy';
  resourceId: string;
  name: string;
  full: boolean;
  value: number;
  cap: number;
  /** What banks the bar's overflow: its reserve, or a counter crafted from it. */
  bank: EnergyBank | null;
}

export interface TaskStep extends StepBase {
  kind: 'task';
  item: ChecklistItem;
}

export interface EventStep extends StepBase {
  kind: 'event';
  event: GameEvent;
  /** Other unfinished events of the same game ending with this one. */
  more: number;
}

export type TodayStep = EnergyStep | TaskStep | EventStep;

/**
 * - `hour`: due within the hour, whatever it is.
 * - `evening`: energy and events due before the next quiet hours begin.
 * - `later`: energy and events due later in the day (no quiet hours, or after them).
 * - `reset`: tasks sharing one reset moment.
 */
export type TodayStepGroupKind = 'hour' | 'evening' | 'later' | 'reset';

export interface TodayStepGroup {
  key: string;
  kind: TodayStepGroupKind;
  /** The moment the group is named for: the hour's end, quiet hours' start, the reset. */
  at: number;
  steps: TodayStep[];
  /** The games in the group, in step order, once each. */
  gameIds: string[];
}

export interface TodayWeekItem {
  key: string;
  kind: 'weekly' | 'monthly' | 'cap' | 'event';
  gameId: string;
  at: number;
  /** Weeklies or monthlies left; 1 for anything else. */
  left: number;
  /** The resource or event name. */
  name: string;
}

export interface TodayMark {
  at: number;
  gameIds: string[];
  kinds: Array<'cap' | 'reset' | 'event'>;
}

export interface TodayPlan {
  groups: TodayStepGroup[];
  /** Finished steps, in the order they would have been done. */
  done: TodayStep[];
  week: TodayWeekItem[];
  marks: TodayMark[];
  /** The quiet hours the evening group runs up to, when they start within the day. */
  quiet: QuietWindow | null;
  open: number;
  total: number;
  /** The end of the span the steps and the strip cover. */
  until: number;
}

const KIND_RANK = { energy: 0, event: 1, task: 2 } as const;
const GROUP_RANK: Record<TodayStepGroupKind, number> = { hour: 0, evening: 1, later: 2, reset: 3 };

function hiddenOnCard(game: Game): Set<string> {
  return new Set((game.cardLayout ?? []).filter((item) => item.hidden).map((item) => item.id));
}

function compareSteps(sortOf: Map<string, number>) {
  return (a: TodayStep, b: TodayStep) =>
    a.actBy - b.actBy ||
    a.at - b.at ||
    KIND_RANK[a.kind] - KIND_RANK[b.kind] ||
    (a.kind === 'task' && b.kind === 'task' ? Number(b.item.core) - Number(a.item.core) : 0) ||
    (sortOf.get(a.gameId) ?? 0) - (sortOf.get(b.gameId) ?? 0) ||
    (a.kind === 'task' && b.kind === 'task' ? a.item.sort - b.item.sort : 0) ||
    a.key.localeCompare(b.key);
}

function energySteps(
  state: AppState,
  game: Game,
  now: number,
  ctx: UrgencyContext,
  hidden: Set<string>,
): { steps: EnergyStep[]; week: TodayWeekItem[] } {
  const steps: EnergyStep[] = [];
  const week: TodayWeekItem[] = [];
  const all = ctx.resourcesByGame.get(game.id) ?? [];
  const resources = all
    .filter(
      (res: Resource) => !res.deleted && effectiveResourceKind(res) === 'regen' && !hidden.has(`resource:${res.id}`),
    )
    .sort((a, b) => a.sort - b.sort);
  for (const res of resources) {
    const proj = projectEnergy(res, measuredSnapshot(res, ctx.snaps.get(res.id)), now, game);
    if (!proj.hasSnapshot) continue;
    const at = proj.isFull ? now : proj.fullAt;
    if (at == null) continue;
    if (at - now <= HORIZON) {
      steps.push({
        kind: 'energy',
        key: `energy:${res.id}`,
        gameId: game.id,
        resourceId: res.id,
        name: res.name,
        full: proj.isFull,
        value: proj.value,
        cap: res.cap,
        bank: energyBank(res, proj, all, ctx.snaps, now, game),
        at,
        actBy: proj.isFull ? now : actBy(state.settings, at, now),
        done: false,
      });
    } else if (at - now <= WEEK) {
      week.push({ key: `cap:${res.id}`, kind: 'cap', gameId: game.id, at, left: 1, name: res.name });
    }
  }
  return { steps, week };
}

function taskSteps(
  state: AppState,
  game: Game,
  now: number,
  ctx: UrgencyContext,
  hidden: Set<string>,
): { steps: TaskStep[]; week: TodayWeekItem[] } {
  const steps: TaskStep[] = [];
  const later = new Map<string, TodayWeekItem>();
  for (const item of ctx.checklistByGame.get(game.id) ?? []) {
    if (hidden.has(`task:${item.taskId}`)) continue;
    const left = item.resetAt - now;
    if (item.cadence === 'daily' || left <= HORIZON) {
      steps.push({
        kind: 'task',
        key: `task:${item.taskId}`,
        gameId: game.id,
        item,
        at: item.resetAt,
        actBy: actBy(state.settings, item.resetAt, now),
        done: item.done,
      });
    } else if (!item.done && left <= WEEK && (item.cadence === 'weekly' || item.cadence === 'monthly')) {
      const key = `${item.cadence}:${game.id}:${item.resetAt}`;
      const row = later.get(key) ?? {
        key,
        kind: item.cadence,
        gameId: game.id,
        at: item.resetAt,
        left: 0,
        name: item.name,
      };
      row.left += 1;
      later.set(key, row);
    }
  }
  return { steps, week: [...later.values()] };
}

function eventSteps(
  state: AppState,
  game: Game,
  now: number,
  ctx: UrgencyContext,
): { steps: EventStep[]; week: TodayWeekItem[] } {
  const steps: EventStep[] = [];
  const week: TodayWeekItem[] = [];
  const due: GameEvent[] = [];
  for (const event of ctx.eventsByGame.get(game.id) ?? []) {
    if (event.deleted || !event.notify || !STEP_EVENT_TYPES.has(event.type)) continue;
    if (event.start > now || event.end <= now) continue;
    const left = event.end - now;
    if (left <= HORIZON) {
      if (event.done) {
        steps.push(eventStep(state, event, now, 0, true));
      } else due.push(event);
    } else if (!event.done && left <= WEEK) {
      week.push({ key: `event:${event.id}`, kind: 'event', gameId: game.id, at: event.end, left: 1, name: event.name });
    }
  }
  // Pinned first among those ending together: the one the player meant to do leads.
  due.sort(
    (a, b) => a.end - b.end || Number(b.pinned === true) - Number(a.pinned === true) || a.name.localeCompare(b.name),
  );
  for (let index = 0; index < due.length;) {
    const lead = due[index]!;
    let next = index + 1;
    while (next < due.length && due[next]!.end - lead.end <= EVENT_MERGE_MS) next += 1;
    steps.push(eventStep(state, lead, now, next - index - 1, false));
    index = next;
  }
  return { steps, week };
}

function eventStep(state: AppState, event: GameEvent, now: number, more: number, done: boolean): EventStep {
  // An end in the small hours has to be met the evening before, by midnight.
  const last = playEnd(event.end, state.settings.localTz, morningOf(state.settings));
  return {
    kind: 'event',
    key: `event:${event.id}`,
    gameId: event.gameId,
    event,
    more,
    at: event.end,
    actBy: Math.min(actBy(state.settings, event.end, now), last > now ? last : event.end),
    done,
  };
}

function groupFor(step: TodayStep, now: number, quiet: QuietWindow | null): { key: string; kind: TodayStepGroupKind } {
  if (step.actBy - now <= HOUR) return { key: 'hour', kind: 'hour' };
  if (step.kind === 'task') return { key: `reset:${step.at}`, kind: 'reset' };
  if (quiet && step.actBy <= quiet.start) return { key: 'evening', kind: 'evening' };
  return { key: 'later', kind: 'later' };
}

function stripMarks(steps: TodayStep[], now: number, until: number): TodayMark[] {
  const points: Array<{ at: number; gameId: string; kind: TodayMark['kinds'][number] }> = [];
  const seen = new Set<string>();
  for (const step of steps) {
    if (step.at <= now || step.at > until) continue;
    const kind = step.kind === 'energy' ? 'cap' : step.kind === 'task' ? 'reset' : 'event';
    // One reset per game and moment, however many of its tasks share it.
    const id = `${kind}:${step.gameId}:${step.at}`;
    if (seen.has(id)) continue;
    seen.add(id);
    points.push({ at: step.at, gameId: step.gameId, kind });
  }
  points.sort((a, b) => a.at - b.at);
  const marks: TodayMark[] = [];
  for (const point of points) {
    const last = marks.at(-1);
    if (last && point.at - last.at <= MARK_MERGE_MS) {
      if (!last.gameIds.includes(point.gameId)) last.gameIds.push(point.gameId);
      if (!last.kinds.includes(point.kind)) last.kinds.push(point.kind);
    } else marks.push({ at: point.at, gameIds: [point.gameId], kinds: [point.kind] });
  }
  return marks;
}

/** Every game's steps for the next day, ordered by deadline and grouped. Paused games are left out. */
export function todaySteps(state: AppState, now: number, ctx?: UrgencyContext): TodayPlan {
  const context = ctx ?? buildUrgencyContext(state, now);
  const until = now + HORIZON;
  const games = state.games.filter((game) => !game.deleted && !game.paused);
  const sortOf = new Map(games.map((game) => [game.id, game.sort]));
  const all: TodayStep[] = [];
  const week: TodayWeekItem[] = [];
  for (const game of games) {
    const hidden = hiddenOnCard(game);
    for (const part of [
      energySteps(state, game, now, context, hidden),
      taskSteps(state, game, now, context, hidden),
      eventSteps(state, game, now, context),
    ]) {
      all.push(...part.steps);
      week.push(...part.week);
    }
  }
  all.sort(compareSteps(sortOf));

  const upcomingQuiet = nextQuietWindow(state.settings, now);
  const quiet = upcomingQuiet && upcomingQuiet.start <= until ? upcomingQuiet : null;
  const groups = new Map<string, TodayStepGroup>();
  const done: TodayStep[] = [];
  for (const step of all) {
    if (step.done) {
      done.push(step);
      continue;
    }
    const { key, kind } = groupFor(step, now, quiet);
    const group = groups.get(key) ?? {
      key,
      kind,
      at: kind === 'hour' ? now + HOUR : kind === 'evening' ? quiet!.start : kind === 'reset' ? step.at : step.actBy,
      steps: [],
      gameIds: [],
    };
    group.steps.push(step);
    if (!group.gameIds.includes(step.gameId)) group.gameIds.push(step.gameId);
    groups.set(key, group);
  }
  // A group goes where its first step falls due, so the list reads soonest first
  // even where an evening that opens at 19:59 runs past a reset at 20:00.
  const ordered = [...groups.values()].sort(
    (a, b) =>
      GROUP_RANK[a.kind === 'hour' ? 'hour' : 'later'] - GROUP_RANK[b.kind === 'hour' ? 'hour' : 'later'] ||
      a.steps[0]!.actBy - b.steps[0]!.actBy ||
      GROUP_RANK[a.kind] - GROUP_RANK[b.kind] ||
      a.at - b.at,
  );
  const open = all.length - done.length;
  return {
    groups: ordered,
    done,
    week: week.sort((a, b) => a.at - b.at || a.key.localeCompare(b.key)),
    marks: stripMarks(
      all.filter((step) => !step.done),
      now,
      until,
    ),
    quiet,
    open,
    total: all.length,
    until,
  };
}
