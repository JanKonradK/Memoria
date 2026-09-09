import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import { useRef } from 'react';
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
  const pending = useRef<'addGame' | 'event' | 'reminder' | null>(null);

  return (
    <DropdownMenuPrimitive.Root>
      <DropdownMenuPrimitive.Trigger className="shell-control group" aria-label="Add" data-tour="add">
        <svg
          viewBox="0 0 20 20"
          aria-hidden
          className="icon h-4 w-4 transition-transform duration-(--dur-fast) group-data-[state=open]:rotate-90"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
        >
          <path d="M10 4v12M4 10h12" />
        </svg>
        <span className="hidden sm:inline">Add</span>
      </DropdownMenuPrimitive.Trigger>

      <DropdownMenuPrimitive.Portal>
        <DropdownMenuPrimitive.Content
          align="end"
          sideOffset={6}
          onCloseAutoFocus={() => {
            const kind = pending.current;
            pending.current = null;
            // Radix calls this after the exit animation and focus-scope teardown.
            // Wait one frame for its pointer lock to release before opening a sheet.
            if (kind)
              requestAnimationFrame(() =>
                openSheet(kind === 'event' ? { kind, gameId: useUI.getState().focusedGameId ?? undefined } : { kind }),
              );
          }}
          className="popover-motion z-50 min-w-40 rounded-ui-lg bg-popover p-1 shadow-float ring-1 ring-line-strong"
        >
          {ITEMS[tab].map((kind) => (
            <DropdownMenuPrimitive.Item
              key={kind}
              onSelect={() => {
                pending.current = kind;
              }}
              className="flex min-h-11 cursor-pointer items-center rounded-ui-sm px-3 text-body text-fg-soft outline-none transition-colors data-[highlighted]:bg-fill-2 data-[highlighted]:text-fg sm:min-h-9"
            >
              {LABELS[kind]}
            </DropdownMenuPrimitive.Item>
          ))}
        </DropdownMenuPrimitive.Content>
      </DropdownMenuPrimitive.Portal>
    </DropdownMenuPrimitive.Root>
  );
}
