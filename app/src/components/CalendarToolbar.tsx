import type { ReactNode } from 'react';
import * as ToggleGroupPrimitive from '@radix-ui/react-toggle-group';
import { useUI, type TimelineView } from '../ui-store';
import { GameScope } from './GameScope';

/** Four ways to look at what is coming: time bars, an agenda by day, a month grid, and what ends soon. */
const VIEWS: { id: TimelineView; label: string; icon: string }[] = [
  { id: 'lanes', label: 'Timeline', icon: 'M3 5h8M6 10h11M3 15h6' },
  { id: 'agenda', label: 'Agenda', icon: 'M7 5h10M7 10h10M7 15h10M3 5h.01M3 10h.01M3 15h.01' },
  {
    id: 'month',
    label: 'Month',
    icon: 'M3 6.5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2V15a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 8.5h14M8 8.5V17M12 8.5V17M3 12.7h14',
  },
  { id: 'soon', label: 'Ending soon', icon: 'M10 3.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13M10 6.5V10l2.5 1.5' },
];

/**
 * Timeline's controls, one row on every width: the game filter, then the view,
 * then the page's own tools. Labels show where there is room; on a phone the
 * icons carry them and the accessible names stay.
 */
export function CalendarToolbar({ view, children }: { view: TimelineView; children?: ReactNode }) {
  const setTab = useUI((s) => s.setTab);
  const setView = useUI((s) => s.setTimelineView);
  return (
    <div className="calendar-toolbar">
      <GameScope />
      <ToggleGroupPrimitive.Root
        type="single"
        value={view}
        onValueChange={(next) => {
          if (!next) return;
          setView(next as TimelineView);
          setTab('timeline');
        }}
        aria-label="Event view"
        className="calendar-views"
      >
        {VIEWS.map((item) => (
          <ToggleGroupPrimitive.Item
            key={item.id}
            value={item.id}
            aria-label={item.label}
            title={item.label}
            className="calendar-view-button"
          >
            <svg
              viewBox="0 0 20 20"
              aria-hidden
              className="icon h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d={item.icon} />
            </svg>
            <span className="calendar-tool-label">{item.label}</span>
          </ToggleGroupPrimitive.Item>
        ))}
      </ToggleGroupPrimitive.Root>
      {children}
    </div>
  );
}
