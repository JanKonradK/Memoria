import { useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { claimPointer, releasePointer } from './gestures';
import { buzz } from './haptics';

/** A round step near a twentieth of the cap: 10 for 200 Resin, 10 for 240, 1 for 5 Condensed Resin. */
export function scrubStep(cap: number): number {
  if (!(cap > 0)) return 1;
  const raw = cap / 20;
  const nice = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];
  return nice.reduce(
    (best, step) => (Math.abs(Math.log(step / raw)) < Math.abs(Math.log(best / raw)) ? step : best),
    1,
  );
}

/**
 * The value a drag points at.
 * - `absolute`: where the finger is along the bar.
 * - `relative`: the starting value moved by the drag, the whole width for the whole cap.
 */
export function scrubValue(
  mode: 'absolute' | 'relative',
  {
    cap,
    start,
    x,
    left,
    width,
    dx,
  }: { cap: number; start: number; x: number; left: number; width: number; dx: number },
): number {
  if (!(width > 0) || !(cap > 0)) return start;
  const raw = mode === 'absolute' ? ((x - left) / width) * cap : start + (dx / width) * cap;
  return Math.min(cap, Math.max(0, Math.round(raw)));
}

const AXIS_LOCK_PX = 10;
const MOUSE_SLOP_PX = 4;

type Scrub = {
  id: number;
  x: number;
  y: number;
  left: number;
  width: number;
  start: number;
  mouse: boolean;
  active: boolean;
  value: number;
};

/**
 * Drag along a bar to set its value: a quick estimate without the keyboard.
 * A sideways drag claims the pointer (the page does not change); an upright one
 * scrolls. A tick buzzes at every step, an edge buzz at empty and at full, and
 * letting go commits. A tap alone never changes the reading.
 */
export function useScrub({
  cap,
  value,
  mode,
  measure,
  onDraft,
  onCommit,
  onCancel,
}: {
  cap: number;
  /** The value the drag starts from (relative mode). */
  value: number;
  mode: 'absolute' | 'relative';
  /** The element whose width maps to the cap; the bar itself by default. */
  measure?: (target: HTMLElement) => HTMLElement | null;
  onDraft: (value: number) => void;
  onCommit: (value: number) => void;
  onCancel?: () => void;
}) {
  const scrub = useRef<Scrub | null>(null);

  const end = (event: ReactPointerEvent<HTMLElement>, commit: boolean) => {
    const state = scrub.current;
    scrub.current = null;
    if (!state || event.pointerId !== state.id) return;
    releasePointer(event.pointerId);
    if (!state.active) return;
    delete event.currentTarget.dataset.scrubbing;
    // The lift after a drag is not a click on whatever is underneath.
    const stop = (click: Event) => {
      click.stopPropagation();
      click.preventDefault();
    };
    window.addEventListener('click', stop, { capture: true, once: true });
    window.setTimeout(() => window.removeEventListener('click', stop, { capture: true }), 400);
    if (commit) {
      buzz('light');
      onCommit(state.value);
    } else onCancel?.();
  };

  return {
    'data-scrub': '',
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
      if (!event.isPrimary || cap <= 0) return;
      if (event.pointerType === 'mouse' && (mode !== 'absolute' || event.button !== 0)) return;
      const host = (measure?.(event.currentTarget) ?? event.currentTarget).getBoundingClientRect();
      scrub.current = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        left: host.left,
        width: host.width,
        start: value,
        mouse: event.pointerType === 'mouse',
        active: false,
        value,
      };
    },
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => {
      const state = scrub.current;
      if (!state || event.pointerId !== state.id) return;
      const dx = event.clientX - state.x;
      const dy = event.clientY - state.y;
      if (!state.active) {
        if (state.mouse) {
          if (Math.abs(dx) < MOUSE_SLOP_PX) return;
        } else {
          if (Math.abs(dx) < AXIS_LOCK_PX && Math.abs(dy) < AXIS_LOCK_PX) return;
          if (Math.abs(dy) >= Math.abs(dx)) {
            scrub.current = null;
            return;
          }
        }
        state.active = true;
        claimPointer(event.pointerId);
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          // Already released; the drag still reads.
        }
        event.currentTarget.dataset.scrubbing = '';
      }
      const next = scrubValue(mode, {
        cap,
        start: state.start,
        x: event.clientX,
        left: state.left,
        width: state.width,
        dx,
      });
      if (next === state.value) return;
      const step = scrubStep(cap);
      const crossed = Math.floor(next / step) !== Math.floor(state.value / step);
      state.value = next;
      if (next === 0 || next === cap) buzz('edge');
      else if (crossed) buzz('tick');
      onDraft(next);
    },
    onPointerUp: (event: ReactPointerEvent<HTMLElement>) => end(event, true),
    onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => end(event, false),
  };
}
