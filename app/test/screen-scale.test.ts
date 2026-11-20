import { describe, expect, it } from 'vitest';
import { screenScale } from '../src/screen-scale';

describe('screenScale', () => {
  it('draws a regular phone at exactly 1', () => {
    for (const short of [360, 384, 393, 412, 430, 480]) expect(screenScale(short)).toBe(1);
  });
  it('shrinks a small phone a touch, never below 0.9', () => {
    expect(screenScale(340)).toBe(0.94);
    expect(screenScale(280)).toBe(0.9);
  });
  it('grows with a tablet, up to 1.35', () => {
    expect(screenScale(800)).toBeGreaterThan(1.15);
    expect(screenScale(800)).toBeLessThan(1.3);
    expect(screenScale(1095)).toBe(1.35);
  });
  it('treats an unknown screen as 1', () => {
    expect(screenScale(0)).toBe(1);
    expect(screenScale(Number.NaN)).toBe(1);
  });
});
