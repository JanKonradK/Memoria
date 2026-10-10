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
  { label: 'Cinzel — engraved serif capitals', css: "'Cinzel', serif", style: { fontWeight: 600 } },
  { label: 'Orbitron — geometric sci-fi', css: "'Orbitron', sans-serif", style: { fontWeight: 600 } },
  {
    label: 'Rajdhani — condensed capitals',
    css: "'Rajdhani', sans-serif",
    style: { fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.02em' },
  },
  {
    label: 'Vujahday Script — flowing script',
    css: "'Vujahday Script', 'DM Sans', sans-serif",
    // One weight and a low x-height: never emboldened, sized up to read at the
    // height of the text around it, with room for the slant where it truncates.
    style: { fontWeight: 400, fontSizeAdjust: 0.52, letterSpacing: 0, paddingInline: '0.08em 0.35em' },
  },
  { label: 'Space Grotesk — sharp contemporary', css: "'Space Grotesk', sans-serif", style: { fontWeight: 700 } },
  {
    label: 'Jost — light spaced capitals',
    css: "'Jost', sans-serif",
    style: { fontWeight: 300, textTransform: 'uppercase', letterSpacing: '0.14em' },
  },
  { label: 'Fredoka — soft heavy display', css: "'Fredoka', sans-serif", style: { fontWeight: 600 } },
  {
    label: 'Chakra Petch — techno capitals',
    css: "'Chakra Petch', sans-serif",
    style: { fontWeight: 500, textTransform: 'uppercase' },
  },
  {
    label: 'Saira — wide industrial capitals',
    css: "'Saira', sans-serif",
    style: { fontWeight: 700, textTransform: 'uppercase' },
  },
];

/** The shell face, used for any game that has not been given one. */
const DEFAULT_TITLE: CSSProperties = { fontFamily: "'DM Sans', system-ui, sans-serif", fontWeight: 600 };

/**
 * Faces this build no longer ships. A game stored under one of them still has
 * that string on it, and the browser would silently fall back to the system
 * face — so it is remapped to a surviving face at read time rather than left to
 * rot. Exo 2 was Wuthering Waves' face before its logo set the name in script.
 */
const RETIRED_FACES: Array<[RegExp, string]> = [
  [/marcellus/i, 'Cinzel'],
  [/michroma/i, 'Orbitron'],
  [/archivo\s*black|baloo/i, 'Space Grotesk'],
  [/exo\s*2/i, 'Vujahday Script'],
];

const familyOf = (css: string) => css.match(/'([^']+)'/)?.[1] ?? css;

/** Resolves a stored `Game.titleFont` to the face and setting this build ships for it. */
export function titleStyle(stored: string | undefined): CSSProperties {
  if (!stored) return DEFAULT_TITLE;
  // Keyed on the family name alone, because the stored value carries its own
  // quoting and fallback stack.
  const family = RETIRED_FACES.find(([pattern]) => pattern.test(stored))?.[1] ?? familyOf(stored);
  const face = FONT_OPTIONS.find((option) => familyOf(option.css).toLowerCase() === family.toLowerCase());
  return face ? { fontFamily: face.css, ...face.style } : { ...DEFAULT_TITLE, fontFamily: stored };
}
