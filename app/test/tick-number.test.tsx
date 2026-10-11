import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TickNumber } from '../src/components/TickNumber';

/** Motion on or off for this render, through the same query the hook reads. */
function motion(reduced: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: reduced && query.includes('prefers-reduced-motion'),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('shows the number as it is on first render', () => {
  motion(false);
  const { container } = render(<TickNumber value={120} />);
  expect(container).toHaveTextContent('120');
});

it('counts from the old value to the new one and lands on it exactly', () => {
  motion(false);
  const { container, rerender } = render(<TickNumber value={100} />);
  rerender(<TickNumber value={200} />);
  // The change is not shown at once: the count starts from what was on screen.
  expect(container).toHaveTextContent('100');
  act(() => vi.advanceTimersByTime(130));
  const midway = Number(container.textContent);
  expect(midway).toBeGreaterThan(100);
  expect(midway).toBeLessThan(200);
  act(() => vi.advanceTimersByTime(400));
  expect(container).toHaveTextContent('200');
});

it('swaps at once under reduced motion', () => {
  motion(true);
  const { container, rerender } = render(<TickNumber value={100} />);
  rerender(<TickNumber value={200} />);
  expect(container).toHaveTextContent('200');
});
