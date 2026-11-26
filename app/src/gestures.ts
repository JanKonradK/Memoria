import { useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { GAME_TABS, type GameTab } from './ui-store';

/**
 * Drag sideways to change a game page's tab. Only a game's page swipes; the
 * places (Today, Calendar, Notes, Settings) never page sideways.
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
const AXIS_LOCK_PX = 16;
/** A drag starting this close to either side of the screen is the system's back gesture, not a swipe. */
const EDGE_PX = 24;

/**
 * Controls own their own gestures. A drag that starts on a button is that
 * button's business — this is what keeps the energy row's press-and-hold from
 * also paging the app sideways, without the energy row needing to know that
 * swiping exists.
 */
const INTERACTIVE = 'button, [role="button"], a, input, textarea, select, label, [contenteditable]';
/**
 * Inside a swipeable row, its open button lets the page swipe through: the row
 * takes only the direction it has an action for. Its inner controls still don't.
 */
const ROW_INNER_CONTROL =
  '.energy-value-stepper, .today-step-tick, [data-scrub], a, input, textarea, select, [contenteditable]';
/**
 * Surfaces that mean something by a sideways drag of their own: the tab and
 * account strips scroll, the Calendar's board and ruler step the week, and a
 * bar is scrubbed to a value.
 */
const OWN_SIDEWAYS = '.game-tabs, .game-accounts, .tl-board, [data-timeline-scale], .energy-scrub';

type Axis = 'undecided' | 'horizontal' | 'vertical';

/**
 * A row or a bar that took a sideways drag for itself: a row swiped to complete,
 * a bar scrubbed to a value. The page swipe lets that pointer go. A row claims
 * only a direction it has an action for, so the other way still changes page.
 */
let claimed: number | null = null;
export function claimPointer(id: number): void {
  claimed = id;
}
export function releasePointer(id: number): void {
  if (claimed === id) claimed = null;
}

/** The page follows a third of the drag, up to this far: enough to feel, not to read as a slide. */
const FOLLOW_MAX_PX = 48;

/** The page being dragged: the route wrapper, never `main`, which holds the fixed dock. */
const pageOf = (host: Element) => host.querySelector<HTMLElement>(':scope > .page-enter, .page-enter');

function follow(page: HTMLElement | null, dx: number) {
  if (!page) return;
  if ('swipeRelease' in page.dataset) releaseGen.set(page, (releaseGen.get(page) ?? 0) + 1);
  page.removeAttribute('data-swipe-release');
  page.dataset.swiping = '';
  page.style.setProperty('--page-swipe-x', `${Math.max(-FOLLOW_MAX_PX, Math.min(FOLLOW_MAX_PX, dx / 3))}px`);
}

/** Each page's latest release: an older one's late timer leaves a newer drag be. */
const releaseGen = new WeakMap<HTMLElement, number>();

function release(page: HTMLElement | null) {
  if (!page || !('swiping' in page.dataset)) return;
  const gen = (releaseGen.get(page) ?? 0) + 1;
  releaseGen.set(page, gen);
  page.dataset.swipeRelease = '';
  page.style.setProperty('--page-swipe-x', '0px');
  let timer = 0;
  const done = () => {
    page.removeEventListener('transitionend', onEnd);
    window.clearTimeout(timer);
    if (releaseGen.get(page) !== gen) return;
    page.removeAttribute('data-swiping');
    page.removeAttribute('data-swipe-release');
    page.style.removeProperty('--page-swipe-x');
  };
  // Only the page body's spring back on `translate`, not a transition ending inside it.
  function onEnd(event: TransitionEvent) {
    if (
      event.propertyName === 'translate' &&
      event.target instanceof Element &&
      event.target.parentElement?.matches('.app-page, .focus-workspace')
    ) {
      done();
    }
  }
  page.addEventListener('transitionend', onEnd);
  // Reduced motion has no transition to end.
  timer = window.setTimeout(done, 400);
}

export function useTabSwipe(onSwipe: (direction: 1 | -1) => void) {
  const start = useRef<{ x: number; y: number; at: number; id: number } | null>(null);
  const axis = useRef<Axis>('undecided');
  const page = useRef<HTMLElement | null>(null);

  const cancel = () => {
    start.current = null;
    axis.current = 'undecided';
    release(page.current);
    page.current = null;
  };

  return {
    onPointerDown: (event: ReactPointerEvent) => {
      // A mouse drag across a page is a text selection, not a gesture.
      if (event.pointerType === 'mouse' || !event.isPrimary) return;
      // The screen's own edges belong to the system's back gesture.
      const width = window.innerWidth || document.documentElement.clientWidth;
      if (event.clientX < EDGE_PX || (width > EDGE_PX * 2 && event.clientX > width - EDGE_PX)) return;
      const target = event.target as HTMLElement;
      if (target.closest(OWN_SIDEWAYS)) return;
      const control = target.closest(INTERACTIVE);
      if (control) {
        const row = control.closest('[data-swipe-row]');
        if (!row || target.closest(ROW_INNER_CONTROL)) return;
      }
      // Anything that scrolls sideways already means something by a sideways
      // drag: the timeline ruler, a page bar's tabs, the dock's games.
      // Only a real sideways scroller: content mid-slide (a tab entering) also
      // overflows for a moment, and must not swallow the next swipe.
      for (let node: HTMLElement | null = target; node; node = node.parentElement) {
        if (node.scrollWidth > node.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(node).overflowX)) return;
      }
      start.current = { x: event.clientX, y: event.clientY, at: event.timeStamp, id: event.pointerId };
      axis.current = 'undecided';
      page.current = pageOf(event.currentTarget);
    },

    onPointerMove: (event: ReactPointerEvent) => {
      const origin = start.current;
      if (!origin || event.pointerId !== origin.id) return;
      if (claimed === origin.id) {
        cancel();
        return;
      }
      const dx = event.clientX - origin.x;
      const dy = event.clientY - origin.y;

      if (axis.current === 'undecided') {
        if (Math.abs(dx) < AXIS_LOCK_PX && Math.abs(dy) < AXIS_LOCK_PX) return;
        // Resolved once and kept. Re-deciding mid-drag makes a diagonal gesture
        // flicker between scrolling and paging. Only a clearly sideways drag,
        // twice as wide as it is tall, pages; anything steeper is a scroll.
        axis.current = Math.abs(dx) > Math.abs(dy) * 2 ? 'horizontal' : 'vertical';
        if (axis.current === 'vertical') {
          cancel();
          return;
        }
      }
      follow(page.current, dx);
    },

    onPointerUp: (event: ReactPointerEvent) => {
      const origin = start.current;
      const resolved = axis.current;
      cancel();
      if (!origin || event.pointerId !== origin.id || resolved !== 'horizontal' || claimed === origin.id) return;
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

/**
 * Where a swipe on a game's page goes: the next of its tabs, or nowhere past
 * either end. There the page only rubber-bands; a swipe never jumps to another
 * game or place.
 */
export function nextGameStop(tabs: readonly GameTab[], current: GameTab, towards: 1 | -1): GameTab | null {
  const shown = tabs.length ? tabs : GAME_TABS;
  const at = Math.max(0, shown.indexOf(current));
  return shown[at + towards] ?? null;
}
