import { describe, expect, it } from 'vitest';
import { CLUSTER_DOT_CAP, clusterCoreGeometry, clusterDotLayout } from '../src/components/nexus/cluster-geometry';

describe('clusterCoreGeometry', () => {
  it.each([
    [0, 6, 0.38],
    [0.5, 9, 0.69],
    [1, 12, 1],
  ])('maps fraction %s to a radius of %s and opacity of %s', (fraction, radius, opacity) => {
    expect(clusterCoreGeometry(fraction)).toMatchObject({ radius, opacity });
  });

  it('dims a paused or unknown core without discarding its static energy size', () => {
    const active = clusterCoreGeometry(0.5);
    const still = clusterCoreGeometry(0.5, false);

    expect(still.radius).toBe(active.radius);
    expect(still.opacity).toBeLessThan(active.opacity);
  });
});

describe('clusterDotLayout', () => {
  it('renders no points when there are no open dailies', () => {
    expect(clusterDotLayout(0, 'game')).toEqual({ dots: [], overflow: 0 });
  });

  it('caps points and reports the remaining open dailies', () => {
    const layout = clusterDotLayout(CLUSTER_DOT_CAP + 4, 'game');

    expect(layout.dots).toHaveLength(CLUSTER_DOT_CAP);
    expect(layout.overflow).toBe(4);
  });

  it('places points deterministically for a stable game id', () => {
    expect(clusterDotLayout(5, 'stable-game')).toEqual(clusterDotLayout(5, 'stable-game'));
    expect(clusterDotLayout(5, 'stable-game')).not.toEqual(clusterDotLayout(5, 'another-game'));
  });

  it('produces finite geometry for degenerate input', () => {
    const core = clusterCoreGeometry(Number.NaN);
    const emptyLayout = clusterDotLayout(Number.POSITIVE_INFINITY, 'game', Number.NaN);
    const dotLayout = clusterDotLayout(3, '');

    expect(Object.values(core).every(Number.isFinite)).toBe(true);
    expect(emptyLayout).toEqual({ dots: [], overflow: 0 });
    expect(dotLayout.dots.every((dot) => Object.values(dot).every(Number.isFinite))).toBe(true);
  });
});
