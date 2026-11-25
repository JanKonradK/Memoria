import type { GameEvent } from './types';

/**
 * Every event, in every game, has three states: not started, partly done, done.
 * The count of parts is no longer guessed from the event's text. Older data may
 * still hold a `parts` count and a `partsDone` tally; both read as one of the
 * three states below.
 */
export type EventProgress = 'none' | 'partial' | 'done';

/** Steps from not started to done: partly done, then done. */
export const EVENT_STEPS = 2;

type ProgressSource = Pick<GameEvent, 'done' | 'partsDone'>;

/** The event's state. `done` is the authority; any ticked part short of done is partial. */
export function eventProgress(event: ProgressSource): EventProgress {
  if (event.done === true) return 'done';
  return Number.isFinite(event.partsDone) && (event.partsDone ?? 0) > 0 ? 'partial' : 'none';
}

/** Steps taken: 0 not started, 1 partly done, 2 done. */
export function eventPartsDone(event: ProgressSource): number {
  const progress = eventProgress(event);
  return progress === 'done' ? EVENT_STEPS : progress === 'partial' ? 1 : 0;
}

/**
 * The fields to save for a state. Done sets `done`, the flag the checklist and
 * the urgency feed read to drop an event. A stored `parts` count is cleared.
 */
export function setEventProgress(progress: EventProgress): {
  parts: undefined;
  partsDone: number;
  done: boolean;
} {
  const partsDone = progress === 'done' ? EVENT_STEPS : progress === 'partial' ? 1 : 0;
  return { parts: undefined, partsDone, done: progress === 'done' };
}

/** The next state on a tap: not started → partly done → done → not started. */
export function nextEventProgress(event: ProgressSource): EventProgress {
  const progress = eventProgress(event);
  return progress === 'none' ? 'partial' : progress === 'partial' ? 'done' : 'none';
}

export const EVENT_PROGRESS_LABEL: Record<EventProgress, string> = {
  none: 'Not started',
  partial: 'Partly done',
  done: 'Done',
};

/**
 * The fields to save for a state, keeping a stored `parts` count. An event with
 * parts keeps its tally: done ticks every part, partly done keeps at least one
 * and fewer than all, not started clears it. Without parts, the plain three states.
 */
export function eventProgressPatch(
  event: Pick<GameEvent, 'parts' | 'partsDone' | 'done'>,
  progress: EventProgress,
): { parts?: number; partsDone: number; done: boolean } {
  const parts = event.parts;
  if (!parts || parts <= 0) return setEventProgress(progress);
  const partsDone =
    progress === 'done' ? parts : progress === 'partial' ? Math.max(1, Math.min(parts - 1, event.partsDone || 1)) : 0;
  return { parts, partsDone, done: progress === 'done' };
}

/** The fields to save for a tally of parts done: clamped, and done once every part is. */
export function eventPartsPatch(
  event: Pick<GameEvent, 'parts'>,
  partsDone: number,
): { parts?: number; partsDone: number; done: boolean } {
  const total = event.parts ?? EVENT_STEPS;
  const clamped = Math.max(0, Math.min(total, Math.round(Number.isFinite(partsDone) ? partsDone : 0)));
  return {
    ...(event.parts != null ? { parts: event.parts } : {}),
    partsDone: clamped,
    done: total > 0 && clamped >= total,
  };
}
