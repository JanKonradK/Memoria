import type { Transition, Variants } from 'motion/react';

type CubicBezier = [number, number, number, number];

/** Seconds, mirroring the --dur-* custom properties in index.css. */
export const duration = {
  1: 0.12,
  2: 0.18,
  3: 0.24,
  4: 0.32,
  /** The names the components grew up with, on the same scale. */
  fast: 0.12,
  base: 0.24,
  slow: 0.32,
  stagger: 0.04,
} as const;

/** Cubic bezier tuples, mirroring the --ease-* custom properties in index.css. */
export const easing = {
  enter: [0.16, 1, 0.3, 1] as CubicBezier,
  move: [0.22, 1, 0.36, 1] as CubicBezier,
  exit: [0.4, 0, 1, 1] as CubicBezier,
  /** Arriving, under its older name. */
  out: [0.16, 1, 0.3, 1] as CubicBezier,
} as const;

/** A cubic bezier tuple as CSS, for the Web Animations API and inline transitions. */
export const cssEasing = (curve: CubicBezier): string => `cubic-bezier(${curve.join(', ')})`;

/** Only for the phone's drag sheet: it has to answer a finger, so it is physics, not a curve. */
export const sheetSpring: Transition = { type: 'spring', stiffness: 460, damping: 44, mass: 1, restDelta: 0.1 };
export const flingExitDuration = (velocity = 0): number =>
  duration.base - (Math.min(Math.max(velocity, 0), 2400) / 2400) * (duration.base - duration.fast);

/**
 * What a sheet's presence knows as it comes or goes: how fast a drag flung it,
 * and whether another sheet is taking its place (a handoff keeps the scrim up).
 */
export type SheetPresence = { velocity: number; handoff: boolean };

export const slideIn: Variants = {
  hidden: { opacity: 0, x: -12 },
  visible: { opacity: 1, x: 0, transition: { duration: duration.base, ease: easing.out } },
};

/** Handing over to the next sheet, the panel only fades where it stands. */
const handoffExit = { opacity: 0, transition: { duration: duration.fast, ease: easing.exit } };

export const dialogEnter: Variants = {
  hidden: { opacity: 0, y: 8, scale: 0.985 },
  visible: { opacity: 1, y: 0, scale: 1, transition: { duration: duration.base, ease: easing.out } },
  exit: (presence?: SheetPresence) =>
    presence?.handoff
      ? handoffExit
      : { opacity: 0, y: 6, scale: 0.99, transition: { duration: duration.fast, ease: easing.exit } },
};

export const sheetEnter: Variants = {
  hidden: { y: '100%' },
  visible: { y: '0%', transition: sheetSpring },
  exit: (presence?: SheetPresence) =>
    presence?.handoff
      ? handoffExit
      : { y: '100%', transition: { duration: flingExitDuration(presence?.velocity), ease: easing.exit } },
};

/** The scrim fades in and out with its sheet, and holds still while one sheet hands over to the next. */
export const backdropFade: Variants = {
  hidden: (presence?: SheetPresence) => ({ opacity: presence?.handoff ? 1 : 0 }),
  visible: { opacity: 1, transition: { duration: duration.fast, ease: easing.out } },
  exit: (presence?: SheetPresence) =>
    presence?.handoff
      ? { opacity: 1, transition: { duration: 0 } }
      : { opacity: 0, transition: { duration: duration.fast, ease: easing.exit } },
};
