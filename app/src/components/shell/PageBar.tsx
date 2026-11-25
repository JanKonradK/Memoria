import { useCallback, useEffect, useRef, type ReactNode } from 'react';

/**
 * Publishes where the page bar's bottom edge sticks as --app-bar-h, so whatever
 * sticks below it (the Calendar's ruler) clears it exactly. The bar wraps on
 * narrow windows and sits under the rail on a tall screen, so no constant would hold.
 */
function useMeasuredBarHeight() {
  const ref = useRef<HTMLElement | null>(null);
  const publish = useCallback((height: number) => {
    document.documentElement.style.setProperty('--app-bar-h', `${height}px`);
  }, []);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measure = () =>
      publish(node.getBoundingClientRect().height + (Number.parseFloat(getComputedStyle(node).top) || 0));
    measure();
    // Turning the screen moves the rail without resizing the bar.
    window.addEventListener('resize', measure);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(node);
    return () => {
      window.removeEventListener('resize', measure);
      observer?.disconnect();
      publish(0);
    };
  }, [publish]);
  return ref;
}

/**
 * Each page's own top bar: what the page is, its views, and its actions. There
 * is no app-wide bar; the rail is the navigation and this bar is the page.
 */
export function PageBar({ children, className = '' }: { children: ReactNode; className?: string }) {
  const ref = useMeasuredBarHeight();
  return (
    <header ref={ref} className={`page-bar ${className}`}>
      {children}
    </header>
  );
}

/**
 * The page's name, with a quiet line beside it. Focused on arrival by the shell.
 * `sub` is prose that Minimal mode hides; `meta` is a figure that always shows.
 */
export function PageTitle({ children, sub, meta }: { children: ReactNode; sub?: ReactNode; meta?: ReactNode }) {
  return (
    <div className="page-title">
      <h1 tabIndex={-1}>{children}</h1>
      {sub && <span className="page-title-sub say">{sub}</span>}
      {meta && <span className="page-title-meta">{meta}</span>}
    </div>
  );
}

/** Pushes what follows to the bar's end. */
export function PageBarEnd({ children }: { children: ReactNode }) {
  return <div className="page-bar-end">{children}</div>;
}
