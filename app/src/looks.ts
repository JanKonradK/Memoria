/**
 * Looks: the app's form, chosen in Settings → Appearance. A palette is colour
 * (palettes.ts); a look is everything else — faces, corners, rules, meters,
 * glow, the dock. The two never name each other: a look only mixes the
 * palette's tokens, so every look works under every palette, theme and accent.
 *
 * A look is a `data-look` attribute. On <html> it styles the app; on a Settings
 * preview card it styles just that card, with the same stylesheet
 * (src/looks/*.css, every rule under `[data-look='…']`). Classic is the
 * stylesheet itself and has no rules of its own.
 *
 * Detail is the other half: Elaborate shows the words, Minimal shows only the
 * facts and the controls (`data-detail` on <html>).
 */

export const LOOK_IDS = ['classic', 'instrument', 'hud', 'clean', 'glass', 'arcade', 'paper', 'neon'] as const;
export type LookId = (typeof LOOK_IDS)[number];
export const DEFAULT_LOOK: LookId = 'classic';

export type Detail = 'elaborate' | 'minimal';
export const DEFAULT_DETAIL: Detail = 'elaborate';

export interface Look {
  id: LookId;
  name: string;
  /** One line under its name in Settings. */
  blurb: string;
}

export const LOOKS: readonly Look[] = [
  { id: 'classic', name: 'Classic', blurb: 'Quiet graphite, hairline rules' },
  { id: 'instrument', name: 'Instrument', blurb: 'Monochrome readout, one red live dot' },
  { id: 'hud', name: 'Soft HUD', blurb: 'Dot grid, glow only on what is live' },
  { id: 'clean', name: 'Clean', blurb: 'Flat tonal fills, heavy friendly type' },
  { id: 'glass', name: 'Glass', blurb: 'Frosted panels over your games’ colours' },
  { id: 'arcade', name: 'Arcade', blurb: 'Stepped corners, blocky meters' },
  { id: 'paper', name: 'Paper', blurb: 'Serif headings, ink rules' },
  { id: 'neon', name: 'Neon', blurb: 'Game colours as neon outlines' },
];

export const isLookId = (value: unknown): value is LookId =>
  typeof value === 'string' && (LOOK_IDS as readonly string[]).includes(value);
export const isDetail = (value: unknown): value is Detail => value === 'elaborate' || value === 'minimal';

/**
 * Each look's own stylesheet and faces, fetched only once that look is in use
 * (or previewed in Settings). Faces are Latin only, in the weights it sets.
 * Keeping them out of the startup path is what keeps eight looks free for a
 * player who uses one; the intro covers the app while the first arrives.
 */
const PARTS: Record<Exclude<LookId, 'classic'>, () => Promise<unknown>> = {
  instrument: () =>
    Promise.all([
      import('./looks/instrument.css'),
      import('@fontsource/doto/latin-800.css'),
      import('@fontsource/space-mono/latin-400.css'),
      import('@fontsource/space-mono/latin-700.css'),
    ]),
  hud: () => import('./looks/hud.css'),
  clean: () =>
    Promise.all([
      import('./looks/clean.css'),
      import('@fontsource/dm-sans/700.css'),
      import('@fontsource/dm-sans/800.css'),
    ]),
  glass: () => import('./looks/glass.css'),
  arcade: () =>
    Promise.all([
      import('./looks/arcade.css'),
      import('@fontsource/pixelify-sans/latin-500.css'),
      import('@fontsource/pixelify-sans/latin-700.css'),
    ]),
  paper: () =>
    Promise.all([
      import('./looks/paper.css'),
      import('@fontsource/fraunces/latin-600.css'),
      import('@fontsource/fraunces/latin-400-italic.css'),
    ]),
  neon: () => import('./looks/neon.css'),
};

const requested = new Map<LookId, Promise<unknown>>([['classic', Promise.resolve()]]);
const arrived = new Set<LookId>(['classic']);

/** Fetches a look's stylesheet and faces once. Safe to call for every preview card. */
export function loadLookFaces(look: LookId): Promise<unknown> {
  let pending = requested.get(look);
  if (!pending) {
    pending = PARTS[look as Exclude<LookId, 'classic'>]()
      .then(() => arrived.add(look))
      .catch(() => requested.delete(look));
    requested.set(look, pending);
  }
  return pending;
}

/** The look the page should end up wearing, so a slow stylesheet never overrides a later choice. */
let wanted: LookId | null = null;

/** Settles once the look the page is wearing (or about to wear) has its stylesheet and faces. */
export function activeLookReady(): Promise<unknown> {
  return requested.get(wanted ?? 'classic') ?? Promise.resolve();
}

/**
 * Puts a look and a detail level on the page. A look change cross-fades where
 * the browser can, and is instant under reduced motion.
 */
export function applyLook(look: LookId, detail: Detail, animate = false): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  wanted = look;
  // Always fetched, even when the pre-paint script already put the look on the page.
  const pending = loadLookFaces(look);
  root.dataset.detail = detail;
  if (root.dataset.look === look) return;
  const swap = () => {
    if (wanted !== look) return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const start = (document as Document & { startViewTransition?: (update: () => void) => unknown })
      .startViewTransition;
    const set = () => {
      root.dataset.look = look;
    };
    if (animate && !reduced && typeof start === 'function') start.call(document, set);
    else set();
  };
  // A chosen look swaps once its stylesheet is here, so it never shows half-dressed.
  if (arrived.has(look)) swap();
  else void pending.then(swap);
}
