import { prefersReducedMotion } from './flip';
import { cssEasing, duration, easing } from './motion';

/**
 * Everything under a page's bar. The bar is already where it will rest, so it
 * never moves or takes a transform: only what is under it arrives.
 */
const BODY =
  ':scope > .app-page > :not(.page-bar, .focus-workspace), :scope > .app-page > .focus-workspace > :not(.page-bar)';

let running: Animation[] = [];

/**
 * A page's one arrival, on the compositor only. Down a wide screen's side rail
 * it is a short fade; on the dock it also glides in from the side its place
 * sits on (`direction`; 0 fades in place). No fill mode: the resting state is
 * the plain visible page, so an interrupted or missed arrival never hides it.
 * A newer arrival takes over from one still running.
 */
export function arrivePage(page: Element | null, direction: 1 | -1 | 0): void {
  for (const animation of running) animation.cancel();
  running = [];
  if (!page || prefersReducedMotion()) return;
  const glide = direction !== 0 && window.matchMedia?.('(orientation: portrait)').matches;
  const keyframes: Keyframe[] = glide
    ? [
        { opacity: 0.25, transform: `translate3d(${direction * 0.75}rem, 0, 0)` },
        { opacity: 1, transform: 'none' },
      ]
    : [{ opacity: 0.25 }, { opacity: 1 }];
  const timing: KeyframeAnimationOptions = {
    id: 'page-arrival',
    duration: (glide ? duration[3] : duration[2]) * 1000,
    easing: cssEasing(easing.enter),
  };
  for (const node of page.querySelectorAll<HTMLElement>(BODY)) {
    // jsdom has no Web Animations API; the page is simply there.
    if (typeof node.animate === 'function') running.push(node.animate(keyframes, timing));
  }
}
