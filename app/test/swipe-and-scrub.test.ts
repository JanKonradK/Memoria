import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { PointerEvent } from 'react';
import { nextGameStop, useTabSwipe } from '../src/gestures';
import { scrubStep, scrubValue } from '../src/scrub';
import { swipeCommitPx, swipeFollow, swipeOutcome } from '../src/swipe-row';
import { longAge, shortAge } from '../src/components/Ago';
import { BUZZ_PATTERN, canBuzz } from '../src/haptics';
import { useUI, type GameTab } from '../src/ui-store';

describe('row swipe', () => {
  it('commits at a third of the row, between 56 and 112px', () => {
    expect(swipeCommitPx(100)).toBe(56);
    expect(swipeCommitPx(240)).toBe(84);
    expect(swipeCommitPx(900)).toBe(112);
  });
  it('follows the finger to the point, then at a quarter of its speed', () => {
    expect(swipeFollow(50, 400, true)).toBe(50);
    expect(swipeFollow(-212, 400, true)).toBe(-(112 + 100 / 4));
  });
  it('resists a side with nothing to do', () => {
    expect(swipeFollow(200, 400, false)).toBe(28);
    expect(swipeFollow(-40, 400, false)).toBe(-10);
  });
  it('acts when far enough, or on a quick flick, and not on a wobble', () => {
    expect(swipeOutcome(120, 400, 0.1)).toBe('right');
    expect(swipeOutcome(-120, 400, -0.1)).toBe('left');
    expect(swipeOutcome(45, 400, 0.9)).toBe('right');
    expect(swipeOutcome(45, 400, -0.9)).toBeNull();
    expect(swipeOutcome(30, 400, 2)).toBeNull();
    expect(swipeOutcome(60, 400, 0.2)).toBeNull();
  });
});

describe('bar scrub', () => {
  it('ticks at a round step near a twentieth of the cap', () => {
    expect(scrubStep(200)).toBe(10);
    expect(scrubStep(240)).toBe(10);
    expect(scrubStep(5)).toBe(1);
    expect(scrubStep(2400)).toBe(100);
    expect(scrubStep(0)).toBe(1);
  });
  it('reads the finger along the bar, clamped to the range', () => {
    const bar = { cap: 200, start: 50, left: 100, width: 400, dx: 0 };
    expect(scrubValue('absolute', { ...bar, x: 300 })).toBe(100);
    expect(scrubValue('absolute', { ...bar, x: 40 })).toBe(0);
    expect(scrubValue('absolute', { ...bar, x: 900 })).toBe(200);
  });
  it('moves from the starting value by the drag, the width for the whole cap', () => {
    const row = { cap: 200, start: 136, left: 0, width: 400, x: 0 };
    expect(scrubValue('relative', { ...row, dx: 100 })).toBe(186);
    expect(scrubValue('relative', { ...row, dx: -400 })).toBe(0);
    expect(scrubValue('relative', { ...row, dx: 0 })).toBe(136);
  });
});

describe('swiping a game page', () => {
  const tabs: GameTab[] = ['track', 'events', 'pulls', 'notes'];
  it('steps through its tabs', () => {
    expect(nextGameStop(tabs, 'events', 1)).toBe('pulls');
    expect(nextGameStop(tabs, 'events', -1)).toBe('track');
  });
  it('stops at either end: never on to another game or place', () => {
    expect(nextGameStop(tabs, 'notes', 1)).toBeNull();
    expect(nextGameStop(tabs, 'track', -1)).toBeNull();
  });
  it('treats a tab the game does not show as its first', () => {
    expect(nextGameStop(tabs, 'quests', 1)).toBe('events');
    expect(nextGameStop(tabs, 'quests', -1)).toBeNull();
  });
});

