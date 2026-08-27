import { useLayoutEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** The app bar renders this; routes fill it. */
export const HEADER_ACTIONS_SLOT = 'app-bar-actions';

/**
 * Route-level actions, rendered into the app bar.
 *
 * The alternative was a store slice the app bar subscribes to, which turns every
 * button into persisted UI state and makes a page's controls outlive the page. A
 * portal keeps ownership where it belongs: the route renders its own buttons and
 * they unmount with it.
 *
 * useLayoutEffect, not useEffect, so the slot is resolved before the browser
 * paints — the buttons would otherwise pop in a frame after the rest of the bar.
 * Routes are lazy, so the app bar has always mounted by the time one of them
 * looks for the slot.
 */
export function HeaderActions({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => setSlot(document.getElementById(HEADER_ACTIONS_SLOT)), []);
  // The wrapper mounts and unmounts with its route, which makes it the natural
  // trigger for the entrance: the controls beside the route slider grow in from
  // nothing each time the tab changes, instead of appearing fully formed. It
  // carries the slot's own flex geometry so wrapping costs no layout.
  return slot
    ? createPortal(<div className="header-actions-enter flex min-w-0 items-center gap-2">{children}</div>, slot)
    : null;
}
