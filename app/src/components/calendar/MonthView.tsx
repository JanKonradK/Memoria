import { lazy, Suspense } from 'react';
import type { CalendarViewProps } from './types';
import { ViewLoading } from './ViewLoading';

const MonthBoard = lazy(() => import('./MonthBoard').then((module) => ({ default: module.MonthBoard })));

/** A month grid of event bars, coloured by game, with a panel for the chosen day. Loaded when first chosen. */
export function MonthView(props: CalendarViewProps) {
  return (
    <Suspense fallback={<ViewLoading />}>
      <MonthBoard {...props} />
    </Suspense>
  );
}
