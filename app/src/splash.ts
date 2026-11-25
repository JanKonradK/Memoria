/**
 * The intro in index.html, and its exit.
 *
 * The page paints the splash before any script and starts it once its still
 * first frame is on screen. The app loads and renders underneath; when it has
 * drawn (splashDone) and the intro has played through, the splash fades away
 * over a settled page. The intro runs only on opacity and transform, so the
 * compositor keeps it smooth however busy the page is underneath.
 */

import { activeLookReady } from './looks';

/** Since the intro started, on a first open: long enough for the mark to land. */
export const INTRO_MS = 1400;
/** Every later open: the app is the point, so the splash only covers its first paint. */
export const REPEAT_INTRO_MS = 250;
/** Set once the full intro has been seen on this device. */
const SEEN_KEY = 'memoria-splash-seen';
const REDUCED_INTRO_MS = 650;
/** The exit's own length, and a little past it in case animationend never comes. */
const LEAVE_FALLBACK_MS = 1000;
/** Fonts usually land with the app; past this they swap in under a visible page. */
const FONT_WAIT_MS = 1200;
/** If the app never says it has drawn (a crash before first render), give the page back anyway. */
const LONGEST_MS = 9000;
/** The theme-color the splash shows in the phone's status bar. */
const GROUND = '#0c0d0f';

declare global {
  interface Window {
    /** performance.now() when index.html started the intro. */
    __memoriaSplashAt?: number;
  }
}

let done = false;
let leaving = false;
let skip: (() => void) | null = null;
let heldThemeColor: string | null = null;

const splash = () => (typeof document === 'undefined' ? null : document.getElementById('splash'));
const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const wait = (ms: number) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(done, ms);
    skip = done;
    function done() {
      clearTimeout(timer);
      skip = null;
      resolve();
    }
  });
const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/** Whether this device has seen the intro before; marks it seen. Storage can be blocked, so never throws. */
function seenBefore(): boolean {
  try {
    const seen = localStorage.getItem(SEEN_KEY) === '1';
    if (!seen) localStorage.setItem(SEEN_KEY, '1');
    return seen;
  } catch {
    return false;
  }
}

function themeColor() {
  return document.querySelector('meta[name="theme-color"]');
}

/**
 * While the splash is up, the status bar and browser chrome are its ground, not
 * the theme's. Called once the theme has set the colour it should return to.
 */
export function holdThemeColor(): void {
  const meta = themeColor();
  if (!splash() || !meta) return;
  heldThemeColor = meta.getAttribute('content');
  meta.setAttribute('content', GROUND);
}

function remove(node: HTMLElement) {
  node.remove();
  if (heldThemeColor) themeColor()?.setAttribute('content', heldThemeColor);
  heldThemeColor = null;
}

async function leave(node: HTMLElement) {
  if (leaving) return;
  leaving = true;
  // The page underneath gets painted during the intro, not in the fade's first frame.
  node.classList.add('warm');
  // The app drew before the intro could start: the window is hidden, so nobody
  // is watching. Give the page back as it is.
  if (window.__memoriaSplashAt == null && document.visibilityState === 'hidden') return remove(node);
  while (window.__memoriaSplashAt == null) await nextFrame();
  const elapsed = performance.now() - window.__memoriaSplashAt;
  const repeat = seenBefore();
  const intro = repeat ? REPEAT_INTRO_MS : reducedMotion() ? REDUCED_INTRO_MS : INTRO_MS;
  if (elapsed < intro) await wait(intro - elapsed);
  // The look's stylesheet and the faces land before the page is shown, so it never reveals half-dressed.
  await Promise.race([
    Promise.all([document.fonts?.ready, activeLookReady()]),
    new Promise((resolve) => setTimeout(resolve, FONT_WAIT_MS)),
  ]);
  // Two frames: the app's first paint under the splash is done, so the fade
  // uncovers a finished page, not one still laying out.
  await nextFrame();
  await nextFrame();
  node.classList.add('leave');
  const fallback = setTimeout(() => remove(node), LEAVE_FALLBACK_MS);
  node.addEventListener('animationend', (event) => {
    if (event.target !== node) return;
    clearTimeout(fallback);
    remove(node);
  });
}

/**
 * The app has drawn its first real screen. Safe to call more than once and
 * from anywhere; the splash leaves once its intro has played.
 */
export function splashDone(): void {
  if (done) return;
  done = true;
  const node = splash();
  if (node) void leave(node);
}

/** Before anything renders: a tap skips what is left of the intro once the app is ready, and a stuck start still ends. */
export function initSplash(): void {
  const node = splash();
  if (!node) return;
  node.addEventListener('pointerdown', () => skip?.());
  setTimeout(splashDone, LONGEST_MS);
}
