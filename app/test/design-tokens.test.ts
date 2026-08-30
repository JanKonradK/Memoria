import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The ladders in DESIGN.md are closed. They only stay closed if something
 * checks — the raw values these tests ban are exactly the ones that had
 * accumulated (31 distinct surface alphas, 44 distinct palette classes, six
 * type scales running alongside the semantic one) before the system was
 * extracted. Each failure message names the token to reach for instead.
 */

const SRC = join(import.meta.dirname, '..', 'src');
const CSS = readFileSync(join(SRC, 'index.css'), 'utf8');

function sourceFiles(): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = [];
  (function walk(dir: string) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry)) out.push({ path: full, text: readFileSync(full, 'utf8') });
    }
  })(SRC);
  return out;
}

const FILES = sourceFiles();

/** Every match of `pattern`, as `relative/path.tsx:12  offending-text` lines. */
function offenders(pattern: RegExp): string[] {
  const found: string[] = [];
  for (const { path, text } of FILES) {
    text.split('\n').forEach((line, index) => {
      for (const hit of line.matchAll(pattern)) {
        found.push(`${path.slice(SRC.length + 1).replace(/\\/g, '/')}:${index + 1}  ${hit[0]}`);
      }
    });
  }
  return found;
}

/**
 * Split a `box-shadow` value into its layers. A naive comma split breaks on
 * `rgba(…)` and `color-mix(in oklab, …)` argument lists, so track paren depth.
 */
function splitShadowLayers(value: string): string[] {
  const layers: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of value) {
    if (char === '(') depth++;
    else if (char === ')') depth--;
    if (char === ',' && depth === 0) {
      layers.push(current);
      current = '';
    } else current += char;
  }
  layers.push(current);
  return layers.map((layer) => layer.trim()).filter(Boolean);
}

const TAILWIND_PALETTE =
  'slate|zinc|gray|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose';

