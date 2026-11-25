import { describe, expect, it } from 'vitest';
import { RING_PATH_LENGTH, ringPath, stadiumPath, sweepDasharray } from '../src/components/ring-geometry';
import {
  MARK_BODY_PATH,
  MARK_CROSS_SHADOW_PATH,
  MARK_HEIGHT,
  MARK_OVER_PATH,
  MARK_PATH,
  MARK_SHARDS,
  MARK_UNDER_PATH,
  MARK_WIDTH,
} from '../src/components/mark-path';
import { bandBounds, MARK, markParts, outlinePolygon } from '../scripts/mobius.mjs';
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

describe('the infinity mark', () => {
  type Point = { x: number; y: number };
  const parts = markParts();
  const { body, overStrand, underStrand, crossShadow, shards } = parts;
  const drawn = (points: Point[]): Point[] => outlinePolygon(points, 12);
  const bodyPolygon = drawn(body.points);

  const area = (polygon: Point[]) =>
    Math.abs(
      polygon.reduce((sum, p, i) => {
        const q = polygon[(i + 1) % polygon.length];
        return sum + p.x * q.y - q.x * p.y;
      }, 0),
    ) / 2;
  const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const segmentsCross = (a: Point, b: Point, c: Point, d: Point) =>
    cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0;
  const pointToSegment = (p: Point, a: Point, b: Point) => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
  };
  const inside = (p: Point, polygon: Point[]) => {
    let hit = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const a = polygon[i];
      const b = polygon[j];
      if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
    }
    return hit;
  };
  /** Closest approach of two drawn outlines; 0 if they touch, cross or nest. */
  const distance = (p: Point[], q: Point[]) => {
    if (inside(p[0], q) || inside(q[0], p)) return 0;
    let best = Infinity;
    for (let i = 0; i < p.length; i++) {
      const a = p[i];
      const b = p[(i + 1) % p.length];
      for (let j = 0; j < q.length; j++) {
        const c = q[j];
        const d = q[(j + 1) % q.length];
        if (segmentsCross(a, b, c, d)) return 0;
        best = Math.min(best, pointToSegment(a, c, d), pointToSegment(c, a, b));
      }
    }
    return best;
  };
  const isSimple = (polygon: Point[]) => {
    const n = polygon.length;
    for (let i = 0; i < n; i++) {
      for (let j = i + 2; j < n; j++) {
        if (i === 0 && j === n - 1) continue; // the closing edge shares a vertex with the first
        if (segmentsCross(polygon[i], polygon[(i + 1) % n], polygon[j], polygon[(j + 1) % n])) return false;
      }
    }
    return true;
  };

  it('is a classic wide infinity, not a tall loop', () => {
    const bounds = bandBounds();
    expect(bounds.width / bounds.height).toBeGreaterThan(1.45);
    expect(bounds.width / bounds.height).toBeLessThan(2.05);
    expect(MARK_WIDTH / MARK_HEIGHT).toBeGreaterThan(1.55);
    expect(MARK_WIDTH / MARK_HEIGHT).toBeLessThan(1.95);
    // Two lobes reaching out sideways: the standing body is far wider than tall.
    expect(body.bounds.width / body.bounds.height).toBeGreaterThan(2);
  });

  it('stands its upper arches as an M: two peaks, outer legs, a deep valley over the crossing', () => {
    const top = (points: Point[]) => points.reduce((a, b) => (b.y > a.y ? b : a));
    expect(top(body.points.filter((p: Point) => p.x < 0)).x).toBeCloseTo(-MARK.peak.x, 1);
    expect(top(body.points.filter((p: Point) => p.x > 0)).x).toBeCloseTo(MARK.peak.x, 1);
    expect(MARK.valley.y).toBeGreaterThan(0);
    expect(MARK.valley.y).toBeLessThan(MARK.peak.y - 0.35);
    // The outer legs run on below the lobes' widest point before they break.
    expect(MARK.legY).toBeLessThan(-0.15);
    expect(body.bounds.minX).toBeCloseTo(-body.bounds.maxX, 6);
  });

  it('carries both ribbons past the centre of the × before they break', () => {
    const { top, bottom, left, right } = MARK.crossing;
    expect(top.y).toBeGreaterThan(0);
    expect(bottom.y).toBeLessThan(0);
    expect(left.x).toBeLessThan(0);
    expect(right.x).toBeGreaterThan(0);
    expect(MARK.stubY).toBeLessThan(-0.15);
    // The over ribbon runs from the left arch down into the lower right…
    const overStub = overStrand.points.filter((p: Point) => p.x > 0 && p.x < 0.6).map((p: Point) => p.y);
    expect(Math.min(...overStub)).toBeLessThan(-0.15);
    expect(overStrand.bounds.minX).toBeLessThan(-1);
    // …and the under ribbon is its mirror, from the right arch into the lower left.
    const underStub = underStrand.points.filter((p: Point) => p.x < 0 && p.x > -0.6).map((p: Point) => p.y);
    expect(Math.min(...underStub)).toBeLessThan(-0.15);
    expect(underStrand.bounds.maxX).toBeGreaterThan(1);
    // The shadow sits on the crossing itself.
    expect(crossShadow.bounds.minX).toBeLessThan(0);
    expect(crossShadow.bounds.maxX).toBeGreaterThan(0);
    expect(crossShadow.bounds.width).toBeLessThan(0.6);
  });

  it('shatters the lower bowls into four tiers of shards, balanced left and right', () => {
    expect(shards.length).toBeGreaterThanOrEqual(14);
    expect(shards.length).toBeLessThanOrEqual(22);
    expect(new Set(shards.map((s) => s.tier))).toEqual(new Set([1, 2, 3, 4]));
    expect(shards.filter((s) => s.side === -1)).toHaveLength(shards.length / 2);
    for (const shard of shards) {
      expect(shard.bounds.maxY).toBeLessThan(0);
      expect(Math.sign(shard.bounds.minX + shard.bounds.maxX)).toBe(shard.side);
    }
  });

  it('shrinks the shards tier by tier as they drift further away', () => {
    const meanArea = (tier: number) => {
      const pieces = shards.filter((s) => s.tier === tier);
      return pieces.reduce((sum, s) => sum + area(drawn(s.points)), 0) / pieces.length;
    };
    expect(meanArea(1)).toBeGreaterThan(meanArea(2));
    expect(meanArea(2)).toBeGreaterThan(meanArea(3));
    expect(meanArea(3)).toBeGreaterThan(meanArea(4));
  });

  it('keeps every piece apart: no shard touches the body or another shard', () => {
    const polygons = shards.map((s) => drawn(s.points));
    for (const [i, polygon] of polygons.entries()) {
      expect(distance(polygon, bodyPolygon)).toBeGreaterThan(0.02);
      for (const other of polygons.slice(i + 1)) expect(distance(polygon, other)).toBeGreaterThan(0.02);
    }
  });

  it('draws every outline without self-intersections', () => {
    expect(isSimple(bodyPolygon)).toBe(true);
    expect(isSimple(drawn(overStrand.points))).toBe(true);
    expect(isSimple(drawn(underStrand.points))).toBe(true);
    for (const shard of shards) expect(isSimple(drawn(shard.points))).toBe(true);
  });

  it('exports every layer, fitted to one box', () => {
    const layers = [
      MARK_BODY_PATH,
      MARK_OVER_PATH,
      MARK_UNDER_PATH,
      MARK_CROSS_SHADOW_PATH,
      ...MARK_SHARDS.map((s) => s.d),
    ];
    for (const d of layers) {
      expect(d).toMatch(/^M[^M]+Z$/); // exactly one closed subpath
      expect(d).not.toMatch(/NaN|Infinity/);
    }
    expect(MARK_SHARDS).toHaveLength(shards.length);
    expect(MARK_SHARDS.map((s) => [s.tier, s.side])).toEqual(shards.map((s) => [s.tier, s.side]));
    // The flat silhouette is the body plus every shard, nothing else.
    expect(MARK_PATH).toBe([MARK_BODY_PATH, ...MARK_SHARDS.map((s) => s.d)].join(' '));
  });

  it('generates one path of closed subpaths that stays inside its box', () => {
    expect(MARK_PATH.startsWith('M')).toBe(true);
    expect(MARK_PATH.endsWith('Z')).toBe(true);
    expect(MARK_PATH.match(/M/g)!.length).toBe(1 + shards.length);
    expect(MARK_PATH.match(/M/g)!.length).toBe(MARK_PATH.match(/Z/g)!.length);
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
