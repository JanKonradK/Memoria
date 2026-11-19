import { lazy, Suspense } from 'react';
import type { CalendarViewProps } from './types';
import { ViewLoading } from './ViewLoading';

const SoonBoard = lazy(() => import('./SoonBoard').then((module) => ({ default: module.SoonBoard })));

/** Unfinished events in columns by when they end: today, by Sunday, next week, later. Loaded when first chosen. */
export function SoonView(props: CalendarViewProps) {
  return (
    <Suspense fallback={<ViewLoading />}>
      <SoonBoard {...props} />
    </Suspense>
  );
}
