import { useEffect, useState } from 'react';
import { useReducedMotion } from '../hooks';

const TICK_MS = 260;

/**
 * A whole number that counts to its new value instead of swapping to it, so a
 * change made elsewhere on the page is seen where it lands.
 *
 * Under reduced motion, and on first render, it is simply the number.
 */
export function TickNumber({ value }: { value: number }) {
  const reducedMotion = useReducedMotion();
  const [target, setTarget] = useState(value);
  // The number on screen while a count is running; null once it has arrived.
  const [shown, setShown] = useState<number | null>(null);
  if (target !== value) {
    setTarget(value);
    // Start from whatever is on screen, so a second change mid-count does not jump.
    setShown(reducedMotion ? null : (shown ?? target));
  }

  const counting = shown !== null;
  useEffect(() => {
    if (!counting) return;
    const start = shown;
    const began = performance.now();
    let frame = requestAnimationFrame(function step(time) {
      const progress = Math.min(1, (time - began) / TICK_MS);
      const eased = 1 - (1 - progress) ** 3;
      setShown(progress < 1 ? Math.round(start + (value - start) * eased) : null);
      if (progress < 1) frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
    // Restarted by a new target only: `shown` moves every frame and is read once, as the starting point.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [counting, value]);

  return <>{shown ?? value}</>;
}