describe('the colour palette is closed', () => {
  it('never names a raw Tailwind palette colour', () => {
    // The Shelf Is Grey Rule: if a pixel is saturated it is a game's identity,
    // an interactive affordance, or a warning — so it comes from a token.
    expect(
      offenders(
        new RegExp(
          `\\b(?:text|bg|ring|border|from|to|via|fill|stroke|shadow|divide|outline|decoration|accent)-(?:${TAILWIND_PALETTE})-\\d{2,3}(?:\\/(?:\\[[\\d.]+\\]|\\d+))?`,
          'g',
        ),
      ),
    ).toEqual([]);
  });

  it('never hand-rolls a white or black alpha', () => {
    // Four fills, three border steps, three scrims. Nothing in between.
    //
    // The single exemption is Google's sign-in button, whose white face and
    // black hairline are dictated by Google's brand guidelines rather than by
    // this system — the same category as the Möbius mark's own gold ramp.
    // Matched on file and value, never on a line number: prettier reflows.
    const GOOGLE_BUTTON = /^auth\.tsx:\d+ {2}ring-black\/10$/;
    expect(
      offenders(/\b(?:bg|ring|border|from|to|via|divide|outline)-(?:white|black)\/(?:\[[\d.]+\]|\d+)/g).filter(
        (hit) => !GOOGLE_BUTTON.test(hit),
      ),
    ).toEqual([]);
  });

  it('never paints text in the decorative-stroke colour', () => {
    // index.css declares --color-faint "Decorative strokes only — never text",
    // but a comment is not enforcement: it had drifted into 8 text sites at
    // 2.47:1 on bg-fill-1, two of them interactive button labels.
    //
    // These all resolved to `muted` (7.29:1), NOT `dim`. `dim` is tuned to clear
    // AA on the pure-black canvas; over bg-fill-1 on a card it measures 4.47:1
    // and misses the 4.5 gate. There is no step between them — the ramp is
    // closed — so anything sitting on a fill needs `muted` or brighter.
    expect(offenders(/\btext-faint\b/g)).toEqual([]);
  });

  it('never puts dim text on a lightened fill', () => {
    // `dim` is tuned to clear AA 4.5:1 on the pure-black canvas. Every overlay
    // step raises the background and eats that margin: measured against a card,
    // dim is 4.47 on fill-1, 4.18 on fill-2 and 3.74 on fill-3 — so an input
    // placeholder failed at rest and got WORSE on focus. `muted` clears all
    // three (6.1–7.3). There is no step in between; the ramp is closed.
    expect(offenders(/(?:bg-fill-\d[^"'`]*text-dim|text-dim[^"'`]*bg-fill-\d)/g)).toEqual([]);
  });

  it('defines exactly four overlay steps, three border steps and three scrims', () => {
    // DISTINCT names, not raw occurrences: the light theme re-points every one of
    // these under :root[data-theme='light'], so counting matches would report each
    // ladder at double its real length and the check would pass for the wrong
    // reason. What is closed is the set of STEPS, not the number of declarations.
    const names = (prefix: string) =>
      new Set([...CSS.matchAll(new RegExp(`--color-(${prefix}[\\w-]*):`, 'g'))].map((match) => match[1]));
    expect(names('fill-').size).toBe(4);
    expect(names('scrim-').size).toBe(3);
    // line-hairline, line, line-edge, line-strong.
    expect(names('line').size).toBe(4);
  });
});

describe('the ground is written once', () => {
  it('keeps every copy of the page ground in agreement', () => {
    // A game colour is legible or not *against something*, and that something is
    // a hex the JS side cannot read out of CSS at the point it needs it — mix()
    // takes a colour, not a var(). So the ground is mirrored, and a mirror that
    // nothing checks drifts: two components and the store each carried their own
    // copy, and the pre-paint script in index.html carries two more that cannot
    // import anything at all. This is the check that keeps them one value.
    const HTML = readFileSync(join(SRC, '..', 'index.html'), 'utf8');
    const UI_STORE = readFileSync(join(SRC, 'ui-store.ts'), 'utf8');
    const THEME = readFileSync(join(SRC, 'theme.ts'), 'utf8');

    // --color-surface-0 is declared once in @theme (dark) and once under
    // :root[data-theme='light'], in that order.
    const [dark, light] = [...CSS.matchAll(/--color-surface-0:\s*(#[\da-f]{6})/gi)].map((match) =>
      match[1]!.toLowerCase(),
    );
    expect(dark, '--color-surface-0 missing from index.css').toBeDefined();
    expect(light, 'the light theme never re-points --color-surface-0').toBeDefined();

    // `[^=\n]*` and not `[^=]*`: a declaration is one line, and a looser gap
    // walks straight past a re-export into whatever is declared next.
    const jsMap = (source: string, name: string) => {
      const literal = source.match(new RegExp(`${name}[^=\\n]*=\\s*\\{([^}]*)\\}`))?.[1];
      if (literal === undefined) return null; // re-exported, not redeclared here
      const hexes = (theme: string) =>
        [...literal.matchAll(new RegExp(`${theme}:[^\\]\\n]*?((?:'#[\\da-f]{6}',?\\s*)+)`, 'gi'))]
          .flatMap((match) => [...match[1]!.matchAll(/#[\da-f]{6}/gi)])
          .map((hex) => hex[0]!.toLowerCase());
      return { dark: hexes('dark'), light: hexes('light') };
    };

    expect(jsMap(UI_STORE, 'THEME_GROUND'), 'THEME_GROUND missing from ui-store.ts').toEqual({
      dark: [dark],
      light: [light],
    });
    // theme.ts re-exports the ground rather than redeclaring it; if that ever
    // changes, the copy is checked like any other.
    expect(jsMap(THEME, 'THEME_GROUND') ?? { dark: [dark], light: [light] }).toEqual({ dark: [dark], light: [light] });

    // The same argument applies to every other surface mirrored into JS.
    const cssVar = (name: string) =>
      [...CSS.matchAll(new RegExp(`${name}:\\s*(#[\\da-f]{6})`, 'gi'))].map((match) => match[1]!.toLowerCase());
    const [insetDark, insetLight] = cssVar('--color-inset');
    expect(jsMap(THEME, 'THEME_INSET'), 'THEME_INSET missing from theme.ts').toEqual({
      dark: [insetDark],
      light: [insetLight],
    });
    // Each var is declared dark-first, so the two lists interleave by theme.
    const [panelHiDark, panelHiLight] = cssVar('--panel-hi');
    const [panelLoDark, panelLoLight] = cssVar('--panel-lo');
    expect(jsMap(THEME, 'THEME_PANEL'), 'THEME_PANEL missing from theme.ts').toEqual({
      dark: [panelHiDark, panelLoDark],
      light: [panelHiLight, panelLoLight],
    });

    // index.html hard-codes both: the dark meta tag it ships with, and the light
    // value the pre-paint script swaps in. It cannot import, so it is checked.
    expect(HTML.match(/<meta name="theme-color" content="(#[\da-f]{6})"/i)?.[1]?.toLowerCase()).toBe(dark);
    expect(HTML).toContain(`'${light}'`);
  });
});

describe('the type scale is closed', () => {
  it('never uses a Tailwind font size outside the semantic scale', () => {
    expect(offenders(/\btext-(?:xs|sm|base|lg|xl|[2-9]xl|\[[^\]]*rem\])\b/g)).toEqual([]);
  });

  it('never sets an SVG font-size below the floor', () => {
    // Tailwind classes are only half the surface: SVG `<text fontSize="7">`
    // bypasses the scale entirely, and that is exactly how the Nexus game
    // shorts — the label you scan a rail by — ended up rendering at 7px.
    //
    // These are user units, equal to pixels only when the viewBox scale is 1:1,
    // which it is for every SVG in this app. Revisit if that stops being true.
    const tooSmall = offenders(/fontSize="(\d+(?:\.\d+)?)"/g).filter(
      (hit) => Number(hit.match(/fontSize="([\d.]+)"/)![1]) < 10,
    );
    expect(tooSmall).toEqual([]);
  });

  it('renders nothing below the ten-pixel floor', () => {
    // The retired 0.5rem `micro` step: 8px uppercase on black is not readable.
    expect(CSS).not.toContain('--text-micro');
    expect(offenders(/\btext-micro\b/g)).toEqual([]);
    const smallest = Math.min(...[...CSS.matchAll(/--text-[\w-]+:\s*([\d.]+)rem/g)].map((match) => Number(match[1])));
    expect(smallest).toBeGreaterThanOrEqual(0.625);
  });
});

describe('the radius scale is closed', () => {
  it('never uses a Tailwind radius outside the semantic scale', () => {
    // Six steps, and every corner in the product names one of them. The lookahead
    // is what lets `rounded-ui-card` and `rounded-t-ui-card` through: a token
    // always has more path after `rounded`, so only a class that ENDS at a bare
    // Tailwind size — or opens an arbitrary bracket — is an offender.
    //
    // The side list carries the logical sides (s, e, ss, se, es, ee) as well as
    // the physical ones, and `none` sits in the size list, because a guard that
    // misses `rounded-none` or `rounded-s-lg` is a guard someone walks past.
    expect(
      offenders(
        /\brounded(?:-(?:t|r|b|l|tl|tr|br|bl|x|y|s|e|ss|se|es|ee))?(?:-(?:none|sm|md|lg|xl|2xl|3xl|full)|-\[[^\]]+\])?(?=$|[\s"'`])/g,
      ),
    ).toEqual([]);
  });
});

describe('depth is tonal, not cast', () => {
  it('exposes exactly one shadow token', () => {
    // Distinct names, for the same reason as the ladders above: the light theme
    // declares its own --shadow-float, which is a re-point, not a second token.
    expect(new Set([...CSS.matchAll(/--shadow-([\w-]+):/g)].map((match) => match[1])).size).toBe(1);
    expect(CSS).toContain('--shadow-float:');
  });

  it('never uses a Tailwind shadow scale or an arbitrary shadow', () => {
    // The Shadows Float Only Rule. Anything that genuinely overlays the page
    // uses `shadow-float`; everything else casts nothing.
    expect(offenders(/\bshadow-(?:sm|md|lg|xl|2xl|inner|\[[^\]]+\])/g)).toEqual([]);
    expect(offenders(/\bdrop-shadow-\[[^\]]+\]/g)).toEqual([]);
  });

  it('only lets dialogs and popovers float', () => {
    // The floating nav rail was retired with the redesign — chrome lives in the
    // app bar at the top edge now, and a sticky bar is part of the page rather
    // than something overlaying it. Nothing else may cast.
    //
    // The list is an ALLOWANCE, not an inventory: it is checked for extras, not
    // for exact equality, so a file that has not been written yet can be
    // sanctioned ahead of the code. What matters is that nothing casts without
    // appearing here — an omission from the list is the failure, not an
    // unused entry in it.
    const MAY_FLOAT = new Set([
      'App.tsx',
      'components/Sheet.tsx',
      'components/ui.tsx',
      // The add menu: a dropdown genuinely overlays the page.
      'components/AddMenu.tsx',
    ]);
    const floating = FILES.filter(({ text }) => /\bshadow-float\b/.test(text)).map(({ path }) =>
      path.slice(SRC.length + 1).replace(/\\/g, '/'),
    );
    expect(floating.filter((file) => !MAY_FLOAT.has(file))).toEqual([]);
  });

  it('never blurs a glow out of an inline style', () => {
    // The ban was never on outer shadows as such — it was on the zero-offset
    // coloured halo every card used to wear, which is decoration pretending to be
    // depth. Three shapes, and only the last is banned:
    //
    //   0 10px 24px -12px rgba(0,0,0,.75)  cast shadow — an object above a ground
    //   0 0 0 1px var(--color-danger)      ring — spread with no blur, an outline
    //   0 0 12px <colour>                  halo — blur with nowhere to fall from
    //
    // A cast shadow must also stay NEUTRAL: tinting it with a game colour reads
    // as spill light and makes every card look like it is glowing.
    const offenders: string[] = [];
    for (const { path, text } of FILES) {
      const where = path.slice(SRC.length + 1).replace(/\\/g, '/');
      for (const hit of text.matchAll(/boxShadow:\s*(`[^`]*`|'[^']*'|"[^"]*")/g)) {
        for (const layer of splitShadowLayers(hit[1].slice(1, -1))) {
          const value = layer.trim();
          if (!value || value.includes('inset')) continue;
          const [x, y, blur] = value.match(/-?[\d.]+px/g) ?? [];
          const blurred = blur !== undefined && blur !== '0px';
          if (!blurred) continue; // a ring, not a shadow
          if (x === '0px' && y === '0px') offenders.push(`${where}  halo: ${value}`);
          // Interpolation and colour tokens are how a game colour gets in.
          if (/\$\{|var\(--color-/.test(value)) offenders.push(`${where}  tinted: ${value}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('motion runs on the shared ladder', () => {
  it('never hard-codes a Tailwind duration', () => {
    expect(offenders(/\bduration-\d+\b/g)).toEqual([]);
  });

  it('keeps motion.ts in step with the CSS custom properties', () => {
    // motion.ts mirrors these by hand for the Motion library, which cannot read
    // CSS variables. If they drift, CSS transitions and JS animations disagree.
    const motion = readFileSync(join(SRC, 'motion.ts'), 'utf8');
    for (const [token, seconds] of [
      ['fast', 0.14],
      ['base', 0.26],
      ['slow', 0.42],
    ] as const) {
      const css = CSS.match(new RegExp(`--dur-${token}:\\s*(\\d+)ms`));
      expect(css, `--dur-${token} missing from index.css`).not.toBeNull();
      expect(Number(css![1]) / 1000).toBeCloseTo(seconds, 5);
      expect(motion).toContain(`${token}: ${seconds}`);
    }
  });
});
