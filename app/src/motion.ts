import type { Transition, Variants } from 'motion/react';

type CubicBezier = [number, number, number, number];

/** Seconds, mirroring the duration custom properties in index.css. */
export const duration = {
  fast: 0.14,
  base: 0.26,
  slow: 0.42,
  stagger: 0.04,
} as const;

/** Cubic bezier tuples, mirroring the easing custom properties in index.css. */
export const easing = {
  out: [0.22, 1, 0.36, 1] as CubicBezier,
} as const;

export const springs = {
  snappy: { type: 'spring', stiffness: 520, damping: 34, mass: 0.7 } satisfies Transition,
  gentle: { type: 'spring', stiffness: 300, damping: 28, mass: 0.9 } satisfies Transition,
} as const;

export const stagger = (index: number): number => Math.max(0, index) * duration.stagger;

export const pageEnter: Variants = {
  hidden: { opacity: 0, y: 6 },
  visible: { opacity: 1, y: 0, transition: { duration: duration.fast, ease: easing.out } },
};

export const cardEnter: Variants = {
  hidden: { opacity: 0, y: 18, scale: 0.98 },
  visible: { opacity: 1, y: 0, scale: 1, transition: { duration: duration.base, ease: easing.out } },
};

export const fadeDown: Variants = {
  hidden: { opacity: 0, y: -12 },
  visible: { opacity: 1, y: 0, transition: { duration: duration.base, ease: easing.out } },
};

export const slideIn: Variants = {
  hidden: { opacity: 0, x: -12 },
  visible: { opacity: 1, x: 0, transition: { duration: duration.base, ease: easing.out } },
};

export const dialogEnter: Variants = {
  hidden: { opacity: 0, y: 16, scale: 0.96 },
  visible: { opacity: 1, y: 0, scale: 1, transition: { duration: duration.base, ease: easing.out } },
  exit: { opacity: 0, y: 10, scale: 0.97, transition: { duration: duration.fast, ease: easing.out } },
};

export const sheetEnter: Variants = {
  hidden: { y: '100%' },
  visible: { y: 0, transition: { duration: duration.slow, ease: easing.out } },
  exit: { y: '100%', transition: { duration: duration.base, ease: easing.out } },
};

export const backdropFade: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: duration.fast, ease: easing.out } },
  exit: { opacity: 0, transition: { duration: duration.fast, ease: easing.out } },
};
