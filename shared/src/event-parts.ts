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
