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
    const count = (prefix: string) => (CSS.match(new RegExp(`--color-${prefix}[\\w-]*:`, 'g')) ?? []).length;
    expect(count('fill-')).toBe(4);
    expect(count('scrim-')).toBe(3);
    // line-hairline, line-edge, line-strong, plus the violet card perimeter.
    expect(count('line')).toBe(4);
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

describe('depth is tonal, not cast', () => {
  it('exposes exactly one shadow token', () => {
    expect((CSS.match(/--shadow-[\w-]+:/g) ?? []).length).toBe(1);
    expect(CSS).toContain('--shadow-float:');
  });

  it('never uses a Tailwind shadow scale or an arbitrary shadow', () => {
    // The Shadows Float Only Rule. Anything that genuinely overlays the page
    // uses `shadow-float`; everything else casts nothing.
    expect(offenders(/\bshadow-(?:sm|md|lg|xl|2xl|inner|\[[^\]]+\])/g)).toEqual([]);
    expect(offenders(/\bdrop-shadow-\[[^\]]+\]/g)).toEqual([]);
  });

  it('only lets dialogs, popovers and the nav rail float', () => {
    const floating = FILES.filter(({ text }) => /\bshadow-float\b/.test(text)).map(({ path }) =>
      path.slice(SRC.length + 1).replace(/\\/g, '/'),
    );
    expect(new Set(floating)).toEqual(
      new Set(['App.tsx', 'components/NavRail.tsx', 'components/Sheet.tsx', 'components/ui.tsx']),
    );
  });

  it('never casts an outer shadow from an inline style', () => {
    // Zero-offset colored halos are decoration, and every card had one. An
    // inline boxShadow may only draw inset rings.
    const outer: string[] = [];
    for (const { path, text } of FILES) {
      for (const hit of text.matchAll(/boxShadow:\s*(`[^`]*`|'[^']*'|"[^"]*")/g)) {
        for (const layer of splitShadowLayers(hit[1].slice(1, -1))) {
          if (layer.trim() && !layer.includes('inset') && !layer.includes('${')) {
            outer.push(`${path.slice(SRC.length + 1).replace(/\\/g, '/')}  ${layer.trim()}`);
          }
        }
      }
    }
    expect(outer).toEqual([]);
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
