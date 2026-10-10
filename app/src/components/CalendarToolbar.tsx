import type { ReactNode } from 'react';
import { useUI } from '../ui-store';
import { GameScope } from './GameScope';

const VIEWS = [
  { id: 'timeline', label: 'Events' },
  { id: 'livestreams', label: 'Livestreams' },
] as const;

/**
 * Calendar's controls, in the page rather than the app bar.
 *
 * They used to share the bar's one row with the brand, the routes and five
 * utilities. The game filter was the only item there allowed to shrink, so a
 * narrower window squeezed it to a caret and then scrolled the row sideways.
 * Here the row wraps instead, and every control keeps its label.
 */
export function CalendarToolbar({ view, children }: { view: (typeof VIEWS)[number]['id']; children?: ReactNode }) {
  const setTab = useUI((s) => s.setTab);
  return (
    <div className="calendar-toolbar">
      <nav aria-label="Calendar views" className="ui-segmented calendar-views">
        {VIEWS.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-current={view === item.id ? 'page' : undefined}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>
      <GameScope />
      {children}
    </div>
  );
}
