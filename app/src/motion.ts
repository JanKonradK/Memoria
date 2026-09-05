import type { Variants } from 'motion/react';

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

/**
 * Entrance delay for the nth item in a list, in seconds.
 *
 * Capped at eight steps. Someone tracking fifteen games would otherwise wait
 * six tenths of a second for the last card, and a stagger that outlives the
 * glance it decorates has stopped being motion and started being latency.
 */
export const stagger = (index: number): number => Math.min(Math.max(0, index), 8) * duration.stagger;

export const pageEnter: Variants = {
  hidden: { opacity: 0, y: 6 },
  visible: { opacity: 1, y: 0, transition: { duration: duration.fast, ease: easing.out } },
};

/**
 * Cards arrive down the rail rather than all at once. `custom` carries the
 * card's position; without it every card in a nine-game dashboard began and
 * ended on the same frame, which reads as one block of content appearing rather
 * than as a set of objects being laid out.
 */
export const cardEnter: Variants = {
  hidden: { opacity: 0, y: 14, scale: 0.985 },
  visible: (index: number = 0) => ({
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: duration.base, ease: easing.out, delay: stagger(index) },
  }),
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
