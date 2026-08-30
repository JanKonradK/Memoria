/**
 * Per-game display faces (@fontsource imports live in main.tsx).
 *
 * Open-licence approximations, never ripped proprietary game faces. The value is
 * a CSS font-family stored on `Game.titleFont` and editable per game, so a game
 * the presets have never heard of can still be given a face.
 *
 * A game's face appears on its name and nowhere else — see the One Display Face
 * Per Card Rule in DESIGN.md.
 */
export const FONT_OPTIONS: Array<{ label: string; css: string }> = [
  { label: 'Cinzel — fantasy serif', css: "'Cinzel', serif" },
  { label: 'Orbitron — geometric sci-fi', css: "'Orbitron', sans-serif" },
  { label: 'Rajdhani — condensed urban tech', css: "'Rajdhani', sans-serif" },
  { label: 'Exo 2 — wide modern sans', css: "'Exo 2', sans-serif" },
  { label: 'Space Grotesk — sharp contemporary', css: "'Space Grotesk', sans-serif" },
  { label: 'Jost — elegant geometric', css: "'Jost', sans-serif" },
  { label: 'Fredoka — soft heavy display', css: "'Fredoka', sans-serif" },
  { label: 'Chakra Petch — techno stencil', css: "'Chakra Petch', sans-serif" },
  { label: 'Saira — wide industrial', css: "'Saira', sans-serif" },
];

/** The shell face, used for any game that has not been given one. */
export const DEFAULT_TITLE_FONT = "'DM Sans', system-ui, sans-serif";

/**
 * Faces retired in the Memoria redesign. A game stored under one of them still
 * has that string on it, and the browser would silently fall back to the system
 * face — so it is remapped to the nearest surviving face at read time rather
 * than left to rot. Keyed on the family name alone, because the stored value
 * carries its own quoting and fallback stack.
 */
const RETIRED_FACES: Array<[RegExp, string]> = [
  [/marcellus/i, "'Cinzel', serif"],
  [/michroma/i, "'Orbitron', sans-serif"],
  [/archivo\s*black/i, "'Exo 2', sans-serif"],
  [/baloo/i, "'Space Grotesk', sans-serif"],
];

/** Resolves a stored `Game.titleFont` to a face this build actually ships. */
export function titleFont(stored: string | undefined): string {
  if (!stored) return DEFAULT_TITLE_FONT;
  for (const [pattern, replacement] of RETIRED_FACES) {
    if (pattern.test(stored)) return replacement;
  }
  return stored;
}
