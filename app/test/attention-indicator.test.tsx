import { act, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AttentionIndicator } from '../src/components/AttentionIndicator';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('runs only in view and in a visible tab, then releases its observer', () => {
  const media = window.matchMedia('(prefers-reduced-motion: reduce)');
  vi.spyOn(window, 'matchMedia').mockReturnValue({ ...media, matches: false });
  let intersect: IntersectionObserverCallback = () => {};
  const disconnect = vi.fn();
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: IntersectionObserverCallback) {
        intersect = callback;
      }
      observe = vi.fn();
      disconnect = disconnect;
    },
  );
  const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  const view = render(<AttentionIndicator />);
  const ring = view.container.querySelector('[data-urgency-indicator]')!;
  const setVisible = (isIntersecting: boolean) =>
    act(() => intersect([{ isIntersecting } as IntersectionObserverEntry], {} as IntersectionObserver));

  expect(ring).not.toHaveAttribute('data-running', 'true');
  setVisible(true);
  expect(ring).toHaveAttribute('data-running', 'true');
  hidden.mockReturnValue(true);
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  expect(ring).not.toHaveAttribute('data-running', 'true');
  hidden.mockReturnValue(false);
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  expect(ring).toHaveAttribute('data-running', 'true');
  setVisible(false);
  expect(ring).not.toHaveAttribute('data-running', 'true');
  view.unmount();
  expect(disconnect).toHaveBeenCalledOnce();
});

it('keeps a static indicator without observing when reduced motion is requested', () => {
  const observer = vi.fn();
  vi.stubGlobal('IntersectionObserver', observer);
  const view = render(<AttentionIndicator />);
  expect(view.container.querySelector('[data-urgency-indicator]')).not.toHaveAttribute('data-running', 'true');
  expect(observer).not.toHaveBeenCalled();
});
