import { useLayoutEffect, useRef, type RefObject } from 'react';
import { cssEasing, duration, easing } from './motion';

type Point = { x: number; y: number };

// A row already on screen changing place: the scale's arrival length on its move curve.
const DURATION_MS = duration[3] * 1000;
const EASING = cssEasing(easing.move);
const MIN_MOVE_PX = 1;
// More movers than this is a layout change (resize, reflow), not a reorder; jumping is right there.
const MAX_MOVERS = 24;

/** Document coordinates, so a page scroll between commits reads as no movement. */
function place(node: HTMLElement): Point {
  const rect = node.getBoundingClientRect();
  return { x: rect.left + window.scrollX, y: rect.top + window.scrollY };
}

export function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Glides keyed rows to their new places when a reorder moves them (FLIP): the DOM
 * swaps at once, and each moved row animates from where it was drawn to where it rests.
 */
export function useFlip<T extends HTMLElement>(
  selector: string,
  keyOf: (node: HTMLElement) => string | null,
  /**
   * The rows' order, as one string. Given, a commit that keeps it (a clock tick)
   * measures nothing, so a ticking list does not force a layout every minute.
   */
  orderKey?: string,
): RefObject<T | null> {
  const ref = useRef<T | null>(null);
  // Resting positions from the last commit. Empty before the list first appears.
  const settled = useRef(new Map<string, Point>());
  const running = useRef(new WeakMap<HTMLElement, Animation>());
  // The order and the list measured last, to know when a commit changed neither.
  const measured = useRef<{ orderKey: string; container: HTMLElement } | null>(null);

  useLayoutEffect(() => {
    const previous = settled.current;
    const container = ref.current;
    if (!container) {
      settled.current = new Map();
      measured.current = null;
      return;
    }
    if (orderKey !== undefined && measured.current?.orderKey === orderKey && measured.current.container === container)
      return;
    measured.current = orderKey === undefined ? null : { orderKey, container };
    const keyed = Array.from(container.querySelectorAll<HTMLElement>(selector)).flatMap((node) => {
      const key = keyOf(node);
      return key == null ? [] : [{ node, key }];
    });
    // A commit can land mid-glide (the clock re-renders each second). Cancelling snaps the
    // row to rest, so take its drawn spot first and glide from there, not from the old rest.
    const drawn = new Map<HTMLElement, Point>();
    for (const { node } of keyed) {
      const glide = running.current.get(node);
      if (!glide) continue;
      drawn.set(node, place(node));
      glide.cancel();
      running.current.delete(node);
    }
    const rested = keyed.map(({ node, key }) => ({ node, key, at: place(node) }));
    settled.current = new Map(rested.map(({ key, at }) => [key, at]));

    const movers: { node: HTMLElement; dx: number; dy: number }[] = [];
    for (const { node, key, at } of rested) {
      const before = previous.get(key);
      if (!before) continue;
      const from = drawn.get(node) ?? before;
      const dx = from.x - at.x;
      const dy = from.y - at.y;
      if (Math.abs(dx) > MIN_MOVE_PX || Math.abs(dy) > MIN_MOVE_PX) movers.push({ node, dx, dy });
    }
    if (previous.size === 0 || movers.length === 0 || movers.length > MAX_MOVERS || prefersReducedMotion()) return;

    for (const { node, dx, dy } of movers) {
      // jsdom has no Web Animations API; the rows simply appear in their new places there.
      if (typeof node.animate !== 'function') return;
      running.current.set(
        node,
        node.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], {
          duration: DURATION_MS,
          easing: EASING,
        }),
      );
    }
  });

  return ref;
}
