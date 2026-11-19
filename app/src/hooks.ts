import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

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

interface Clock {
  now: number;
  listeners: Set<() => void>;
  timer: ReturnType<typeof setTimeout> | undefined;
  onVisibilityChange: () => void;
}

/** One clock per interval, shared by every component that asks for it. */
const clocks = new Map<number, Clock>();

function clockFor(intervalMs: number): Clock {
  let clock = clocks.get(intervalMs);
  if (!clock) {
    const created: Clock = {
      now: Date.now(),
      listeners: new Set(),
      timer: undefined,
      onVisibilityChange: () => catchUp(created, intervalMs),
    };
    clock = created;
    clocks.set(intervalMs, clock);
  }
  return clock;
}

function stopClock(clock: Clock) {
  clearTimeout(clock.timer);
  clock.timer = undefined;
}

/**
 * Ticks on the wall clock's own boundaries (:00 and :30 for 30 seconds), so a
 * countdown turns over on the minute and every reader of one interval holds
 * the same instant. That same instant is what lets the derived-data cache
 * serve the rail and the page from one computation.
 */
function startClock(clock: Clock, intervalMs: number) {
  stopClock(clock);
  if (document.hidden || clock.listeners.size === 0) return;
  const wait = intervalMs - (Date.now() % intervalMs) || intervalMs;
  clock.timer = setTimeout(() => {
    clock.now = Date.now();
    clock.listeners.forEach((listener) => listener());
    startClock(clock, intervalMs);
  }, wait);
}

function catchUp(clock: Clock, intervalMs: number) {
  if (document.hidden) {
    stopClock(clock);
    return;
  }
  clock.now = Date.now();
  clock.listeners.forEach((listener) => listener());
  startClock(clock, intervalMs);
}

/**
 * Update visible countdowns, and refresh immediately when the tab returns.
 * A hidden app runs no timer at all.
 */
export function useNow(intervalMs = 1000): number {
  const subscribe = useCallback(
    (listener: () => void) => {
      const clock = clockFor(intervalMs);
      const first = clock.listeners.size === 0;
      clock.listeners.add(listener);
      if (first) {
        document.addEventListener('visibilitychange', clock.onVisibilityChange);
        // Asleep with no readers, the clock went stale; wake it on the present.
        clock.now = Date.now();
        startClock(clock, intervalMs);
      }
      return () => {
        clock.listeners.delete(listener);
        if (clock.listeners.size > 0) return;
        document.removeEventListener('visibilitychange', clock.onVisibilityChange);
        stopClock(clock);
      };
    },
    [intervalMs],
  );
  return useSyncExternalStore(
    subscribe,
    () => clockFor(intervalMs).now,
    () => clockFor(intervalMs).now,
  );
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

/**
 * A short physical tick for the actions repeated most on a phone. Touch screens
 * only: a desktop has no motor, and a pen or mouse press needs no confirmation.
 */
export function haptic(ms = 10): void {
  try {
    if (window.matchMedia?.('(pointer: coarse)').matches) navigator.vibrate?.(ms);
  } catch {
    // Some WebViews throw when vibration is blocked; the tick still happened.
  }
}
