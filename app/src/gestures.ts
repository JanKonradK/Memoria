import { useRef, type PointerEvent as ReactPointerEvent } from 'react';

/**
 * Drag sideways to change tab.
 *
 * Hand-rolled pointer events rather than the motion library's `drag`. `drag`
 * wants to own the transform of the element it is attached to, which here is the
 * page itself: it would fight the page's own vertical scrolling, and it would
 * fight the bottom sheet's drag-to-dismiss, which runs its own pointer capture.
 *
 * Almost all of the code below is about NOT firing. A swipe handler on the page
 * body sits underneath every control in the app, so the interesting question is
 * never "did the finger move sideways" — it is "was this gesture meant for
 * something else".
 */

/** Past this, a horizontal drag is a deliberate swipe rather than a wobble. */
const COMMIT_PX = 64;
/** …or a flick: short but fast enough to be unambiguous. */
const COMMIT_VELOCITY = 0.5;
/** How far to let a gesture travel before deciding which axis it belongs to. */
const AXIS_LOCK_PX = 10;

/**
 * Controls own their own gestures. A drag that starts on a button is that
 * button's business — this is what keeps the energy row's press-and-hold from
 * also paging the app sideways, without the energy row needing to know that
 * swiping exists.
 */
const INTERACTIVE = 'button, [role="button"], a, input, textarea, select, label, [contenteditable]';

type Axis = 'undecided' | 'horizontal' | 'vertical';

export function useTabSwipe(onSwipe: (direction: 1 | -1) => void) {
  const start = useRef<{ x: number; y: number; at: number; id: number } | null>(null);
  const axis = useRef<Axis>('undecided');

  const cancel = () => {
    start.current = null;
    axis.current = 'undecided';
  };

  return {
    onPointerDown: (event: ReactPointerEvent) => {
      // A mouse drag across a page is a text selection, not a gesture.
      if (event.pointerType === 'mouse' || !event.isPrimary) return;
      const target = event.target as HTMLElement;
      if (target.closest(INTERACTIVE)) return;
      // Anything that scrolls sideways already means something by a sideways
      // drag: the timeline ruler, the app bar's action strip, the game rails.
      for (let node: HTMLElement | null = target; node; node = node.parentElement) {
        if (node.scrollWidth > node.clientWidth + 1) return;
      }
      start.current = { x: event.clientX, y: event.clientY, at: event.timeStamp, id: event.pointerId };
      axis.current = 'undecided';
    },

    onPointerMove: (event: ReactPointerEvent) => {
      const origin = start.current;
      if (!origin || event.pointerId !== origin.id) return;
      const dx = event.clientX - origin.x;
      const dy = event.clientY - origin.y;

      if (axis.current === 'undecided') {
        if (Math.abs(dx) < AXIS_LOCK_PX && Math.abs(dy) < AXIS_LOCK_PX) return;
        // Resolved once and kept. Re-deciding mid-drag makes a diagonal gesture
        // flicker between scrolling and paging.
        axis.current = Math.abs(dy) > Math.abs(dx) ? 'vertical' : 'horizontal';
        if (axis.current === 'vertical') {
          cancel();
          return;
        }
      }
    },

    onPointerUp: (event: ReactPointerEvent) => {
      const origin = start.current;
      const resolved = axis.current;
      cancel();
      if (!origin || event.pointerId !== origin.id || resolved !== 'horizontal') return;
      const dx = event.clientX - origin.x;
      const elapsed = Math.max(1, event.timeStamp - origin.at);
      const committed = Math.abs(dx) > COMMIT_PX || Math.abs(dx) / elapsed > COMMIT_VELOCITY;
      if (!committed) return;
      // Drag left to go right, as on any pages-in-a-row surface.
      onSwipe(dx < 0 ? 1 : -1);
    },

    onPointerCancel: cancel,
  };
}
