import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { m } from 'motion/react';
import { useReducedMotion } from '../../hooks';
import { duration, easing } from '../../motion';

/**
 * The game editor's tab strip.
 *
 * This replaced a sticky `<nav>` of `href="#editor-…"` anchors over five long
 * stacked sections. Anchors are the wrong control for this job twice over: they
 * announce themselves as links to somewhere else when the destination never
 * left the sheet, and the jump they perform leaves every other section mounted
 * and scrollable, so the strip said "five places" while the sheet stayed one
 * very long place. A real tablist says what it does, keeps one panel in the
 * document, and answers the arrow keys.
 *
 * Lifted from `Segmented` in ui.tsx rather than reusing it: a segmented control
 * is a radiogroup — it picks a VALUE — and a tablist reveals a REGION. The two
 * share a look and an indicator, and nothing else. The shared part is the
 * `layoutId` indicator, which is copied deliberately so the two controls slide
 * identically.
 */
export type EditorTab<T extends string> = { id: T; label: string };

export function EditorTabs<T extends string>({
  tabs,
  value,
  onChange,
  ariaLabel,
  idBase,
  className = '',
}: {
  tabs: readonly EditorTab<T>[];
  value: T;
  onChange: (id: T) => void;
  ariaLabel: string;
  /** Shared with the panels, so `aria-controls` and `aria-labelledby` pair up. */
  idBase: string;
  className?: string;
}) {
  const reducedMotion = useReducedMotion();
  const indicatorLayoutId = `${useId()}-editor-tab-indicator`;
  const buttons = useRef(new Map<T, HTMLButtonElement | null>());

  // Automatic activation: the arrow keys move focus AND selection together,
  // which is the APG default for a tablist whose panels are already in the DOM
  // budget. Nothing here is expensive enough to need manual activation.
  const select = (next: T) => {
    onChange(next);
    buttons.current.get(next)?.focus();
  };
  const step = (delta: number) => {
    const index = tabs.findIndex((tab) => tab.id === value);
    select(tabs[(index + delta + tabs.length) % tabs.length]!.id);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (delta !== 0) {
      event.preventDefault();
      step(delta);
      return;
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      select((event.key === 'Home' ? tabs[0] : tabs[tabs.length - 1])!.id);
    }
  };

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={`grid grid-cols-3 gap-1 rounded-ui-lg bg-panel sm:flex sm:flex-wrap p-1 ring-1 ring-line-hairline ${className}`}
    >
      {tabs.map((tab) => {
        const selected = tab.id === value;
        return (
          <button
            key={tab.id}
            ref={(node) => {
              buttons.current.set(tab.id, node);
            }}
            type="button"
            role="tab"
            id={`${idBase}-tab-${tab.id}`}
            aria-controls={`${idBase}-panel-${tab.id}`}
            aria-selected={selected}
            // One tab stop for the whole strip; the arrows move within it.
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.id)}
            onKeyDown={onKeyDown}
            className="relative flex min-h-11 min-w-0 items-center justify-center rounded-ui-md px-2 sm:justify-start sm:px-3 text-meta font-semibold text-muted transition-colors duration-(--dur-fast) hover:text-fg-soft aria-selected:text-fg sm:min-h-8"
          >
            {selected && (
              <m.span
                aria-hidden
                className="pointer-events-none absolute inset-0 rounded-ui-md border border-line-strong bg-surface-2"
                layoutId={indicatorLayoutId}
                initial={false}
                transition={reducedMotion ? { duration: 0 } : { duration: duration.base, ease: easing.out }}
              />
            )}
            <span className="relative z-10">{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * The one mounted panel.
 *
 * Keyed on the tab so React genuinely swaps the subtree — the fade is the new
 * panel arriving, not a crossfade between two copies of the editor, because two
 * mounted copies of a form is two sets of inputs holding the same state. No
 * lateral movement: a panel that slides makes the eye chase the page while it is
 * trying to read a field label.
 */
export function EditorTabPanel<T extends string>({
  idBase,
  tab,
  children,
}: {
  idBase: string;
  tab: T;
  children: ReactNode;
}) {
  const reducedMotion = useReducedMotion();
  return (
    <m.div
      key={tab}
      role="tabpanel"
      id={`${idBase}-panel-${tab}`}
      aria-labelledby={`${idBase}-tab-${tab}`}
      initial={reducedMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: reducedMotion ? 0 : duration.base, ease: easing.out }}
    >
      {children}
    </m.div>
  );
}
