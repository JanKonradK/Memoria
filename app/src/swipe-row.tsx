import {
  useRef,
  type CSSProperties,
  type HTMLAttributes,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { claimPointer, releasePointer } from './gestures';
import { buzz } from './haptics';
import './swipe-row.css';

/** What a swipe does when it is let go past its point. A missing one resists. */
export interface SwipeAction {
  /** Read out and shown as the reveal's name: "Done", "Not done". */
  label: string;
  run: () => void;
}

/** How far a row must travel before letting go acts: a third of it, never more than 112px. */
export function swipeCommitPx(width: number): number {
  return Math.max(56, Math.min(112, width * 0.35));
}

/** Past the point the row keeps moving, at a quarter of the finger's speed. */
export function swipeFollow(dx: number, width: number, allowed: boolean): number {
  if (!allowed) return Math.sign(dx) * Math.min(28, Math.abs(dx) / 4);
  const limit = swipeCommitPx(width);
  const travel = Math.abs(dx);
  return Math.sign(dx) * (travel <= limit ? travel : limit + (travel - limit) / 4);
}

/** Which side the gesture chose, or none: far enough, or a quick flick of 40px or more. */
export function swipeOutcome(dx: number, width: number, velocity: number): 'right' | 'left' | null {
  const far = Math.abs(dx) >= swipeCommitPx(width);
  const flick = Math.abs(dx) >= 40 && Math.abs(velocity) > 0.6 && Math.sign(velocity) === Math.sign(dx);
  if (!far && !flick) return null;
  return dx > 0 ? 'right' : 'left';
}

const AXIS_LOCK_PX = 10;
/** A swipe starting on these belongs to them: typing, a scrubbed bar, a link. */
const OWN_GESTURE = 'input, textarea, select, [contenteditable], [data-scrub], a[href]';

/** A pointer a nested row already took: the row around it lets it be. */
const taken = new WeakSet<Event>();

const CHECK = 'm5 10.5 3.2 3.2L15 7';
const UNDO = 'M7.5 6 4 9.5 7.5 13M4.5 9.5H12a4 4 0 0 1 0 8h-2';

type Drag = {
  id: number;
  x: number;
  y: number;
  width: number;
  axis: 'undecided' | 'horizontal' | 'vertical';
  dx: number;
  lastX: number;
  lastAt: number;
  velocity: number;
  armed: boolean;
};

/**
 * A row that completes on a swipe right and takes back on a swipe left. The row
 * slides with the finger; the action shows in the space it leaves, and a buzz
 * marks the point past which letting go acts. A direction the row has no action
 * for is not taken: that swipe still changes page. Touch and pen only: a mouse
 * drag selects text. Every row keeps its buttons, so nothing needs the swipe.
 */
export function SwipeRow({
  as: Tag = 'div',
  right,
  left,
  ink,
  className = '',
  style,
  children,
  ...rest
}: {
  as?: 'div' | 'li';
  /** Swipe right: complete. */
  right?: SwipeAction | null;
  /** Swipe left: take back. */
  left?: SwipeAction | null;
  /** The colour of the complete track, usually the game's. */
  ink?: string;
  children: ReactNode;
} & HTMLAttributes<HTMLElement>) {
  const ref = useRef<HTMLElement | null>(null);
  const drag = useRef<Drag | null>(null);

  const setX = (node: HTMLElement, x: number) => node.style.setProperty('--swipe-x', `${x}px`);

  const settle = (node: HTMLElement) => {
    node.dataset.swipeRelease = '';
    delete node.dataset.armed;
    setX(node, 0);
    const done = () => {
      delete node.dataset.swiping;
      delete node.dataset.swipeRelease;
      delete node.dataset.side;
      node.style.removeProperty('--swipe-x');
    };
    node.addEventListener('transitionend', done, { once: true });
    window.setTimeout(done, 320);
  };

  const swallowClick = () => {
    const stop = (event: Event) => {
      event.stopPropagation();
      event.preventDefault();
    };
    window.addEventListener('click', stop, { capture: true, once: true });
    window.setTimeout(() => window.removeEventListener('click', stop, { capture: true }), 400);
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    rest.onPointerDown?.(event);
    if (event.pointerType === 'mouse' || !event.isPrimary || (!right && !left)) return;
    if ((event.target as HTMLElement).closest(OWN_GESTURE) || taken.has(event.nativeEvent)) return;
    taken.add(event.nativeEvent);
    const node = ref.current;
    if (!node) return;
    drag.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      width: node.getBoundingClientRect().width,
      axis: 'undecided',
      dx: 0,
      lastX: event.clientX,
      lastAt: event.timeStamp,
      velocity: 0,
      armed: false,
    };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    rest.onPointerMove?.(event);
    const state = drag.current;
    const node = ref.current;
    if (!state || !node || event.pointerId !== state.id) return;
    const dx = event.clientX - state.x;
    const dy = event.clientY - state.y;
    if (state.axis === 'undecided') {
      if (Math.abs(dx) < AXIS_LOCK_PX && Math.abs(dy) < AXIS_LOCK_PX) return;
      state.axis = Math.abs(dy) >= Math.abs(dx) ? 'vertical' : 'horizontal';
      // A direction the row has nothing for is left to the page: it changes page.
      if (state.axis === 'vertical' || !(dx > 0 ? right : left)) {
        drag.current = null;
        return;
      }
      claimPointer(event.pointerId);
      try {
        node.setPointerCapture(event.pointerId);
      } catch {
        // A pointer that already ended cannot be captured; the move still counts.
      }
      node.dataset.swiping = '';
    }
    const elapsed = Math.max(1, event.timeStamp - state.lastAt);
    state.velocity = (event.clientX - state.lastX) / elapsed;
    state.lastX = event.clientX;
    state.lastAt = event.timeStamp;
    state.dx = dx;
    const action = dx > 0 ? right : left;
    node.dataset.side = dx > 0 ? 'right' : 'left';
    setX(node, swipeFollow(dx, state.width, Boolean(action)));
    const armed = Boolean(action) && Math.abs(dx) >= swipeCommitPx(state.width);
    if (armed !== state.armed) {
      state.armed = armed;
      if (armed) {
        node.dataset.armed = '';
        buzz('tick');
      } else delete node.dataset.armed;
    }
  };

  const finish = (event: ReactPointerEvent<HTMLElement>, cancelled: boolean) => {
    const state = drag.current;
    const node = ref.current;
    drag.current = null;
    if (!state || !node || event.pointerId !== state.id || state.axis !== 'horizontal') return;
    releasePointer(event.pointerId);
    swallowClick();
    settle(node);
    if (cancelled) return;
    const side = swipeOutcome(state.dx, state.width, state.velocity);
    if (!side) return;
    const action = side === 'right' ? right : left;
    if (!action) {
      buzz('edge');
      return;
    }
    buzz(side === 'right' ? 'success' : 'undo');
    action.run();
  };

  return (
    <Tag
      {...rest}
      ref={(node: HTMLElement | null) => {
        ref.current = node;
      }}
      className={`swipe-row ${className}`}
      data-swipe-row=""
      style={{ ...style, ...(ink ? { '--swipe-ink': ink } : {}) } as CSSProperties}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(event) => {
        rest.onPointerUp?.(event);
        finish(event, false);
      }}
      onPointerCancel={(event) => {
        rest.onPointerCancel?.(event);
        finish(event, true);
      }}
    >
      {children}
      {right && (
        <span aria-hidden className="swipe-reveal" data-for="right">
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.2">
            <path d={CHECK} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <b data-label={right.label} />
        </span>
      )}
      {left && (
        <span aria-hidden className="swipe-reveal" data-for="left">
          <b data-label={left.label} />
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
            <path d={UNDO} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      )}
    </Tag>
  );
}
