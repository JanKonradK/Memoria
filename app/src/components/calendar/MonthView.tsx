import type { CalendarViewProps } from './types';

/** A month grid of event bars, coloured by game, with a panel for the chosen day. */
export function MonthView({ events }: CalendarViewProps) {
  return <p className="py-8 text-center text-meta text-muted">{events.length} events. The month grid is on its way.</p>;
}
