/**
 * The mark's own finish and the app's backdrop, chosen in Settings →
 * Appearance. A colour is the mark's metal; a shading is how that metal is lit
 * (Logo.tsx draws each from the layered geometry in mark-path.ts); a backing
 * is the tile it may sit on; a backdrop is laid over the look's ground
 * (looks/looks.css, `data-backdrop` on <html>).
 *
 * Kept small: Logo and the store load it at startup. The pickers live in the
 * lazy Settings chunk.
 */

import type { FeatureTier } from './entitlements';

export const MARK_COLOUR_IDS = [
  'gilded',
  'ivory',
  'accent',
  'celestial',
  'rose-gold',
  'amethyst',
  'emerald',
  'crimson',
  'prismatic',
] as const;
export type MarkColourId = (typeof MARK_COLOUR_IDS)[number];

export const MARK_SHADING_IDS = ['luminous', 'flat', 'sculpted', 'chiseled', 'celestial'] as const;
export type MarkShadingId = (typeof MARK_SHADING_IDS)[number];

export const MARK_BACKING_IDS = ['bare', 'obsidian', 'tinted', 'gilded'] as const;
export type MarkBackingId = (typeof MARK_BACKING_IDS)[number];

export const BACKDROP_IDS = ['default', 'obsidian', 'starfield', 'nebula', 'astral-grid', 'horizon'] as const;
export type BackdropId = (typeof BACKDROP_IDS)[number];

/** Highlight, light, body, deep: the ramp runs down the mark with a lean to the right. */
export type MarkStops = readonly [string, string, string, string];

export interface MarkColour {
  id: MarkColourId;
  label: string;
  tier: FeatureTier;
  /** The ramp on a dark ground or a dark tile; `accent` follows the palette's accent. */
  stops: MarkStops | 'accent';
  /** The same metal as ink, for a bare or glass mark on a light ground. */
  inkStops: MarkStops | 'accent';
  /** Shade on this metal: warm, never grey. */
  shadowTint: string;
  /** The sheen along the arches and the gilded tile's hairline. */
  rimTint: string;
  /** A CSS background for its swatch, and the intro's mark fill. */
  previewCss: string;
}

/** The palette's accent, lifted and deepened. Fallbacks keep the intro lit before the stylesheet arrives. */
const ACCENT = 'var(--color-accent, #e8b45a)';
export const ACCENT_STOPS: MarkStops = [
  `color-mix(in oklch, ${ACCENT} 22%, #ffffff)`,
  `color-mix(in oklch, ${ACCENT} 55%, #ffffff)`,
  ACCENT,
  `color-mix(in oklch, ${ACCENT} 72%, #000000)`,
];
export const ACCENT_INK_STOPS: MarkStops = [
  `color-mix(in oklch, ${ACCENT} 40%, var(--color-fg, #202127))`,
  ACCENT,
  `color-mix(in oklch, ${ACCENT} 82%, #000000)`,
  `color-mix(in oklch, ${ACCENT} 58%, #000000)`,
];

const ramp = ([a, b, c, d]: MarkStops) => `linear-gradient(to bottom right, ${a}, ${b} 56%, ${c} 90%, ${d})`;

function colour(
  id: MarkColourId,
  label: string,
  tier: FeatureTier,
  stops: MarkStops,
  inkStops: MarkStops,
  shadowTint: string,
  rimTint: string,
): MarkColour {
  return { id, label, tier, stops, inkStops, shadowTint, rimTint, previewCss: ramp(stops) };
}

export const MARK_COLOURS: readonly MarkColour[] = [
  colour(
    'gilded',
    'Gilded Ivory',
    'free',
    ['#ffffff', '#fff6dc', '#e8b45a', '#c99138'],
    // The theme's own ink and gold, so the bare mark keeps its edge on a pale ground.
    ['var(--color-fg)', 'var(--color-gold-hi)', 'var(--color-gold)', 'var(--color-gold-lo)'],
    '#6e4512',
    '#e8b45a',
  ),
  colour(
    'ivory',
    'Moonlight Ivory',
    'free',
    ['#ffffff', '#f7f4ec', '#ddd6c6', '#b5ab96'],
    ['#1d1e22', '#3b3a36', '#5a5548', '#2e2c27'],
    '#4a4234',
    '#e9e2d2',
  ),
  {
    id: 'accent',
    label: 'Theme Accent',
    tier: 'free',
    stops: 'accent',
    inkStops: 'accent',
    shadowTint: `color-mix(in oklch, ${ACCENT} 45%, #000000)`,
    rimTint: ACCENT,
    previewCss: ramp(ACCENT_STOPS),
  },
  colour(
    'celestial',
    'Astral Gold-Cyan',
    'pro',
    ['#f2feff', '#a9ecff', '#f0cf7a', '#c39235'],
    ['#123a4a', '#1f6f86', '#8a6a1e', '#5e4510'],
    '#24455a',
    '#8fe3ff',
  ),
  colour(
    'rose-gold',
    'Dawn Rose Gold',
    'pro',
    ['#fff7f3', '#ffd9cc', '#e8a48a', '#b8705a'],
    ['#3a2420', '#9a5a48', '#8c4c3a', '#6a3528'],
    '#6b3326',
    '#f0b49e',
  ),
  colour(
    'amethyst',
    'Void Amethyst',
    'pro',
    ['#fbf6ff', '#e3cfff', '#a97ae8', '#6f45b8'],
    ['#2a1d3d', '#6e48b0', '#5a3796', '#3f2470'],
    '#3a1f66',
    '#c4a2ff',
  ),
  colour(
    'emerald',
    'Verdant Jade',
    'pro',
    ['#f4fff9', '#c7f5dd', '#4fc794', '#1f8a63'],
    ['#14302a', '#1f7a58', '#18694b', '#0f4b36'],
    '#0f4a35',
    '#6fe0ad',
  ),
  colour(
    'crimson',
    'Ember Crimson',
    'pro',
    ['#fff4ee', '#ffc9a8', '#f0624a', '#a8281f'],
    ['#3a1612', '#b8402e', '#9a2a1e', '#6e1a14'],
    '#5c1610',
    '#ff8a6a',
  ),
  colour(
    'prismatic',
    'Iridescent Prism',
    'pro',
    ['#ffffff', '#b6f0ff', '#d9a6ff', '#ffb86b'],
    ['#1f2a44', '#2f6fa8', '#7a46b8', '#a85a1c'],
    '#3a2a5a',
    '#c8b6ff',
  ),
];

