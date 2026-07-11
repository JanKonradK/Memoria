import { describe, expect, it } from 'vitest';
import { latestSnapshots, projectEnergy } from '../src/energy';
import { makeResource, makeSnapshot } from './helpers';

const MIN = 60_000;

describe('projectEnergy', () => {
  const res = makeResource({ cap: 200, regenMinutes: 8 });

  it('returns unknown state without a snapshot', () => {
    const p = projectEnergy(res, undefined, 1000);
    expect(p.hasSnapshot).toBe(false);
    expect(p.value).toBe(0);
    expect(p.msToFull).toBeNull();
  });

  it('projects regen forward from the snapshot', () => {
    const snap = makeSnapshot({ value: 100, takenAt: 0 });
    // 80 minutes later at 8 min/point → +10 points
    const p = projectEnergy(res, snap, 80 * MIN);
    expect(p.value).toBe(110);
    expect(p.isFull).toBe(false);
  });

  it('floors partial points but exposes precise value', () => {
    const snap = makeSnapshot({ value: 0, takenAt: 0 });
    const p = projectEnergy(res, snap, 12 * MIN); // 1.5 points
    expect(p.value).toBe(1);
    expect(p.precise).toBeCloseTo(1.5);
  });

  it('clamps at cap and counts overflow', () => {
    const snap = makeSnapshot({ value: 190, takenAt: 0 });
    // needs 10 points = 80 min to cap; give it 160 min → 10 wasted
    const p = projectEnergy(res, snap, 160 * MIN);
    expect(p.value).toBe(200);
    expect(p.isFull).toBe(true);
    expect(p.msToFull).toBe(0);
    expect(p.overflow).toBe(10);
  });

  it('computes exact time-to-full', () => {
    const snap = makeSnapshot({ value: 150, takenAt: 1000 * MIN });
    const now = 1000 * MIN + 4 * MIN;
    const p = projectEnergy(res, snap, now);
    // 50 points needed from snapshot = 400 min; 4 elapsed → 396 left
    expect(p.fullAt).toBe(1000 * MIN + 400 * MIN);
    expect(p.msToFull).toBe(396 * MIN);
  });

  it('freezes a snapshot taken over cap (no regen past cap)', () => {
    const snap = makeSnapshot({ value: 210, takenAt: 0 });
    const p = projectEnergy(res, snap, 100 * MIN);
    expect(p.value).toBe(210);
    expect(p.isFull).toBe(true);
  });

  it('treats regenMinutes 0 as static', () => {
    const staticRes = makeResource({ cap: 5, regenMinutes: 0 });
    const snap = makeSnapshot({ value: 3, takenAt: 0 });
    const p = projectEnergy(staticRes, snap, 9999 * MIN);
    expect(p.value).toBe(3);
    expect(p.msToFull).toBeNull();
  });
});

describe('latestSnapshots', () => {
  it('picks the newest snapshot per resource', () => {
    const map = latestSnapshots([
      makeSnapshot({ id: 'a', resourceId: 'r1', takenAt: 100 }),
      makeSnapshot({ id: 'b', resourceId: 'r1', takenAt: 300 }),
      makeSnapshot({ id: 'c', resourceId: 'r2', takenAt: 200 }),
    ]);
    expect(map.get('r1')?.id).toBe('b');
    expect(map.get('r2')?.id).toBe('c');
  });
});
