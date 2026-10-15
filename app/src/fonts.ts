import type { CSSProperties } from 'react';

/**
 * Per-game title faces (@fontsource imports live in main.tsx), each set the way
 * that game's round logo in docs/logos sets its name: the same family, weight,
 * case and spacing.
 *
 * Open-licence approximations, never ripped proprietary game faces. The value is
 * a CSS font-family stored on `Game.titleFont` and editable per game, so a game
 * the presets have never heard of can still be given a face.
 *
 * A game's face appears on its name and nowhere else.
 */
export const FONT_OPTIONS: Array<{ label: string; css: string; style: CSSProperties }> = [
  {
    label: 'Cinzel Decorative — engraved capitals with flourishes',
    css: "'Cinzel Decorative', serif",
    style: { fontWeight: 700 },
  },
  // The faces below ship one weight each, so they are never emboldened.
  { label: 'Zen Dots — wide soft-cornered sci-fi', css: "'Zen Dots', sans-serif", style: { fontWeight: 400 } },
  { label: 'Bungee — chunky street signage', css: "'Bungee', sans-serif", style: { fontWeight: 400 } },
  {
    label: 'Vujahday Script — flowing script',
    css: "'Vujahday Script', 'DM Sans', sans-serif",
    // A low x-height: sized up to read at the height of the text around it,
    // with room for the slant where it truncates.
    style: { fontWeight: 400, fontSizeAdjust: 0.52, letterSpacing: 0, paddingInline: '0.08em 0.35em' },
  },
  { label: 'Righteous — curvy retro display', css: "'Righteous', sans-serif", style: { fontWeight: 400 } },
  {
    label: 'Italiana — fine spaced capitals',
    css: "'Italiana', serif",
    style: { fontWeight: 400, textTransform: 'uppercase', letterSpacing: '0.12em' },
  },
  { label: 'Mochiy Pop One — bubbly pop', css: "'Mochiy Pop One', sans-serif", style: { fontWeight: 400 } },
  {
    label: 'Black Ops One — stencil capitals',
    css: "'Black Ops One', sans-serif",
    style: { fontWeight: 400, textTransform: 'uppercase' },
  },
  {
    label: 'Share Tech Mono — terminal capitals',
    css: "'Share Tech Mono', monospace",
    style: { fontWeight: 400, textTransform: 'uppercase' },
  },
];

/** The shell face, used for any game that has not been given one. */
const DEFAULT_TITLE: CSSProperties = { fontFamily: "'DM Sans', system-ui, sans-serif", fontWeight: 600 };

/**
 * Faces this build no longer ships. A game stored under one of them still has
 * that string on it, and the browser would silently fall back to the system
 * face — so it is remapped to a surviving face at read time rather than left to
 * rot. Exo 2 was Wuthering Waves' face before its logo set the name in script;
 * the rest are the faces the logos used before each was re-lettered in a face
 * of its own, and map to that game's new one.
 */
const RETIRED_FACES: Array<[RegExp, string]> = [
  [/marcellus|cinzel(?!\s*decorative)/i, 'Cinzel Decorative'],
  [/michroma|orbitron/i, 'Zen Dots'],
  [/rajdhani/i, 'Bungee'],
  [/archivo\s*black|baloo|space\s*grotesk/i, 'Righteous'],
  [/exo\s*2/i, 'Vujahday Script'],
  [/jost/i, 'Italiana'],
  [/fredoka/i, 'Mochiy Pop One'],
  [/chakra\s*petch/i, 'Black Ops One'],
  [/saira/i, 'Share Tech Mono'],
];

const familyOf = (css: string) => css.match(/'([^']+)'/)?.[1] ?? css;

/** The shipped face a stored `Game.titleFont` resolves to, if any. */
function shippedFace(stored: string) {
  // Keyed on the family name alone, because the stored value carries its own
  // quoting and fallback stack.
  const family = RETIRED_FACES.find(([pattern]) => pattern.test(stored))?.[1] ?? familyOf(stored);
  return FONT_OPTIONS.find((option) => familyOf(option.css).toLowerCase() === family.toLowerCase());
}

/** Resolves a stored `Game.titleFont` to the face and setting this build ships for it. */
export function titleStyle(stored: string | undefined): CSSProperties {
  if (!stored) return DEFAULT_TITLE;
  const face = shippedFace(stored);
  return face ? { fontFamily: face.css, ...face.style } : { ...DEFAULT_TITLE, fontFamily: stored };
}

/** The title font picker's value for a stored face: a retired face shows as the face it is drawn in. */
export function titleFontOption(stored: string | undefined): string {
  if (!stored) return '';
  return shippedFace(stored)?.css ?? stored;
}
