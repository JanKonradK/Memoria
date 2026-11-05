import { useCallback, useEffect, useRef, useState } from 'react';

/** Reactive CSS media query — drives the bottom-sheet → centered-dialog switch. */
export function useMediaQuery(query: string): boolean {
  const [match, setMatch] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const fn = () => setMatch(mq.matches);
    mq.addEventListener('change', fn);
    setMatch(mq.matches);
    return () => mq.removeEventListener('change', fn);
  }, [query]);
  return match;
}

/** Update visible countdowns, and refresh immediately when the tab returns. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const update = () => setNow(Date.now());
    const onVisibilityChange = () => {
      clearInterval(timer);
      timer = undefined;
      if (!document.hidden) {
        update();
        timer = setInterval(update, intervalMs);
      }
    };
    if (!document.hidden) timer = setInterval(update, intervalMs);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [intervalMs]);
  return now;
}

/** True when the user prefers reduced motion — gates decorative JS-rendered effects. */
export function useReducedMotion(): boolean {
  return useMediaQuery('(prefers-reduced-motion: reduce)');
}

/** Reactive browser connectivity state for visible offline feedback. */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return online;
}

/** A callback ref and the element's width in whole pixels, kept current as it resizes. */
export function useElementWidth() {
  const observerRef = useRef<ResizeObserver | null>(null);
  const [width, setWidth] = useState(0);

  const setElement = useCallback((element: HTMLElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!element) return;
    const updateWidth = (nextWidth: number) => setWidth(Math.ceil(nextWidth));
    updateWidth(element.getBoundingClientRect().width);

    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) updateWidth(entry.target.getBoundingClientRect().width);
    });
    observer.observe(element);
    observerRef.current = observer;
  }, []);

  useEffect(() => () => observerRef.current?.disconnect(), []);

  return [setElement, width] as const;
}
