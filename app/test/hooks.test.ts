import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useNow } from '../src/hooks';

function setHidden(hidden: boolean): void {
  Object.defineProperty(document, 'hidden', { configurable: true, value: hidden });
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  vi.useFakeTimers();
  setHidden(false);
});

afterEach(() => {
  Reflect.deleteProperty(document, 'hidden');
  vi.useRealTimers();
});

describe('countdown clock', () => {
  it('does no countdown work while hidden and catches up immediately on return', () => {
    const render = vi.fn(() => useNow());
    const { result, unmount } = renderHook(render);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current).toBe(Date.now());
    act(() => {
      setHidden(true);
    });
    const rendersBefore = render.mock.calls.length;
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(render.mock.calls.length).toBe(rendersBefore);
    expect(vi.getTimerCount()).toBe(0);
    act(() => {
      setHidden(false);
    });
    expect(result.current).toBe(Date.now());
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('starts no interval for an initially hidden tab', () => {
    setHidden(true);
    const { unmount } = renderHook(() => useNow());
    expect(vi.getTimerCount()).toBe(0);
    unmount();
  });
});
