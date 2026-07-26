import { describe, expect, it } from 'vitest';
import { conduitPath, type ConduitBounds } from '../src/components/nexus/conduit-geometry';

const stage: ConduitBounds = { left: 100, right: 1_100, top: 50, bottom: 850 };
const hub: ConduitBounds = { left: 500, right: 700, top: 200, bottom: 700 };

describe('conduitPath', () => {
  it('connects a left node edge to the hub and clamps its endpoint inside the hub', () => {
    const node = { left: 150, right: 350, top: 60, bottom: 140 };

    expect(conduitPath(stage, hub, node)).toBe('M 250 50 C 325 50 325 166 400 166');
  });

  it('connects a right node edge to the right side of the hub', () => {
    const node = { left: 850, right: 1_050, top: 400, bottom: 500 };

    expect(conduitPath(stage, hub, node)).toBe('M 750 400 C 675 400 675 400 600 400');
  });
});