export interface BrandOption<Id extends string> {
  id: Id;
  label: string;
  tier: FeatureTier;
  /** One line under its name in Settings. */
  blurb: string;
}

export const MARK_SHADINGS: readonly BrandOption<MarkShadingId>[] = [
  { id: 'luminous', label: 'Luminous', tier: 'free', blurb: 'Smooth ramp, a soft dip where the ribbons cross' },
  { id: 'flat', label: 'Flat', tier: 'free', blurb: 'One crisp ink, no bevel or shadow' },
  { id: 'sculpted', label: 'Sculpted Relief', tier: 'pro', blurb: 'Deep crossing, lit arches, shards fading by tier' },
  { id: 'chiseled', label: 'Chiselled Facet', tier: 'pro', blurb: 'Bevelled edges and sharp specular glints' },
  { id: 'celestial', label: 'Celestial Glow', tier: 'pro', blurb: 'Lit core, warm crossing bloom, stardust shards' },
];

export const MARK_BACKINGS: readonly BrandOption<MarkBackingId>[] = [
  { id: 'bare', label: 'Open', tier: 'free', blurb: 'The mark alone on the ground' },
  { id: 'obsidian', label: 'Obsidian', tier: 'free', blurb: 'A black squircle with a quiet edge' },
  { id: 'tinted', label: 'Surface Glass', tier: 'pro', blurb: 'A squircle in the theme’s own surface' },
  { id: 'gilded', label: 'Gilded Rim', tier: 'pro', blurb: 'Black with a warm gold hairline' },
];

export const BACKDROPS: readonly BrandOption<BackdropId>[] = [
  { id: 'default', label: 'Look Default', tier: 'free', blurb: 'The look’s own ground' },
  { id: 'obsidian', label: 'Void Obsidian', tier: 'free', blurb: 'A deeper matte ground; crisp paper in light' },
  { id: 'starfield', label: 'Celestial Dust', tier: 'pro', blurb: 'Faint gold and cool pinpoints, a soft vignette' },
  { id: 'nebula', label: 'Void Nebula', tier: 'pro', blurb: 'A deep glow in your accent' },
  { id: 'astral-grid', label: 'Drafting Matrix', tier: 'pro', blurb: 'Fine coordinate hairlines' },
  { id: 'horizon', label: 'Gilded Horizon', tier: 'pro', blurb: 'A warm horizon rising from the foot' },
];

export const DEFAULT_MARK_COLOUR: MarkColourId = 'gilded';
export const DEFAULT_MARK_SHADING: MarkShadingId = 'luminous';
export const DEFAULT_MARK_BACKING: MarkBackingId = 'bare';
export const DEFAULT_BACKDROP: BackdropId = 'default';

const oneOf =
  <Id extends string>(ids: readonly Id[]) =>
  (value: unknown): value is Id =>
    typeof value === 'string' && (ids as readonly string[]).includes(value);

export const isMarkColourId = oneOf(MARK_COLOUR_IDS);
export const isMarkShadingId = oneOf(MARK_SHADING_IDS);
export const isMarkBackingId = oneOf(MARK_BACKING_IDS);
export const isBackdropId = oneOf(BACKDROP_IDS);

/** The preset for an id; Gilded Ivory for anything unknown. */
export const findMarkColour = (id: unknown): MarkColour =>
  MARK_COLOURS.find((candidate) => candidate.id === id) ?? MARK_COLOURS[0]!;

export interface BrandChoice {
  markColour: MarkColourId;
  markShading: MarkShadingId;
  markBacking: MarkBackingId;
  backdrop: BackdropId;
}

/** The brand fields out of a larger object, such as the UI store's state. */
export const pickBrand = ({ markColour, markShading, markBacking, backdrop }: BrandChoice): BrandChoice => ({
  markColour,
  markShading,
  markBacking,
  backdrop,
});

/** What the pre-paint script in index.html reads, so a reload paints the backdrop and the intro's mark first. */
export const BRAND_STORAGE_KEY = 'memoria-brand';

/** Puts the backdrop and the intro's mark fill on the page, and remembers both for the next first paint. */
export function applyBrand({ markColour, markShading, markBacking, backdrop }: BrandChoice): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (backdrop === DEFAULT_BACKDROP) root.removeAttribute('data-backdrop');
  else root.setAttribute('data-backdrop', backdrop);
  const splashFill = findMarkColour(markColour).previewCss;
  root.style.setProperty('--splash-mark-fill', splashFill);
  try {
    localStorage.setItem(
      BRAND_STORAGE_KEY,
      JSON.stringify({ markColour, markShading, markBacking, backdrop, splashFill }),
    );
  } catch {
    // Without storage the brand still applies; a reload just paints the default intro first.
  }
}
