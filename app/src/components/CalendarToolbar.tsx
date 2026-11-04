import type { ReactNode } from 'react';
import * as ToggleGroupPrimitive from '@radix-ui/react-toggle-group';
import { useUI, type TimelineView } from '../ui-store';
import { GameScope } from './GameScope';

type ViewId = TimelineView | 'livestreams';

/** The three ways to look at what is coming: time bars, a list, or broadcasts. */
const VIEWS: { id: ViewId; label: string; icon: string }[] = [
  { id: 'lanes', label: 'Timeline', icon: 'M3 5h8M6 10h11M3 15h6' },
  { id: 'list', label: 'List', icon: 'M7 5h10M7 10h10M7 15h10M3 5h.01M3 10h.01M3 15h.01' },
  {
    id: 'livestreams',
    label: 'Livestreams',
    icon: 'M3 6h14v9H3zM7 18h6M8.5 8.5v4l3.5-2z',
  },
];

/**
 * Timeline's controls, one row on every width: the game filter, then the view,
 * then the page's own tools. Labels show where there is room; on a phone the
 * icons carry them and the accessible names stay.
 */
export function CalendarToolbar({ view, children }: { view: ViewId; children?: ReactNode }) {
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
          if (next === 'livestreams') {
            setTab('livestreams');
            return;
          }
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
