import type { Game } from '@technogg/shared';
import { PRESETS } from '@technogg/shared';

/**
 * Title fonts bundled with the app (@fontsource imports live in main.tsx).
 * Each game carries its own personality — the value is a CSS font-family
 * stored on Game.titleFont and editable per game in the game editor.
 */
export const FONT_OPTIONS: Array<{ label: string; css: string; titleScale: number }> = [
  { label: 'Marcellus — fantasy serif', css: "'Marcellus', serif", titleScale: 1 },
  { label: 'Rajdhani — sci-fi condensed', css: "'Rajdhani', sans-serif", titleScale: 1.05 },
  { label: 'Archivo Black — heavy urban', css: "'Archivo Black', sans-serif", titleScale: 0.82 },
  { label: 'Michroma — wide tech', css: "'Michroma', sans-serif", titleScale: 0.78 },
  { label: 'Baloo 2 — playful rounded', css: "'Baloo 2', sans-serif", titleScale: 0.95 },
];

/** Optical size correction for display fonts with very different metrics. */
export function titleFontScale(css: string | undefined): number {
  return FONT_OPTIONS.find((font) => font.css === css)?.titleScale ?? 1;
}

/**
 * Effective title font for display. Games saved before the titleFont field
 * existed have no stored value — fall back to the matching preset's font by
 * name/short so long-lived data still gets its personality. Display-time only:
 * writing it back would bump updatedAt on every game and churn sync.
 */
export function titleFontFor(game: Pick<Game, 'titleFont' | 'name' | 'short'>): string | undefined {
  if (game.titleFont) return game.titleFont;
  const preset = PRESETS.find((p) => p.name === game.name || p.short.toLowerCase() === game.short.toLowerCase());
  return preset?.titleFont;
}
