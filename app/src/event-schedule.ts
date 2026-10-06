import { DateTime } from 'luxon';
import { parseServerDateTime, type GameEvent } from '@memoria/shared';
import { SEED_EVENTS } from './data/seed-feed';

const calendarSeeds = new Map(SEED_EVENTS.filter((seed) => seed.dateOnly).map((seed) => [seed.sourceKey, seed]));

/** Only unchanged calendar boundaries use date labels; personal time edits keep their clocks. */
export function calendarSchedule(event: GameEvent) {
  const seed = event.sourceKey ? calendarSeeds.get(event.sourceKey) : undefined;
  if (!seed?.timezone) return undefined;
  const start = parseServerDateTime(seed.start, seed.timezone);
  const end = parseServerDateTime(seed.end, seed.timezone);
  if (event.start !== start || event.end !== end) return undefined;
  const first = DateTime.fromMillis(event.start, { zone: seed.timezone });
  const last = DateTime.fromMillis(event.end, { zone: seed.timezone });
  const sameYear = first.year === last.year;
  const firstFormat = sameYear && first.month === last.month ? 'd' : sameYear ? 'd LLL' : 'd LLL yyyy';
  const lastFormat = sameYear ? 'd LLL' : 'd LLL yyyy';
  return {
    start: first,
    end: last,
    zone: seed.timezone,
    label: `${first.toFormat(firstFormat)}–${last.toFormat(lastFormat)}`,
    description: `Calendar dates: ${first.toFormat('d LLL yyyy')} through ${last.toFormat('d LLL yyyy')} (${seed.timezone}).`,
  };
}
