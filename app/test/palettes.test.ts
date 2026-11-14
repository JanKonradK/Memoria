import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { contrast } from '../src/game-color';
import { accentChoices, FAMILIES, findPalette, paletteVars, PALETTE_PROPERTIES, surfacesOf } from '../src/palettes';
import { THEME_INSET, THEME_PANEL } from '../src/theme';
import { PAINT_STORAGE_KEY, THEME_GROUND, useUI } from '../src/ui-store';

const THEMES = ['dark', 'light'] as const;
/** Tokens that carry text. Each must clear AA on every surface it can sit on. */
const TEXT = [
  '--color-fg',
  '--color-fg-soft',
  '--color-muted',
  '--color-dim',
  '--color-ok',
  '--color-warn',
  '--color-danger',
  '--color-later',
  '--color-gold',
  '--color-rose',
  '--color-tag-event',
  '--color-tag-banner',
  '--color-tag-cycle',
  '--color-tag-patch',
  '--color-tag-maintenance',
  '--color-tag-daily',
  '--color-tag-weekly',
  '--color-accent-fg',
  '--nav-ink',
];

const every = FAMILIES.flatMap((family) =>
  family.flavours.flatMap((flavour) =>
    THEMES.flatMap((theme) => accentChoices(family).map((accent) => ({ family, flavour, theme, accent: accent.id }))),
  ),
);

describe('colour palettes', () => {
  it.each(every.filter(({ family }) => family.id !== 'memoria'))(
    '$flavour.name ($family.name) $theme with $accent reads at AA',
    ({ flavour, theme, accent }) => {
      const vars = paletteVars(flavour.id, theme, accent);
      const surfaces = ['--color-surface-0', '--color-surface-1', '--color-surface-2', '--color-inset'].map(
        (name) => vars[name]!,
      );
      for (const token of TEXT) {
        for (const surface of surfaces) {
          expect(contrast(vars[token]!, surface), `${token} on ${surface}`).toBeGreaterThanOrEqual(4.5);
        }
      }
      expect(contrast(vars['--color-danger-fg']!, vars['--color-danger-bg']!)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(vars['--color-warn-fg']!, vars['--color-warn-bg']!)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(vars['--color-on-accent']!, vars['--color-accent']!)).toBeGreaterThanOrEqual(4.5);
      for (const surface of surfaces.slice(0, 3)) {
        expect(contrast(vars['--color-accent']!, surface), `accent on ${surface}`).toBeGreaterThanOrEqual(3);
      }
    },
  );

  it.each(every.filter(({ family }) => family.id === 'memoria'))(
    'Memoria $theme with $accent sets only the accent, and it reads',
    ({ theme, accent }) => {
      const vars = paletteVars('memoria', theme, accent);
      expect(Object.keys(vars).every((name) => /accent|nav-ink|focus-ring/.test(name))).toBe(true);
      const { ground, panel, raised } = surfacesOf('memoria', theme);
      expect(contrast(vars['--color-on-accent']!, vars['--color-accent']!)).toBeGreaterThanOrEqual(4.5);
      for (const surface of [ground, panel, raised]) {
        expect(contrast(vars['--color-accent-fg']!, surface)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(vars['--color-accent']!, surface)).toBeGreaterThanOrEqual(3);
      }
    },
  );

  it("mirrors Memoria's own surfaces and default accent from index.css", () => {
    for (const theme of THEMES) {
      const surfaces = surfacesOf('memoria', theme);
      expect(surfaces.ground).toBe(THEME_GROUND[theme]);
      expect(surfaces.inset).toBe(THEME_INSET[theme]);
      expect(surfaces.panel).toBe(THEME_PANEL[theme][0]);
    }
    const css = readFileSync(join(import.meta.dirname, '..', 'src', 'index.css'), 'utf8');
    const declared = [...css.matchAll(/--color-accent:\s*(#[\da-f]{6})/gi)].map((match) => match[1]);
    const onAccent = [...css.matchAll(/--color-on-accent:\s*(#[\da-f]{6})/gi)].map((match) => match[1]);
    expect(onAccent).toEqual([
      paletteVars('memoria', 'dark', null)['--color-on-accent'],
      paletteVars('memoria', 'light', null)['--color-on-accent'],
    ]);
    expect(declared).toEqual([
      paletteVars('memoria', 'dark', null)['--color-accent'],
      paletteVars('memoria', 'light', null)['--color-accent'],
    ]);
  });

  it('falls back to Memoria and the family default for unknown ids', () => {
    expect(findPalette('vscode-default').family.id).toBe('memoria');
    expect(paletteVars('catppuccin-latte?', 'dark', 'nope')['--color-accent']).toBe(
      paletteVars('memoria', 'dark', 'blue')['--color-accent'],
    );
  });
});

describe('choosing a palette', () => {
  afterEach(() => {
    useUI.setState({ palette: 'memoria', accents: {} });
    document.documentElement.removeAttribute('style');
    localStorage.clear();
  });

  it('paints the root, remembers the accent per family, and clears on the way back', () => {
    const root = document.documentElement;
    useUI.getState().setPalette('kanagawa-wave');
    expect(root.style.getPropertyValue('--color-surface-0')).toBe(
      surfacesOf('kanagawa-wave', useUI.getState().theme).ground,
    );

    useUI.getState().setAccent('pink');
    expect(useUI.getState().accents).toEqual({ kanagawa: 'pink' });
    useUI.getState().setPalette('kanagawa-dragon');
    expect(root.style.getPropertyValue('--color-accent-fg')).toBe(
      paletteVars('kanagawa-dragon', useUI.getState().theme, 'pink')['--color-accent-fg'],
    );

    const paint = JSON.parse(localStorage.getItem(PAINT_STORAGE_KEY)!);
    expect(paint.light.ground).toBe(surfacesOf('kanagawa-dragon', 'light').ground);
    expect(paint.dark.vars['--color-surface-0']).toBe(surfacesOf('kanagawa-dragon', 'dark').ground);

    useUI.getState().setPalette('memoria');
    expect(root.style.getPropertyValue('--color-surface-0')).toBe('');
    expect(PALETTE_PROPERTIES).toContain('--color-surface-0');
  });

  it('keeps only known palettes and families from storage', () => {
    localStorage.setItem(
      'memoria-ui',
      JSON.stringify({
        state: { palette: 'solarized', accents: { gruvbox: 'aqua', vim: 'x', kanagawa: 3 } },
        version: 0,
      }),
    );
    useUI.persist.rehydrate();
    expect(useUI.getState().palette).toBe('memoria');
    expect(useUI.getState().accents).toEqual({ gruvbox: 'aqua' });
  });
});
