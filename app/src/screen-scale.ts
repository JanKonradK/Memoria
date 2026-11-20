/**
 * On a touch screen the app scales to the screen it is on rather than drawing
 * at fixed pixels: a tablet gets larger type, targets and spacing to fill its
 * glass, a small phone a touch smaller. It sets the viewport's width, so every
 * length and every breakpoint follows together. A PC (a mouse) is left alone:
 * there the window decides.
 *
 * A regular phone (a short side of 360 to 480px) draws at exactly 1, so its
 * layout is the one designed for it. Smaller phones shrink a touch, down to
 * MIN; larger screens grow with their short side, up to MAX on a big tablet.
 */

const SMALL = 360;
const LARGE = 480;
const TABLET = 1000;
const MIN = 0.9;
const MAX = 1.35;

/** The scale for a screen whose shorter side is `short` CSS px at 1:1. */
export function screenScale(short: number): number {
  if (!(short > 0)) return 1;
  if (short < SMALL) return Math.round(Math.max(MIN, short / SMALL) * 100) / 100;
  if (short <= LARGE) return 1;
  const grow = Math.min(1, (short - LARGE) / (TABLET - LARGE));
  return Math.round((1 + (MAX - 1) * grow) * 100) / 100;
}

function apply(meta: HTMLMetaElement) {
  // screen.* is the device in CSS px at scale 1, whatever the viewport is set to now.
  const { width, height } = window.screen;
  const portrait = window.matchMedia('(orientation: portrait)').matches;
  const across = portrait ? Math.min(width, height) : Math.max(width, height);
  const scale = screenScale(Math.min(width, height));
  const content = `width=${Math.round(across / scale)}, viewport-fit=cover`;
  if (meta.content !== content) meta.content = content;
  document.documentElement.style.setProperty('--screen-scale', String(scale));
}

export function initScreenScale(): void {
  if (typeof window === 'undefined' || !window.matchMedia?.('(pointer: coarse)').matches) return;
  const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  if (!meta) return;
  apply(meta);
  window.matchMedia('(orientation: portrait)').addEventListener('change', () => apply(meta));
}
