import type { GameEvent } from './types';

export const MAX_EVENT_PARTS = 60;

type PartsSource = Pick<GameEvent, 'name' | 'type' | 'notes' | 'dailyTouch' | 'start' | 'end'>;

/** One thing to tick, whatever its text says. */
const SINGLE_PART_TYPES: readonly GameEvent['type'][] = ['banner', 'maintenance', 'livestream', 'cycle'];

/** Matched at a word start only, so "Redesign in" does not read as "sign in". */
const LOGIN_PATTERN = /\b(login|log-in|log in|sign-in|sign in|check-in|check in|daily reward)/i;
const DAY_COUNT_PATTERN = /\b(\d+)[- ]?days?\b/gi;
const REWARD_PATTERN =
  /(\d{1,3}(?:,\d{3})+|\d+) ?(?:primogems?|stellar jades?|polychromes?|astrites?|oneiric shards?|gems?|jewels?|diamonds?|carats?|origeometry|annulith)\b/gi;

/** The first explicit day count in range, e.g. "7-day login" or "14 Day Sign-In". */
function explicitDayCount(text: string): number | undefined {
  for (const match of text.matchAll(DAY_COUNT_PATTERN)) {
    const days = Number(match[1]);
    if (days >= 1 && days <= MAX_EVENT_PARTS) return days;
  }
  return undefined;
}

/** The largest premium-currency amount named in the text, 0 when none is. */
function largestReward(text: string): number {
  let largest = 0;
  for (const match of text.matchAll(REWARD_PATTERN)) {
    largest = Math.max(largest, Number((match[1] ?? '').replaceAll(',', '')));
  }
  return largest;
}

/**
 * Event text is free-form and user-editable, so this only seeds a count. A stored
 * `parts` always wins over it, which is why a wrong guess is cheap to correct.
 */
export function inferEventParts(event: PartsSource): number {
  if (SINGLE_PART_TYPES.includes(event.type)) return 1;
  const text = `${event.name} ${event.notes}`;
  // A login event's day count outranks any reward it lists, so login is checked before rewards.
  if (LOGIN_PATTERN.test(text)) return explicitDayCount(text) ?? 7;
  const reward = largestReward(text);
  if (reward >= 1000) return 4;
  if (reward >= 300) return 5;
  return 1;
}

/** Whole parts inside the legal range. A fractional or out-of-range stored value must not reach the UI. */
function clampParts(value: number): number {
  return Math.min(MAX_EVENT_PARTS, Math.max(1, Math.round(value)));
}

/** Whole ticks inside 0..total. Non-finite input counts as none, since NaN would survive Math.min and Math.max. */
function clampTicks(value: number, total: number): number {
  const whole = Number.isFinite(value) ? Math.round(value) : 0;
  return Math.min(total, Math.max(0, whole));
}

/** The part count in force: the one set on the event, else the inferred one. */
export function eventParts(event: PartsSource & Pick<GameEvent, 'parts'>): number {
  if (event.parts !== undefined && Number.isFinite(event.parts)) return clampParts(event.parts);
  return inferEventParts(event);
}

/**
 * Parts ticked so far. An event marked done before parts existed has no partsDone,
 * so `done` is the authority and counts as every part.
 */
export function eventPartsDone(event: PartsSource & Pick<GameEvent, 'parts' | 'partsDone' | 'done'>): number {
  const total = eventParts(event);
  if (event.done === true) return total;
  return clampTicks(event.partsDone ?? 0, total);
}

/**
 * The fields to save for `ticked` parts. Reaching the last part sets `done`, because
 * that is the flag the checklist and the urgency feed read to drop an event.
 */
export function setEventPartsDone(
  event: PartsSource & Pick<GameEvent, 'parts'>,
  ticked: number,
): { partsDone: number; done: boolean } {
  const total = eventParts(event);
  const partsDone = clampTicks(ticked, total);
  return { partsDone, done: partsDone >= total };
}
