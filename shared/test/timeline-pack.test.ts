import { describe, expect, it } from 'vitest';
import { isPredictedWindow, packSpans } from '../src/timeline-pack';

const span = (id: string, start: number, end: number) => ({ id, start, end });
const ids = (rows: { id: string }[][]) => rows.map((row) => row.map((item) => item.id));

describe('packSpans', () => {
  it('shares a row between spans that do not overlap', () => {
    expect(ids(packSpans([span('a', 0, 10), span('b', 10, 20), span('c', 5, 15)]))).toEqual([['a', 'b'], ['c']]);
  });

  it('keeps the shortest reserved span and the gap clear', () => {
    expect(ids(packSpans([span('a', 0, 1), span('b', 3, 9)], 5))).toEqual([['a'], ['b']]);
    expect(ids(packSpans([span('a', 0, 10), span('b', 10, 20)], 0, 1))).toEqual([['a'], ['b']]);
  });

  it('is stable for equal spans and does not change its input', () => {
    const items = [span('b', 0, 5), span('a', 0, 5)];
    expect(ids(packSpans(items))).toEqual([['a'], ['b']]);
    expect(items.map((item) => item.id)).toEqual(['b', 'a']);
  });
});

it('recognises a predicted window by its feed name', () => {
  expect(isPredictedWindow({ name: 'Version 7.3 Special Program — predicted window' })).toBe(true);
  expect(isPredictedWindow({ name: 'Version 7.3 Special Program' })).toBe(false);
});
