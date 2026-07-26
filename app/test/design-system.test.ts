import { describe, expect, it } from 'vitest';
import {
  infinityLobePath,
  RING_PATH_LENGTH,
  ringPath,
  stadiumPath,
  sweepDasharray,
} from '../src/components/ring-geometry';
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

describe('infinityLobePath', () => {
  it('draws an open arc, not a closed circle', () => {
    const lobe = infinityLobePath(20, 12, 8.5, false);
    expect(lobe).toMatch(/^M[\d.-]+ [\d.-]+ A8\.5 8\.5/);
    expect(lobe).not.toContain('Z');
    expect(lobe).not.toMatch(/NaN|Infinity/);
  });

  it('mirrors the second lobe so the two gaps face the crossing point', () => {
    const left = infinityLobePath(14, 12, 8.5, false);
    const right = infinityLobePath(30, 12, 8.5, true);
    expect(left).not.toBe(right);
    // Opposite arc sweep flags are what make the lobes mirror rather than repeat.
    expect(left).toContain('A8.5 8.5 0 1 0');
    expect(right).toContain('A8.5 8.5 0 1 1');
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