describe('the page swipe', () => {
  const page = () => {
    const host = document.createElement('main');
    const frame = document.createElement('div');
    frame.className = 'page-enter';
    const surface = document.createElement('p');
    frame.append(surface);
    host.append(frame);
    document.body.append(host);
    return { host, frame, surface };
  };
  afterEach(() => document.body.replaceChildren());

  /** A finger drag on `target`, as the hook's handlers see it. */
  function drag(
    handlers: ReturnType<typeof useTabSwipe>,
    host: HTMLElement,
    target: HTMLElement,
    points: [number, number][],
  ) {
    const event = ([x, y]: [number, number], at: number) =>
      ({
        pointerType: 'touch',
        isPrimary: true,
        pointerId: 3,
        clientX: x,
        clientY: y,
        timeStamp: at,
        target,
        currentTarget: host,
      }) as unknown as PointerEvent<HTMLElement>;
    act(() => handlers.onPointerDown(event(points[0]!, 0)));
    for (const [index, point] of points.slice(1, -1).entries())
      act(() => handlers.onPointerMove(event(point, (index + 1) * 50)));
    act(() => handlers.onPointerUp(event(points.at(-1)!, points.length * 50)));
  }

  it('pages on a clearly sideways drag, and rubber-bands as it follows', () => {
    const onSwipe = vi.fn();
    const { result } = renderHook(() => useTabSwipe(onSwipe));
    const { host, frame, surface } = page();
    act(() =>
      result.current.onPointerDown({
        pointerType: 'touch',
        isPrimary: true,
        pointerId: 3,
        clientX: 600,
        clientY: 300,
        timeStamp: 0,
        target: surface,
        currentTarget: host,
      } as unknown as PointerEvent<HTMLElement>),
    );
    act(() =>
      result.current.onPointerMove({
        pointerId: 3,
        clientX: 200,
        clientY: 305,
        target: surface,
        currentTarget: host,
      } as unknown as PointerEvent<HTMLElement>),
    );
    // A long drag follows a third of the way, never past 48px.
    expect(frame).toHaveAttribute('data-swiping');
    expect(frame.style.getPropertyValue('--page-swipe-x')).toBe('-48px');
    act(() =>
      result.current.onPointerUp({
        pointerId: 3,
        clientX: 200,
        clientY: 305,
        timeStamp: 300,
        target: surface,
        currentTarget: host,
      } as unknown as PointerEvent<HTMLElement>),
    );
    expect(onSwipe).toHaveBeenCalledWith(1);
  });

  it('leaves a diagonal drag to the page scroll', () => {
    const onSwipe = vi.fn();
    const { result } = renderHook(() => useTabSwipe(onSwipe));
    const { host, frame, surface } = page();
    // 120px across but 80px down: under twice as wide as tall, so it is a scroll.
    drag(result.current, host, surface, [
      [600, 300],
      [540, 340],
      [480, 380],
    ]);
    expect(onSwipe).not.toHaveBeenCalled();
    expect(frame).not.toHaveAttribute('data-swiping');
  });

  it('leaves a drag from within 24px of either edge to the system back gesture', () => {
    const onSwipe = vi.fn();
    const { result } = renderHook(() => useTabSwipe(onSwipe));
    const { host, frame, surface } = page();
    drag(result.current, host, surface, [
      [12, 300],
      [150, 300],
      [300, 300],
    ]);
    drag(result.current, host, surface, [
      [window.innerWidth - 10, 300],
      [window.innerWidth - 200, 300],
      [window.innerWidth - 400, 300],
    ]);
    expect(onSwipe).not.toHaveBeenCalled();
    expect(frame).not.toHaveAttribute('data-swiping');
  });

  it('leaves a drag that starts in a sideways scroller, or on a strip that owns sideways drags', () => {
    const onSwipe = vi.fn();
    const { result } = renderHook(() => useTabSwipe(onSwipe));
    const { host, frame } = page();
    const scroller = document.createElement('div');
    scroller.style.overflowX = 'auto';
    Object.defineProperty(scroller, 'scrollWidth', { value: 900 });
    Object.defineProperty(scroller, 'clientWidth', { value: 300 });
    const inScroller = document.createElement('span');
    scroller.append(inScroller);
    const tabs = document.createElement('div');
    tabs.className = 'game-tabs';
    const inTabs = document.createElement('span');
    tabs.append(inTabs);
    frame.append(scroller, tabs);
    for (const target of [inScroller, inTabs]) {
      drag(result.current, host, target, [
        [600, 300],
        [400, 300],
        [200, 300],
      ]);
    }
    expect(onSwipe).not.toHaveBeenCalled();
    expect(frame).not.toHaveAttribute('data-swiping');
  });
});

describe('ages', () => {
  it('is short beside its mark', () => {
    expect(shortAge(10_000)).toBe('Now');
    expect(shortAge(13 * 60_000)).toBe('13m');
    expect(shortAge(5 * 3_600_000 + 59 * 60_000)).toBe('5h');
    expect(shortAge(3 * 86_400_000)).toBe('3d');
    expect(shortAge(-5)).toBe('Now');
  });
  it('says it in full otherwise', () => {
    expect(longAge('Updated', 10_000)).toBe('Updated just now');
    expect(longAge('Updated', 13 * 60_000)).toBe('Updated 13 min ago');
    expect(longAge('Last synced', 2 * 3_600_000)).toBe('Last synced 2 h ago');
    expect(longAge('Entered', 86_400_000)).toBe('Entered 1 day ago');
    expect(longAge('Entered', 4 * 86_400_000)).toBe('Entered 4 days ago');
  });
});

describe('haptics', () => {
  it('stays silent when the player turned vibration off', () => {
    useUI.getState().setVibration(false);
    expect(canBuzz()).toBe(false);
    useUI.getState().setVibration(true);
  });
  it('keeps every browser pulse short', () => {
    for (const pattern of Object.values(BUZZ_PATTERN)) {
      const pulses = Array.isArray(pattern) ? pattern : [pattern];
      expect(Math.max(...pulses)).toBeLessThanOrEqual(40);
    }
  });
});
