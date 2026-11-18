import { useCallback, useEffect, useRef, type ReactNode } from 'react';

/**
 * Publishes the page bar's real height as --app-bar-h, so whatever sticks
 * below it (the Calendar's ruler) clears it exactly. The bar wraps on narrow
 * windows, so no constant would hold.
 */
function useMeasuredBarHeight() {
  const ref = useRef<HTMLElement | null>(null);
  const publish = useCallback((height: number) => {
    document.documentElement.style.setProperty('--app-bar-h', `${height}px`);
  }, []);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measure = () => publish(node.getBoundingClientRect().height);
    measure();
    if (typeof ResizeObserver === 'undefined') return () => publish(0);
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => {
      observer.disconnect();
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

/** The page's name, with a quiet line beside it. Focused on arrival by the shell. */
export function PageTitle({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="page-title">
      <h1 tabIndex={-1}>{children}</h1>
      {sub && <span className="page-title-sub">{sub}</span>}
    </div>
  );
}

/** Pushes what follows to the bar's end. */
export function PageBarEnd({ children }: { children: ReactNode }) {
  return <div className="page-bar-end">{children}</div>;
}
