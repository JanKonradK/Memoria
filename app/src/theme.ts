/**
 * What a game colour is being painted *against*.
 *
 * Every helper in game-color.ts takes a `ground` because legibility is a
 * relationship, not a property: `#d3dae0` is jewelry on black and invisible on
 * cream. Before this module the ground hex was written out by hand in four
 * places — two components, the store and the pre-paint script — and the two
 * components had already drifted from the CSS they were mirroring.
 *
 * These are the JS mirror of index.css. They cannot be read from CSS at the
 * point most callers need them (a `mix()` needs a hex, not a `var()`), so
 * design-tokens.test.ts asserts the mirror against the stylesheet instead.
 */

import type { CSSProperties } from 'react';

import { gameTitleInk, gameWash, mix, trioOf, type GameColors } from './game-color';
import { THEME_GROUND, useUI, type Theme } from './ui-store';

export { THEME_GROUND };
export type { Theme };

/** Must match --color-inset for each theme in index.css. */
export const THEME_INSET: Record<Theme, string> = { dark: '#101114', light: '#edeef2' };

/** The two stops of .card-shell's default gradient: --panel-hi, --panel-lo. */
export const THEME_PANEL: Record<Theme, [string, string]> = {
  dark: ['#151619', '#151619'],
  light: ['#ffffff', '#ffffff'],
};

/** The theme itself, for the few callers that need more than a ground. */
export function useTheme(): Theme {
  return useUI((store) => store.theme);
}

/** The page ground under the current theme. The argument every trio helper wants. */
export function useGround(): string {
  return THEME_GROUND[useUI((store) => store.theme)];
}

/** The inset well under the current theme — timeline bars mix down into this. */
export function useInset(): string {
  return THEME_INSET[useUI((store) => store.theme)];
}

/** One identity palette for the glass, its reflected light, and readable ink. */
export function gameShellVars(game: GameColors, theme: Theme, resolvedIdentity: GameColors = game): CSSProperties {
  const [hi, lo] = gameWash(resolvedIdentity, THEME_PANEL[theme], theme);
  const { primary, secondary, accent } = trioOf(resolvedIdentity);
  const inkGround = theme === 'dark' ? mix(THEME_PANEL.light[0], mix(secondary, hi, 0.18), 0.05) : hi;
  return {
    '--card-shell-hi': hi,
    '--card-shell-lo': lo,
    '--game-primary': primary,
    '--game-secondary': secondary,
    '--game-accent': accent,
    '--game-ink': gameTitleInk(resolvedIdentity, inkGround, 4.5),
  } as CSSProperties;
}
