import { useId, useState, type ReactNode } from 'react';
import { useReducedMotion } from '../../hooks';

/** Keep a routine's settings beside its summary without a wall of open forms. */
export function TrackingItem({
  name,
  summary,
  children,
  defaultOpen = false,
}: {
  name: string;
  summary: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  const reduced = useReducedMotion();
  return (
    <div className="border-b border-line-hairline">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
        className="flex min-h-14 w-full items-center gap-3 rounded-ui-md px-1 py-3 text-left transition-colors hover:bg-fill-1"
      >
        <span className="min-w-0 flex-1">
          <span className="block break-words text-body font-medium text-fg">{name}</span>
          <span className="mt-0.5 block text-label text-muted">{summary}</span>
        </span>
        <svg
          aria-hidden
          viewBox="0 0 16 16"
          className="h-4 w-4 shrink-0 text-muted"
          style={{
            transform: open ? 'rotate(90deg)' : undefined,
            transition: reduced ? 'none' : 'transform var(--dur-base) var(--ease-out)',
          }}
        >
          <path d="m6 3 5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </button>
      <div
        id={id}
        inert={!open}
        aria-hidden={!open}
        className="grid"
        style={{
          gridTemplateRows: open ? '1fr' : '0fr',
          opacity: open ? 1 : 0,
          transition: reduced
            ? 'none'
            : 'grid-template-rows var(--dur-base) var(--ease-out), opacity var(--dur-fast) var(--ease-out)',
        }}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="px-1 pb-5 pt-1">{children}</div>
        </div>
      </div>
    </div>
  );
}
