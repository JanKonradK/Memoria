import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { m } from 'motion/react';
import { useReducedMotion } from '../hooks';
import { duration, easing } from '../motion';

const EXIT_BUFFER_MS = 40;

export function Disclosure({
  open,
  onOpenChange,
  title,
  summary,
  triggerLabel,
  regionLabel,
  children,
  className = '',
  headingClassName = '',
  headingLevel = 3,
  triggerClassName = '',
  contentClassName = '',
  fill = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  summary?: ReactNode;
  triggerLabel?: string;
  regionLabel?: string;
  children: ReactNode;
  className?: string;
  headingClassName?: string;
  /** h3 by default — correct under a panel heading. A disclosure sitting
      directly under a page's own h1 must pass 2 or the outline skips a level. */
  headingLevel?: 2 | 3;
  triggerClassName?: string;
  contentClassName?: string;
  /** Let the open disclosure consume the remaining height of a flex-column accordion. */
  fill?: boolean;
}) {
  const generatedId = useId().replaceAll(':', '');
  const triggerId = `disclosure-trigger-${generatedId}`;
  const panelId = `disclosure-panel-${generatedId}`;
  const reducedMotion = useReducedMotion();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(open);
  const [mounted, setMounted] = useState(open);

  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    const timer = window.setTimeout(() => setMounted(false), reducedMotion ? 0 : duration.base * 1000 + EXIT_BUFFER_MS);
    return () => window.clearTimeout(timer);
  }, [open, reducedMotion]);

  useLayoutEffect(() => {
    if (wasOpen.current && !open && panelRef.current?.contains(document.activeElement)) {
      triggerRef.current?.focus({ preventScroll: true });
    }
    wasOpen.current = open;
  }, [open]);
  const present = open || mounted;
  const Heading = headingLevel === 2 ? 'h2' : 'h3';

  return (
    <section className={`min-h-0 ${fill ? 'flex flex-col' : ''} ${fill && open ? 'flex-1' : ''} ${className}`}>
      <Heading className={headingClassName}>
        <button
          ref={triggerRef}
          id={triggerId}
          type="button"
          onClick={() => onOpenChange(!open)}
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={triggerLabel}
          className={`group/disclosure flex min-h-11 w-full items-center gap-3 text-left sm:min-h-9 ${triggerClassName}`}
        >
          <span className="min-w-0 flex-1">{title}</span>
          {summary && <span className="shrink-0 text-right">{summary}</span>}
          <svg
            aria-hidden
            viewBox="0 0 20 20"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.25"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`shrink-0 text-dim transition-transform duration-(--dur-fast) ${open ? 'rotate-180' : ''}`}
          >
            <path d="m5 7.5 5 5 5-5" />
          </svg>
        </button>
      </Heading>
      <m.div
        ref={panelRef}
        id={panelId}
        role="region"
        aria-label={regionLabel}
        aria-labelledby={regionLabel ? undefined : triggerId}
        aria-hidden={!open}
        inert={!open}
        initial={false}
        animate={open ? 'open' : 'closed'}
        variants={{
          open: {
            gridTemplateRows: '1fr',
            opacity: 1,
            transition: { duration: reducedMotion ? 0 : duration.base, ease: easing.out },
          },
          closed: {
            gridTemplateRows: '0fr',
            opacity: 0,
            transition: { duration: reducedMotion ? 0 : duration.base, ease: easing.out },
          },
        }}
        className={`grid min-h-0 ${fill && open ? 'flex-1' : ''}`}
        style={{ visibility: present ? 'visible' : 'hidden' }}
      >
        <div className={`min-h-0 overflow-hidden ${contentClassName}`}>{present && children}</div>
      </m.div>
    </section>
  );
}
