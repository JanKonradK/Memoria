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
  exit: [0.4, 0, 1, 1] as CubicBezier,
} as const;

/** Shared physics keep position, crop and content in step when interrupted. */
const stagePhysics = { type: 'spring', stiffness: 380, damping: 40, mass: 1 } as const;
export const stageLayout: Transition = { ...stagePhysics };
export const stageSpring: Transition = { ...stagePhysics, restDelta: 0.0005, restSpeed: 0.01 };
export const sheetSpring: Transition = { type: 'spring', stiffness: 460, damping: 44, mass: 1, restDelta: 0.1 };
export const flingExitDuration = (velocity = 0): number =>
  duration.base - (Math.min(Math.max(velocity, 0), 2400) / 2400) * (duration.base - duration.fast);

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

/** Cards are immediately usable; expansion carries the state transition. */
export const cardEnter: Variants = {
  hidden: { opacity: 1 },
  visible: { opacity: 1 },
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
  hidden: { opacity: 0, y: 8, scale: 0.985 },
  visible: { opacity: 1, y: 0, scale: 1, transition: { duration: duration.base, ease: easing.out } },
  exit: { opacity: 0, y: 6, scale: 0.99, transition: { duration: duration.fast, ease: easing.exit } },
};

export const sheetEnter: Variants = {
  hidden: { y: '100%' },
  visible: { y: '0%', transition: sheetSpring },
  exit: (velocity = 0) => ({ y: '100%', transition: { duration: flingExitDuration(velocity), ease: easing.exit } }),
};

export const backdropFade: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: duration.fast, ease: easing.out } },
  exit: { opacity: 0, transition: { duration: duration.fast, ease: easing.out } },
};
