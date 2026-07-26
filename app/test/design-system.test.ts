import { describe, expect, it } from 'vitest';
import { RING_PATH_LENGTH, ringPath, stadiumPath, sweepDasharray } from '../src/components/ring-geometry';
import { MARK_HEIGHT, MARK_PATH, MARK_WIDTH } from '../src/components/mark-path';
import { bandBounds, bandSamples, MARK } from '../scripts/mobius.mjs';
import { luminance } from '../src/util';

describe('stadiumPath', () => {
  it('is a pure circle when width equals height', () => {
    const circle = ringPath(40);
    expect(circle).toBe(stadiumPath(40, 40));
    // A circle has no straight run: both arc endpoints share the same x.
    expect(circle).toContain('M20 0');
    expect(circle).toContain('L20 0');
  });

  it('stretches only the flat edges, keeping the caps circular', () => {
    const height = 24;
    const wide = stadiumPath(90, height);
    // Caps stay at radius height/2 regardless of how far the middle stretches.
    expect(wide).toContain(`A12 12 0 0 1`);
    expect(wide).toContain('M12 0');
    expect(wide).toContain('L78 0');
  });

  it('never lets the width collapse below the cap diameter', () => {
    // A "width" narrower than the height would invert the straight run and
    // produce a self-crossing outline.
    const squashed = stadiumPath(4, 40);
    expect(squashed).toBe(stadiumPath(40, 40));
    expect(squashed).not.toMatch(/NaN|Infinity|-\d/);
  });

  it('returns empty for degenerate sizes rather than NaN geometry', () => {
    expect(stadiumPath(0, 10)).toBe('');
    expect(stadiumPath(10, 0)).toBe('');
    expect(stadiumPath(Number.NaN, 10)).toBe('');
  });
});

describe('sweepDasharray', () => {
  it('maps a 0..1 sweep onto the normalised path length', () => {
    expect(sweepDasharray(0)).toBe(`0 ${RING_PATH_LENGTH}`);
    expect(sweepDasharray(0.5)).toBe(`50 ${RING_PATH_LENGTH}`);
    expect(sweepDasharray(1)).toBe(`${RING_PATH_LENGTH} ${RING_PATH_LENGTH}`);
  });

  it('clamps out-of-range and non-finite input', () => {
    expect(sweepDasharray(-3)).toBe(`0 ${RING_PATH_LENGTH}`);
    expect(sweepDasharray(9)).toBe(`${RING_PATH_LENGTH} ${RING_PATH_LENGTH}`);
    expect(sweepDasharray(Number.NaN)).toBe(`0 ${RING_PATH_LENGTH}`);
  });

  it('leaves a visible gap for any sweep below 1', () => {
    // The gap IS the design language, so a partial sweep must never render closed.
    const [drawn] = sweepDasharray(0.999).split(' ');
    expect(Number(drawn)).toBeLessThan(RING_PATH_LENGTH);
  });
});

describe('the Möbius mark', () => {
  const { band } = bandSamples();
  const first = band[0];
  const last = band[band.length - 1];

  it('never closes: the band stops and restarts at the crossing', () => {
    // The whole point of the mark. A gap narrower than the band itself would
    // read as a rendering seam rather than as a beginning and an end.
    const separation = Math.hypot(last.x - first.x, last.y - first.y);
    expect(separation).toBeGreaterThan(first.w + last.w);
    // Both loose ends belong to the same self-crossing, which sits at the origin.
    expect(Math.hypot(first.x, first.y)).toBeLessThan(MARK.gapArc);
    expect(Math.hypot(last.x, last.y)).toBeLessThan(MARK.gapArc);
  });

  it('turns edge-on exactly once, which is what makes it a Möbius band', () => {
    // Two pinches would be a full twist (a plain ring); none would be flat.
    const pinched = band.map((s) => s.w < MARK.halfWidth * (MARK.pinch + 0.08));
    const runs = pinched.reduce((count, on, i) => count + (on && !pinched[i - 1] ? 1 : 0), 0);
    expect(runs).toBe(1);
    expect(Math.min(...band.map((s) => s.w))).toBeCloseTo(MARK.halfWidth * MARK.pinch, 3);
  });

  it('keeps the infinity proportions: twice as wide as it is tall', () => {
    const bounds = bandBounds();
    expect(bounds.width / bounds.height).toBeGreaterThan(1.5);
    expect(bounds.width / bounds.height).toBeLessThan(2.1);
  });

  it('generates one closed outline that stays inside its box', () => {
    expect(MARK_PATH.startsWith('M')).toBe(true);
    expect(MARK_PATH.endsWith('Z')).toBe(true);
    expect(MARK_PATH.match(/M/g)).toHaveLength(1); // a single subpath, no stray islands
    expect(MARK_PATH).not.toMatch(/NaN|Infinity/);
    const numbers = MARK_PATH.match(/-?\d+(\.\d+)?/g)!.map(Number);
    const xs = numbers.filter((_, i) => i % 2 === 0);
    const ys = numbers.filter((_, i) => i % 2 === 1);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs)).toBeLessThanOrEqual(MARK_WIDTH);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...ys)).toBeLessThanOrEqual(MARK_HEIGHT);
  });
});

describe('luminance', () => {
  it('uses normalized WCAG channel weights', () => {
    expect(luminance('#ffffff')).toBeCloseTo(1);
    expect(luminance('#000000')).toBe(0);
  });

  it('returns null for values it cannot parse', () => {
    expect(luminance('not-a-color')).toBeNull();
  });
});
