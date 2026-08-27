import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import { useUI } from '../ui-store';

/**
 * One "+" for everything you can add.
 *
 * There used to be three separate buttons, in three places: "Add game" portalled
 * into the bar by the dashboard, and "+ Reminder" and "+ Event" portalled by the
 * timeline — plus a second "+ Reminder" in the Tonight panel and a third at the
 * bottom of the timeline's reminder list. They differed only in what they made,
 * which is the thing a menu is for.
 *
 * The menu lives in the app bar rather than being portalled by whichever route
 * is open. That is what lets it be context-aware without the routes knowing it
 * exists: it reads the tab itself, and Dashboard and Timeline just deleted their
 * toolbars.
 */

/** What each route can meaningfully add, in the order it is offered. */
const ITEMS = {
  home: ['addGame', 'event', 'reminder'],
  timeline: ['event', 'reminder'],
  settings: ['addGame'],
} as const satisfies Record<string, readonly ('addGame' | 'event' | 'reminder')[]>;

const LABELS = { addGame: 'Add game', event: 'Event', reminder: 'Reminder' } as const;

export function AddMenu() {
  const tab = useUI((store) => store.tab);
  const openSheet = useUI((store) => store.openSheet);

  return (
    <DropdownMenuPrimitive.Root>
      <DropdownMenuPrimitive.Trigger
        // Matches RefreshButton's shell so the right-hand cluster reads as one
        // family of controls rather than as a button that wandered in.
        className="flex min-h-8 items-center justify-center rounded-ui-md border border-line px-3 py-1 text-caption uppercase tracking-[0.09em] text-muted transition-colors hover:border-line-strong hover:text-fg-soft data-[state=open]:border-line-strong data-[state=open]:text-fg"
        aria-label="Add"
      >
        <svg
          viewBox="0 0 20 20"
          aria-hidden
          className="icon h-3.5 w-3.5"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
        >
          <path d="M10 4v12M4 10h12" />
        </svg>
      </DropdownMenuPrimitive.Trigger>

      <DropdownMenuPrimitive.Portal>
        <DropdownMenuPrimitive.Content
          align="end"
          sideOffset={6}
          className="z-50 min-w-40 rounded-ui-lg bg-popover p-1 shadow-float ring-1 ring-line-strong"
        >
          {ITEMS[tab].map((kind) => (
            <DropdownMenuPrimitive.Item
              key={kind}
              // Deferred by a frame on purpose. Both the menu and the sheet are
              // Radix layers, and both take the page's pointer events while they
              // are open. Opening the sheet synchronously from a select puts its
              // mount inside the menu's own teardown, and the two cancel out:
              // the body keeps `pointer-events: none` and the whole app stops
              // responding to clicks until a reload.
              onSelect={() =>
                requestAnimationFrame(() => openSheet(kind === 'addGame' ? { kind: 'addGame' } : { kind }))
              }
              className="flex min-h-9 cursor-pointer items-center rounded-ui-sm px-3 text-body text-fg-soft outline-none transition-colors data-[highlighted]:bg-fill-2 data-[highlighted]:text-fg"
            >
              {LABELS[kind]}
            </DropdownMenuPrimitive.Item>
          ))}
        </DropdownMenuPrimitive.Content>
      </DropdownMenuPrimitive.Portal>
    </DropdownMenuPrimitive.Root>
  );
}
