import { render } from '@testing-library/react';
import type { GameEvent } from '@memoria/shared';
import { describe, expect, it } from 'vitest';
import {
  CycleConnectors,
  MIN_LABEL_PX,
  barGeometry,
  buildCycleConnectorPaths,
  timelineCountdown,
  timelineRowLayout,
} from '../src/components/Timeline';

const WS = Date.UTC(2026, 7, 1);
const WE = Date.UTC(2026, 7, 31);
const DAY = 86_400_000;

function cycle(id: string, name: string, startDay: number, endDay: number): GameEvent {
  return {
    id,
    gameId: 'g1',
    name,
    type: 'cycle',
    start: WS + startDay * DAY,
    end: WS + endDay * DAY,
    dailyTouch: false,
    notify: true,
    notes: '',
    updatedAt: 0,
  };
}

function paths(container: HTMLElement): string[] {
  return [...container.querySelectorAll('path')].map((node) => node.getAttribute('d') ?? '');
}

function rowCenters(events: GameEvent[], pitch = 100): Map<string, number> {
  return new Map(events.map((event, index) => [event.id, (index + 0.5) * pitch]));
}

function connectorPaths(events: GameEvent[]): string[] {
  return buildCycleConnectorPaths(events, WS, WE, rowCenters(events));
}

function renderMeasuredLane(
  events: GameEvent[],
  rows: Array<{ top: number; height: number; barTop?: number; barHeight?: number }>,
  height: number,
) {
  const tree = (items: GameEvent[]) => (
    <div>
      <div data-testid="lane-stack">
        {items.map((event) => (
          <div key={event.id} data-timeline-event-row data-event-id={event.id}>
            <div data-event-bar />
          </div>
        ))}
        <CycleConnectors events={items} ws={WS} we={WE} ink="#5aa9ff" />
      </div>
      <button type="button">+ 2 done events</button>
    </div>
  );
  const view = render(tree(events));
  const stack = view.getByTestId('lane-stack');
  Object.defineProperty(stack, 'clientHeight', { configurable: true, value: height });
  [...stack.querySelectorAll<HTMLElement>('[data-timeline-event-row]')].forEach((row, index) => {
    const geometry = rows[index]!;
    const bar = row.querySelector<HTMLElement>('[data-event-bar]')!;
    Object.defineProperties(row, {
      offsetTop: { configurable: true, value: geometry.top },
      offsetHeight: { configurable: true, value: geometry.height },
    });
    Object.defineProperties(bar, {
      offsetTop: { configurable: true, value: geometry.barTop ?? 0 },
      offsetHeight: { configurable: true, value: geometry.barHeight ?? geometry.height },
    });
  });
  view.rerender(tree([...events]));
  return view;
}

describe('barGeometry', () => {
  it('places a bar at the same percentages the connector will read', () => {
    const { displayLeft, displayWidth, displayRight } = barGeometry(cycle('a', 'A', 6, 12), WS, WE);
    expect(displayLeft).toBeCloseTo(20, 5);
    expect(displayWidth).toBeCloseTo(20, 5);
    expect(displayRight).toBeCloseTo(40, 5);
  });

  it('gives a zero-length event a visible floor width without leaving the lane', () => {
    const { displayLeft, displayWidth, displayRight } = barGeometry(cycle('a', 'A', 30, 30), WS, WE);
    expect(displayWidth).toBe(0.125);
    expect(displayLeft).toBeLessThanOrEqual(99.875);
    expect(displayRight).toBeLessThanOrEqual(100);
  });

  it('draws a one-hour event at its honest width in a 30-day window', () => {
    const event = cycle('a', 'A', 10, 10);
    event.end = event.start + 3_600_000;
    expect(barGeometry(event, WS, WE).displayWidth).toBeCloseTo(100 / (30 * 24), 5);
  });

  it('clamps an event that starts before the window to the left edge', () => {
    const { displayLeft } = barGeometry(cycle('a', 'A', -10, 5), WS, WE);
    expect(displayLeft).toBe(0);
  });

  it('reserves the trailing cluster when a bar runs beyond the timeline scope', () => {
    const geometry = barGeometry(cycle('a', 'A', -10, 40), WS, WE);
    const laneWidth = 800;
    const layout = timelineRowLayout(geometry.displayLeft, geometry.displayWidth, laneWidth);

    expect(geometry).toEqual({ displayLeft: 0, displayWidth: 100, displayRight: 100 });
    expect(layout.tickFloats).toBe(false);
    expect(layout.barTextMaxWidth).toBeGreaterThan(0);
    expect(8 + layout.barTextMaxWidth).toBe(laneWidth - layout.trailingClusterPx);
  });
});

