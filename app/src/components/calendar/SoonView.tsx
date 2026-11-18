import type { CalendarViewProps } from './types';

/** Unfinished events in columns by when they end: today, by Sunday, next week, later. */
export function SoonView({ events }: CalendarViewProps) {
  return (
    <p className="py-8 text-center text-meta text-muted">
      {events.length} events. The ending-soon board is on its way.
    </p>
  );
}
