import { motion, useReducedMotion, useSpring, useTransform } from 'framer-motion';
import { useEffect } from 'react';

/** A number that springs to new values instead of jumping. */
export function Ticker({ value, className }: { value: number; className?: string }) {
  const reduced = useReducedMotion();
  const spring = useSpring(value, { stiffness: 110, damping: 22 });
  useEffect(() => {
    if (reduced) spring.jump(value);
    else spring.set(value);
  }, [value, reduced, spring]);
  const text = useTransform(spring, (v) => String(Math.round(v)));
  return <motion.span className={`tabular-nums ${className ?? ''}`}>{text}</motion.span>;
}