describe('timelineRowLayout', () => {
  const laneWidth = 900;
  const cases = [
    {
      name: 'long bar',
      displayLeft: 10,
      displayWidth: 70,
      tier: 'tight',
      tickFloats: false,
      showSpan: false,
      labelPlacement: 'inside',
    },
    {
      name: 'week-long bar',
      displayLeft: 10,
      displayWidth: 17.5,
      tier: 'roomy',
      tickFloats: true,
      showSpan: true,
      labelPlacement: 'inside',
    },
    {
      name: 'snug bar',
      displayLeft: 10,
      displayWidth: 10,
      tier: 'snug',
      tickFloats: true,
      showSpan: false,
      labelPlacement: 'inside',
    },
    {
      name: 'maintenance early',
      displayLeft: 10,
      displayWidth: 0.125,
      tier: 'minimal',
      tickFloats: false,
      showSpan: false,
      labelPlacement: 'after',
    },
    {
      name: 'maintenance late',
      displayLeft: 88,
      displayWidth: 0.125,
      tier: 'minimal',
      tickFloats: false,
      showSpan: false,
      labelPlacement: 'before',
    },
  ] as const;

  it.each(cases)('uses the measured $tier tier for $name', (testCase) => {
    const layout = timelineRowLayout(testCase.displayLeft, testCase.displayWidth, laneWidth);

    expect(layout).toMatchObject({
      tier: testCase.tier,
      tickFloats: testCase.tickFloats,
      showSpan: testCase.showSpan,
      labelPlacement: testCase.labelPlacement,
    });
    expect(layout.barTextMaxWidth).toBeGreaterThanOrEqual(0);
    expect(layout.trailingClusterPx).toBeGreaterThanOrEqual(96 + (layout.tickFloats ? 0 : 26));

    const barLeftPx = (testCase.displayLeft / 100) * laneWidth;
    const barEndPx = Math.min(
      laneWidth,
      Math.max(((testCase.displayLeft + testCase.displayWidth) / 100) * laneWidth, barLeftPx + 18),
    );
    if (layout.tickFloats) {
      expect(barEndPx + 26).toBeLessThanOrEqual(laneWidth - 96);
    } else {
      expect(layout.trailingClusterPx).toBeGreaterThanOrEqual(96 + 26);
    }

    if (layout.labelPlacement === 'inside') {
      expect(layout.barTextMaxWidth).toBeGreaterThanOrEqual(MIN_LABEL_PX);
    }
  });

  it('keeps an early outside label between the bar and the trailing cluster', () => {
    const layout = timelineRowLayout(10, 0.125, laneWidth);
    const barLeftPx = laneWidth * 0.1;
    const barEndPx = Math.max(laneWidth * 0.10125, barLeftPx + 18);
    const trailingClusterStartPx = laneWidth - layout.trailingClusterPx;

    expect(layout.labelPlacement).toBe('after');
    expect(barEndPx + layout.barTextMaxWidth).toBeLessThanOrEqual(trailingClusterStartPx);
  });

  it('keeps a late outside label before the bar', () => {
    const layout = timelineRowLayout(88, 0.125, laneWidth);
    const barLeftPx = laneWidth * 0.88;

    expect(layout.labelPlacement).toBe('before');
    expect(layout.barTextMaxWidth).toBeLessThanOrEqual(barLeftPx);
  });

  it('returns finite, non-negative measurements for a degenerate lane', () => {
    const layout = timelineRowLayout(10, 0.125, 0);

    expect(layout.barEndPct).toBe(10.125);
    expect(layout.labelPlacement).toBe('none');
    expect(layout.barTextMaxWidth).toBe(0);
    expect(layout.trailingClusterPx).toBeGreaterThanOrEqual(0);
    const measurements = Object.values(layout).filter((value): value is number => typeof value === 'number');
    expect(measurements.every((value) => Number.isFinite(value) && value >= 0)).toBe(true);
  });

  it.each([
    [0, 5],
    [10, 4],
    [70, 20],
    [95, 5],
  ])('never returns a sub-floor inside label at left %s, width %s', (displayLeft, displayWidth) => {
    const layout = timelineRowLayout(displayLeft, displayWidth, laneWidth);

    expect(layout.barTextMaxWidth).toBeGreaterThanOrEqual(0);
    if (layout.labelPlacement === 'inside') {
      expect(layout.barTextMaxWidth).toBeGreaterThanOrEqual(MIN_LABEL_PX);
    }
  });
});

