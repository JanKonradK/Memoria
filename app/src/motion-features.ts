/**
 * Async feature bundle for `LazyMotion`.
 *
 * Kept in its own module so Rollup can split it: `main.tsx` imports this
 * dynamically, and nothing in the static graph references `domMax`, so
 * the DOM animation feature set lands in a separate chunk that loads after
 * first paint instead of sitting in the critical path.
 *
 * `m` components render statically until this resolves, so the very first
 * frame is unanimated — an acceptable trade for taking the feature bundle off
 * the initial load.
 */
import { domMax } from 'motion/react';

export default domMax;
