import * as ToggleGroupPrimitive from '@radix-ui/react-toggle-group';
import { useUI, type TimelineView } from '../ui-store';

/** Four ways to look at what is coming: time bars, an agenda by day, a month grid, and what ends soon. */
const VIEWS: { id: TimelineView; label: string; short?: string }[] = [
  { id: 'lanes', label: 'Timeline' },
  { id: 'agenda', label: 'Agenda' },
  { id: 'month', label: 'Month' },
  { id: 'soon', label: 'Ending soon', short: 'Soon' },
];

/** The Calendar's view switch: one quiet pill row, the chosen view raised. */
export function CalendarToolbar({ view }: { view: TimelineView }) {
  const setTab = useUI((s) => s.setTab);
  const setView = useUI((s) => s.setTimelineView);
  return (
    <ToggleGroupPrimitive.Root
      type="single"
      value={view}
      onValueChange={(next) => {
        if (!next) return;
        setView(next as TimelineView);
        setTab('timeline');
      }}
      aria-label="Event view"
      className="view-switch calendar-view-switch"
    >
      {VIEWS.map((item) => (
        <ToggleGroupPrimitive.Item key={item.id} value={item.id} aria-label={item.label} className="calendar-view">
          {item.short ? (
            <>
              <span className="calendar-view-long">{item.label}</span>
              <span className="calendar-view-short" aria-hidden>
                {item.short}
              </span>
            </>
          ) : (
            item.label
          )}
        </ToggleGroupPrimitive.Item>
      ))}
    </ToggleGroupPrimitive.Root>
  );
}