describe('timelineCountdown', () => {
  it('counts future rows down to arrival and active rows down to their end', () => {
    expect(timelineCountdown({ start: WS + 3 * DAY, end: WS + 8 * DAY }, WS).label).toBe('arrives 3d 0h');
    expect(timelineCountdown({ start: WS - DAY, end: WS + 3 * DAY }, WS).label).toBe('ends 3d 0h');
  });

  it('keeps done and ended labels unchanged', () => {
    expect(timelineCountdown({ done: true, start: WS + DAY, end: WS + 2 * DAY }, WS).label).toBe('done');
    expect(timelineCountdown({ start: WS - 2 * DAY, end: WS }, WS).label).toBe('ended');
  });
});

describe('CycleConnectors', () => {
  const ink = '#5aa9ff';

  it('joins consecutive instances of the same cycle', () => {
    const events = [cycle('a', 'Spiral Abyss', 0, 8), cycle('b', 'Spiral Abyss', 10, 18)];
    expect(connectorPaths(events)).toHaveLength(1);
  });

  it('draws n-1 hand-offs for n instances, never a loop back to the first', () => {
    const events = [cycle('a', 'Abyss', 0, 5), cycle('b', 'Abyss', 7, 12), cycle('c', 'Abyss', 14, 19)];
    expect(connectorPaths(events)).toHaveLength(2);
  });

  it('never joins two different cycles, however adjacent', () => {
    const events = [cycle('a', 'Spiral Abyss', 0, 8), cycle('b', 'Imaginarium Theater', 10, 18)];
    expect(connectorPaths(events)).toHaveLength(0);
  });

  it('renders nothing at all when a cycle has a single instance', () => {
    const events = [cycle('a', 'Spiral Abyss', 0, 8)];
    const { container } = render(<CycleConnectors events={events} ws={WS} we={WE} ink={ink} />);
    // This is the shipped seed feed's situation: the earlier instance of every
    // repeating cycle has already ended, so only one is ever in the window.
    expect(container.firstChild).toBeNull();
  });

  it('starts each curve on the left bar right edge and ends it on the next bar left edge', () => {
    const first = cycle('a', 'Abyss', 0, 6);
    const second = cycle('b', 'Abyss', 12, 18);
    const [d] = buildCycleConnectorPaths(
      [first, second],
      WS,
      WE,
      new Map([
        [first.id, 50],
        [second.id, 150],
      ]),
    );
    // viewBox X runs 0..1000, so a percentage maps by ×10.
    const expectedStart = barGeometry(first, WS, WE).displayRight * 10;
    const expectedEnd = barGeometry(second, WS, WE).displayLeft * 10;
    const move = /^M ([\d.]+) ([\d.]+) C .* ([\d.]+) ([\d.]+)$/.exec(d!);
    expect(move).not.toBeNull();
    expect(Number(move![1])).toBeCloseTo(expectedStart, 0);
    expect(Number(move![3])).toBeCloseTo(expectedEnd, 0);
    // Row centres: row 0 and row 1 of a 100-unit pitch.
    expect(Number(move![2])).toBe(50);
    expect(Number(move![4])).toBe(150);
  });

  it('emits no NaN even when the window has zero span', () => {
    const events = [cycle('a', 'Abyss', 0, 2), cycle('b', 'Abyss', 3, 5)];
    for (const d of buildCycleConnectorPaths(events, WS, WS, rowCenters(events))) {
      expect(d).not.toMatch(/NaN|Infinity/);
    }
  });

  it('uses mixed row centres and excludes the done-events control from its viewBox', () => {
    const first = cycle('a', 'Abyss', 0, 6);
    const maintenance = { ...cycle('m', 'Maintenance', 7, 8), type: 'maintenance' as const };
    const ordinary = { ...cycle('e', 'Festival', 9, 10), type: 'event' as const };
    const second = cycle('b', 'Abyss', 12, 18);
    const events = [first, maintenance, ordinary, second];
    const { container } = renderMeasuredLane(
      events,
      [
        { top: 0, height: 44, barHeight: 28 },
        { top: 50, height: 24, barHeight: 20 },
        { top: 80, height: 44, barHeight: 28 },
        { top: 130, height: 44, barTop: 2, barHeight: 28 },
      ],
      174,
    );
    const [d] = paths(container);
    const move = /^M ([\d.]+) ([\d.]+) C .* ([\d.]+) ([\d.]+)$/.exec(d!);
    expect(move).not.toBeNull();
    expect(Number(move![2])).toBe(14);
    expect(Number(move![4])).toBe(146);
    expect(container.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 1000 174');
  });
});
