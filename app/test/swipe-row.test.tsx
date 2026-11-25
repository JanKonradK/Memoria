import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SwipeRow } from '../src/swipe-row';

const touch = { pointerId: 1, pointerType: 'touch', isPrimary: true };

function swipe(row: HTMLElement, dx: number) {
  fireEvent.pointerDown(row, { ...touch, clientX: 0, clientY: 0 });
  fireEvent.pointerMove(row, { ...touch, clientX: dx / 2, clientY: 0 });
  fireEvent.pointerMove(row, { ...touch, clientX: dx, clientY: 0 });
}

function Row({ onRight = () => {}, onClick = () => {} }: { onRight?: () => void; onClick?: () => void }) {
  return (
    <SwipeRow data-testid="row" right={{ label: 'Done', run: onRight }}>
      <button type="button" onClick={onClick}>
        Daily
      </button>
    </SwipeRow>
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 400 } as DOMRect);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it('acts past the point and settles back', () => {
  const run = vi.fn();
  render(<Row onRight={run} />);
  const row = screen.getByTestId('row');
  swipe(row, 200);
  expect(row).toHaveAttribute('data-swiping');
  fireEvent.pointerUp(row, { ...touch, clientX: 200, clientY: 0 });
  expect(run).toHaveBeenCalledTimes(1);
  expect(row).toHaveAttribute('data-swipe-release');
  act(() => vi.advanceTimersByTime(320));
  expect(row).not.toHaveAttribute('data-swiping');
  expect(row.style.getPropertyValue('--swipe-x')).toBe('');
});

it('never lets an earlier settle wipe out the next drag', () => {
  render(<Row />);
  const row = screen.getByTestId('row');
  swipe(row, 30);
  fireEvent.pointerUp(row, { ...touch, clientX: 30, clientY: 0 });
  act(() => vi.advanceTimersByTime(100));
  // A second finger lands while the first settle is still running.
  swipe(row, 40);
  act(() => vi.advanceTimersByTime(400));
  expect(row).toHaveAttribute('data-swiping');
  expect(row).not.toHaveAttribute('data-swipe-release');
  expect(row.style.getPropertyValue('--swipe-x')).toBe('40px');
});

it('settles on the slide ending, not on a child scale or fade ending', () => {
  render(<Row />);
  const row = screen.getByTestId('row');
  swipe(row, 30);
  fireEvent.pointerUp(row, { ...touch, clientX: 30, clientY: 0 });
  const ended = (propertyName: string) => {
    const event = new Event('transitionend', { bubbles: true });
    Object.defineProperty(event, 'propertyName', { value: propertyName });
    row.dispatchEvent(event);
  };
  ended('scale');
  expect(row).toHaveAttribute('data-swiping');
  ended('translate');
  expect(row).not.toHaveAttribute('data-swiping');
});

it('swallows the click a swipe ends with, and only that one', () => {
  const click = vi.fn();
  render(<Row onClick={click} />);
  const row = screen.getByTestId('row');
  swipe(row, 30);
  fireEvent.pointerUp(row, { ...touch, clientX: 30, clientY: 0 });
  fireEvent.click(screen.getByText('Daily'));
  expect(click).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Daily'));
  expect(click).toHaveBeenCalledTimes(1);
});

it('leaves no listener or timer behind when the row goes away mid-settle', () => {
  const click = vi.fn();
  const view = render(<Row />);
  const row = screen.getByTestId('row');
  swipe(row, 30);
  fireEvent.pointerUp(row, { ...touch, clientX: 30, clientY: 0 });
  view.unmount();
  const button = document.createElement('button');
  button.addEventListener('click', click);
  document.body.append(button);
  button.click();
  expect(click).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
  button.remove();
});
