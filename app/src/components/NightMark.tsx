import { DateTime } from 'luxon';

/**
 * A crescent before an end in the small hours: the event is listed on the
 * night before, because it is over by morning. Said in words to a screen reader.
 */
export function NightMark({ at, tz }: { at: number; tz: string }) {
  return (
    <>
      <svg viewBox="0 0 16 16" aria-hidden className="night-mark">
        <path d="M10.6 2.2a6 6 0 1 0 3.2 9.9A5 5 0 0 1 10.6 2.2Z" fill="currentColor" />
      </svg>
      <span className="sr-only">
        overnight, {DateTime.fromMillis(at, { zone: tz }).toFormat('cccc HH:mm')}, so the night before is the last
        chance:{' '}
      </span>
    </>
  );
}
