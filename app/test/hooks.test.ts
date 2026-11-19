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
  it('gives every reader of one interval the same instant, on the boundary', () => {
    const a = renderHook(() => useNow(30_000));
    const b = renderHook(() => useNow(30_000));
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(a.result.current).toBe(b.result.current);
    expect(a.result.current % 30_000).toBe(0);
    // Two readers, one timer.
    expect(vi.getTimerCount()).toBe(1);
    a.unmount();
    b.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does no countdown work while hidden and catches up immediately on return', () => {
    const render = vi.fn(() => useNow());
    const { result, unmount } = renderHook(render);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    // Ticks land on the second's boundary, so the reading is at most a tick old.
    expect(Date.now() - result.current).toBeLessThan(1000);
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
