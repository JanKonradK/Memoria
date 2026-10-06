import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from '../hooks';

/** A small status dot. Urgency never recolors the card shell. */
export function AttentionIndicator() {
  const ref = useRef<HTMLSpanElement>(null);
  const reduced = useReducedMotion();
  const [running, setRunning] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node || reduced || typeof IntersectionObserver === 'undefined') return;
    let visible = false;
    const update = () => setRunning(visible && !document.hidden);
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? false;
      update();
    });
    observer.observe(node);
    document.addEventListener('visibilitychange', update);
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', update);
    };
  }, [reduced]);

  return (
    <span
      ref={ref}
      role="img"
      aria-label="Needs attention"
      data-urgency-indicator
      className="attention-indicator"
      data-running={!reduced && running ? 'true' : undefined}
    />
  );
}
