import type { ReactNode } from 'react';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { DateTime } from 'luxon';
import type { Game, GameEvent } from '@memoria/shared';
import { useReducedMotionConfig } from 'motion/react';
import { m } from 'motion/react';
import { useApp } from '../store';
import { cycleKey, sortTimelineEvents } from '../timeline-sort';
import { useUI } from '../ui-store';
import { slideIn } from '../motion';
import { endTone, fmtDur } from '../util';
import { Disclosure } from './Disclosure';
import { ProgressBar } from './primitives';
import { useIdentityColors } from './roster';
import { GameBadge, Page, ServerChip, Tooltip } from './ui';
import { TimelineTools } from './TimelineTools';
import { TimelineList } from './TimelineList';
import { serverRegionLabel } from './NexusLayout';
import { titleFont } from '../fonts';
import { assignGameInks, gameRim, gameTitleInk, mix, onColor } from '../game-color';
import { useGround, useInset } from '../theme';
import { EventTags } from './EventTags';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const MIN_TICK_GAP_PX = 64;
const TICK_SLOT_PX = 26;
const COUNTDOWN_PX = 96;
const SPAN_PX = 116;
const MIN_BAR_PX = 18;
const BAR_TEXT_INSET_PX = 8;
export const MIN_LABEL_PX = 40;

/**
 * The window the ruler shows, in days. This was a 7d/40d control in the app bar;
 * the short window only ever meant "zoom in on this week", which the ruler's own
 * playhead and the Tonight panel both already answer. FULL_AGENDA_DAYS in
 * agenda-data.ts mirrors this value.
 */
const RANGE_DAYS = 40;

function useElementWidth() {
  const observerRef = useRef<ResizeObserver | null>(null);
  const [width, setWidth] = useState(0);

  const setElement = useCallback((element: HTMLElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!element) return;
    const updateWidth = (nextWidth: number) => setWidth(Math.ceil(nextWidth));
    updateWidth(element.getBoundingClientRect().width);

    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) updateWidth(entry.target.getBoundingClientRect().width);
    });
    observer.observe(element);
    observerRef.current = observer;
  }, []);

  useEffect(() => () => observerRef.current?.disconnect(), []);

  return [setElement, width] as const;
}

function buildGridTicks(rangeStart: number, rangeEnd: number, width: number, localTz: string): DateTime[] {
  const rangeSpan = rangeEnd - rangeStart;
  // Four-day ticks unless the lane is too narrow to keep them apart, then eight.
  const wideTickGapPx = rangeSpan > 0 ? (4 * DAY * width) / rangeSpan : Number.POSITIVE_INFINITY;
  const stepDays = width > 0 && wideTickGapPx < MIN_TICK_GAP_PX ? 8 : 4;
  const step = { days: stepDays } as const;
  let boundary = DateTime.fromMillis(rangeStart, { zone: localTz }).startOf('day');
  if (boundary.toMillis() < rangeStart) boundary = boundary.plus(step);

  const boundaries: DateTime[] = [];
  while (boundary.toMillis() <= rangeEnd) {
    boundaries.push(boundary);
    boundary = boundary.plus(step);
  }
  return boundaries;
}

/**
 * Where a bar sits in its lane, as percentages of the lane width.
 *
 * Shared by the bar and by the cycle connectors that hand off between bars — if
 * these two ever computed it separately, a curve would start a few pixels off the
 * bar it is supposed to leave, which is exactly the kind of drift nobody notices
 * in review and everybody notices on screen.
 */
export function barGeometry(ev: { start: number; end: number }, ws: number, we: number) {
  // A degenerate window would divide by zero and put NaN straight into an SVG
  // path, which fails silently — the browser drops the path and the curve just
  // is not there. Collapse to the left edge instead.
  const span = we - ws;
  const floor = 0.125;
  if (!(span > 0)) return { displayLeft: 0, displayWidth: floor, displayRight: floor };
  const left = (Math.max(ev.start, ws) - ws) / span;
  const width = (Math.min(ev.end, we) - Math.max(ev.start, ws)) / span;
  // 0.125% is about 1px on an 800px lane and less than two hours in a 40d
  // window. It keeps a zero-length mark visible without falsifying short spans;
  // the full-width row button owns the reachable hit area.
  const displayWidth = Math.min(100, Math.max(width * 100, floor));
  const displayLeft = Math.max(0, Math.min(left * 100, 100 - displayWidth));
  return { displayLeft, displayWidth, displayRight: displayLeft + displayWidth };
}

/**
 * Keeps the row controls and the bar label in separate pixel budgets.
 *
 * A bar that ran beyond the scope used to fill the lane and paint its name below
 * the right-anchored countdown. The same estimates now decide whether the tick
 * can float and where bar text must stop, so those two choices cannot drift.
 */
interface TimelineRowLayoutBase {
  barTextMaxWidth: number;
  trailingClusterPx: number;
  barEndPct: number;
  clusterBefore?: boolean;
}

export type TimelineRowLayout =
  | (TimelineRowLayoutBase & {
      tier: 'roomy';
      tickFloats: true;
      showSpan: true;
      labelPlacement: 'inside';
    })
  | (TimelineRowLayoutBase & {
      tier: 'snug';
      tickFloats: true;
      showSpan: false;
      labelPlacement: 'inside';
    })
  | (TimelineRowLayoutBase & {
      tier: 'tight';
      tickFloats: false;
      showSpan: false;
      labelPlacement: 'inside';
    })
  | (TimelineRowLayoutBase & {
      tier: 'minimal';
      tickFloats: false;
      showSpan: false;
      labelPlacement: 'after' | 'before' | 'none';
    });

export function timelineRowLayout(
  displayLeft: number,
  displayWidth: number,
  laneWidth: number,
  labelMode: 'auto' | 'outside' = 'auto',
  countdownWidth = COUNTDOWN_PX,
): TimelineRowLayout {
  const safeLaneWidth = Number.isFinite(laneWidth) ? Math.max(0, laneWidth) : 0;
  const safeDisplayLeft = Number.isFinite(displayLeft) ? Math.max(0, Math.min(displayLeft, 100)) : 0;
  const safeDisplayWidth = Number.isFinite(displayWidth)
    ? Math.max(0, Math.min(displayWidth, 100 - safeDisplayLeft))
    : 0;
  const barEndPct = safeDisplayLeft + safeDisplayWidth;
  // The bar carries px-2 and a 1px border, so it cannot paint narrower than its
  // own padding however short the event is. A brief update is exactly that case:
  // its percentage width is near zero while the bar still occupies 18px, and a
  // tick placed by percentage alone landed back on top of it.
  const barLeftPx = (safeDisplayLeft / 100) * safeLaneWidth;
  const proportionalBarEndPx = (barEndPct / 100) * safeLaneWidth;
  const barEndPx =
    safeLaneWidth > 0 ? Math.min(safeLaneWidth, Math.max(proportionalBarEndPx, barLeftPx + MIN_BAR_PX)) : 0;
  const barInnerPx = Math.max(0, barEndPx - barLeftPx - BAR_TEXT_INSET_PX);

  // Preserve room for the optional span before the tick is allowed to float.
  // This keeps long bars from pushing the tick into the countdown.
  const tickFloats = safeLaneWidth > 0 && barEndPx + TICK_SLOT_PX <= safeLaneWidth - countdownWidth - SPAN_PX;
  const trailingClusterPx = countdownWidth + (tickFloats ? 0 : TICK_SLOT_PX);
  const clusterStartPx = Math.max(0, safeLaneWidth - trailingClusterPx);
  const textRightPx = Math.min(barEndPx, clusterStartPx);
  const insideLabelPx = Math.max(0, textRightPx - barLeftPx - BAR_TEXT_INSET_PX);

  if (labelMode !== 'outside' && insideLabelPx >= MIN_LABEL_PX) {
    if (tickFloats && barInnerPx >= SPAN_PX) {
      return {
        tier: 'roomy',
        tickFloats: true,
        showSpan: true,
        labelPlacement: 'inside',
        barTextMaxWidth: insideLabelPx,
        trailingClusterPx,
        barEndPct,
      };
    }

    if (tickFloats) {
      return {
        tier: 'snug',
        tickFloats: true,
        showSpan: false,
        labelPlacement: 'inside',
        barTextMaxWidth: insideLabelPx,
        trailingClusterPx,
        barEndPct,
      };
    }

    return {
      tier: 'tight',
      tickFloats: false,
      showSpan: false,
      labelPlacement: 'inside',
      barTextMaxWidth: insideLabelPx,
      trailingClusterPx,
      barEndPct,
    };
  }

  // A future bar can be clipped by the right edge of the window. Use its
  // empty lead-in for the countdown so the title stays on its own bar.
  if (
    labelMode !== 'outside' &&
    barInnerPx >= MIN_LABEL_PX &&
    barLeftPx >= countdownWidth + TICK_SLOT_PX + BAR_TEXT_INSET_PX
  ) {
    return {
      tier: 'tight',
      tickFloats: false,
      showSpan: false,
      labelPlacement: 'inside',
      barTextMaxWidth: barInnerPx,
      trailingClusterPx: countdownWidth + TICK_SLOT_PX,
      barEndPct,
      clusterBefore: true,
    };
  }

  // An outside label and a floating tick would compete for the same gap. Keep
  // the mandatory tick with the countdown, then give the label the remaining
  // lane space on either side of the bar.
  const minimalTrailingClusterPx = countdownWidth + TICK_SLOT_PX;
  const minimalClusterStartPx = Math.max(0, safeLaneWidth - minimalTrailingClusterPx);
  const afterLabelPx = Math.max(0, minimalClusterStartPx - barEndPx);
  const beforeLabelPx = Math.max(0, Math.min(barLeftPx, minimalClusterStartPx));
  const labelPlacement = afterLabelPx >= MIN_LABEL_PX ? 'after' : beforeLabelPx >= MIN_LABEL_PX ? 'before' : 'none';
  const barTextMaxWidth = labelPlacement === 'after' ? afterLabelPx : labelPlacement === 'before' ? beforeLabelPx : 0;

  return {
    tier: 'minimal',
    tickFloats: false,
    showSpan: false,
    labelPlacement,
    barTextMaxWidth,
    trailingClusterPx: minimalTrailingClusterPx,
    barEndPct,
  };
}

export function timelineCountdown(
  event: Pick<GameEvent, 'done' | 'start' | 'end'>,
  now: number,
): { ended: boolean; upcoming: boolean; remainingMs: number; label: string } {
  const ended = event.end <= now;
  const upcoming = event.start > now;
  const remainingMs = upcoming ? event.start - now : event.end - now;
  const label = event.done ? 'done' : ended ? 'ended' : `${upcoming ? 'arrives' : 'ends'} ${fmtDur(remainingMs)}`;
  return { ended, upcoming, remainingMs, label };
}

/**
 * Soft hand-offs between consecutive instances of the SAME cycle, and nothing
 * else. A cycle is one recurring thing — Spiral Abyss, Imaginarium Theater — so
 * the curve says "this is that again", which a stack of unrelated bars cannot.
 *
 * The overlay measures the rendered row stack. This keeps each endpoint on the
 * true row centre as the responsive row height changes.
 */
export function buildCycleConnectorPaths(
  events: GameEvent[],
  ws: number,
  we: number,
  rowCenters: ReadonlyMap<string, number>,
  laneWidth = 1000,
  barHeights: ReadonlyMap<string, number> = new Map(),
): string[] {
  const byCycle = new Map<string, GameEvent[]>();
  events.forEach((ev) => {
    const key = cycleKey(ev);
    if (key === null) return;
    const list = byCycle.get(key) ?? [];
    list.push(ev);
    byCycle.set(key, list);
  });

  const paths: string[] = [];
  for (const instances of byCycle.values()) {
    if (instances.length < 2) continue;
    const ordered = [...instances].sort((a, b) => a.start - b.start);
    for (let i = 0; i < ordered.length - 1; i += 1) {
      const from = ordered[i]!;
      const to = ordered[i + 1]!;
      // Manual ordering must not draw bridges across other events or backwards.
      if (events.indexOf(to) !== events.indexOf(from) + 1) continue;
      // Separate playable windows must not look like one continuous event.
      if (to.start > from.end || to.start < from.end - HOUR) continue;
      const r1 = (barHeights.get(from.id) ?? 22) / 2;
      const r2 = (barHeights.get(to.id) ?? 22) / 2;
      const x1 = (barGeometry(from, ws, we).displayRight / 100) * laneWidth - r1;
      const x2 = (barGeometry(to, ws, we).displayLeft / 100) * laneWidth + r2;
      const y1 = rowCenters.get(from.id);
      const y2 = rowCenters.get(to.id);
      if (y1 === undefined || y2 === undefined) continue;
      const distance = Math.hypot(x2 - x1, y2 - y1);
      if (!Number.isFinite(distance) || distance < 1 || !(laneWidth > 0)) continue;
      const dx = (x2 - x1) / distance;
      const dy = (y2 - y1) / distance;
      // Attach inside each curved cap. Two curved sides narrow to a small
      // waist, making a filled bridge rather than an outlined connection.
      const start = { x: x1 + dx * r1 * 0.5, y: y1 + dy * r1 * 0.5 };
      const end = { x: x2 - dx * r2 * 0.5, y: y2 - dy * r2 * 0.5 };
      const middle = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
      const waist = Math.min(2.2, r1 * 0.2, r2 * 0.2);
      const pull = Math.hypot(end.x - start.x, end.y - start.y) * 0.22;
      const point = (center: { x: number; y: number }, width: number, along = 0) =>
        `${(center.x - dy * width + dx * along).toFixed(2)} ${(center.y + dx * width + dy * along).toFixed(2)}`;
      paths.push(
        [
          `M ${point(start, r1 * 0.65)}`,
          `C ${point(start, r1 * 0.65, pull)}, ${point(middle, waist, -pull)}, ${point(middle, waist)}`,
          `C ${point(middle, waist, pull)}, ${point(end, r2 * 0.65, -pull)}, ${point(end, r2 * 0.65)}`,
          `L ${point(end, -r2 * 0.65)}`,
          `C ${point(end, -r2 * 0.65, -pull)}, ${point(middle, -waist, pull)}, ${point(middle, -waist)}`,
          `C ${point(middle, -waist, -pull)}, ${point(start, -r1 * 0.65, pull)}, ${point(start, -r1 * 0.65)}`,
          'Z',
        ].join(' '),
      );
    }
  }
  return paths;
}

interface ConnectorLayout {
  height: number;
  width: number;
  rowCenters: Map<string, number>;
  barHeights: Map<string, number>;
}

export function CycleConnectors({ events, ws, we, ink }: { events: GameEvent[]; ws: number; we: number; ink: string }) {
  const inset = useInset();
  const svgRef = useRef<SVGSVGElement>(null);
  const [layout, setLayout] = useState<ConnectorLayout>({
    height: 0,
    width: 1000,
    rowCenters: new Map(),
    barHeights: new Map(),
  });
  const hasConnections = useMemo(() => {
    const counts = new Map<string, number>();
    for (const event of events) {
      const key = cycleKey(event);
      if (key === null) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.values()].some((count) => count > 1);
  }, [events]);

  useLayoutEffect(() => {
    const stack = svgRef.current?.parentElement;
    if (!stack) return;

    const rows = [...stack.querySelectorAll<HTMLElement>('[data-timeline-event-row]')];
    const measure = () => {
      const rowCenters = new Map<string, number>();
      const barHeights = new Map<string, number>();
      for (const row of rows) {
        const eventId = row.dataset.eventId;
        const bar = row.querySelector<HTMLElement>('[data-event-bar]');
        if (eventId) {
          rowCenters.set(eventId, row.offsetTop + (bar?.offsetTop ?? 0) + (bar?.offsetHeight ?? row.offsetHeight) / 2);
          barHeights.set(eventId, bar?.offsetHeight || 22);
        }
      }
      const height = stack.clientHeight;
      const width = stack.clientWidth || 1000;
      setLayout((current) => {
        const unchanged =
          current.height === height &&
          current.width === width &&
          current.rowCenters.size === rowCenters.size &&
          [...rowCenters].every(
            ([id, center]) =>
              current.rowCenters.get(id) === center && current.barHeights.get(id) === barHeights.get(id),
          );
        return unchanged ? current : { height, width, rowCenters, barHeights };
      });
    };

    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(stack);
    rows.forEach((row) => observer.observe(row));
    return () => observer.disconnect();
  }, [events]);

  const paths = buildCycleConnectorPaths(events, ws, we, layout.rowCenters, layout.width, layout.barHeights);
  if (!hasConnections) return null;

  return (
    <svg
      ref={svgRef}
      aria-hidden
      data-cycle-connectors
      className="pointer-events-none absolute inset-0 z-[1] h-full w-full"
      viewBox={`0 0 ${layout.width} ${Math.max(layout.height, 1)}`}
      preserveAspectRatio="none"
      fill="none"
    >
      {paths.map((d) => (
        <path key={d} d={d} fill={mix(ink, inset, 0.34)} />
      ))}
    </svg>
  );
}

const EventRow = memo(function EventRow({
  ev,
  game,
  ink,
  inset,
  now,
  ws,
  we,
  onOpenEvent,
  onToggleEvent,
  laneWidth,
  localTz,
  reorderHandle,
}: {
  ev: GameEvent;
  game: Game;
  /** The lane's assigned colour, so bars and lane title agree. */
  ink: string;
  /** The track colour bars are mixed against. Hex, because mix() parses hex. */
  inset: string;
  now: number;
  ws: number;
  we: number;
  onOpenEvent: (event: GameEvent) => void;
  onToggleEvent: (event: GameEvent) => void;
  /** Measured lane width in px, so the trailing furniture can be laid out. */
  laneWidth: number;
  localTz: string;
  reorderHandle?: ReactNode;
}) {
  const { displayLeft: proportionalLeft, displayWidth } = barGeometry(ev, ws, we);
  // Keep the minimum painted cap inside the lane for events at the window edge.
  const displayLeft =
    laneWidth > 0 ? Math.min(proportionalLeft, Math.max(0, 100 - (MIN_BAR_PX / laneWidth) * 100)) : proportionalLeft;
  const countdown = timelineCountdown(ev, now);
  const [countdownRef, countdownWidth] = useElementWidth();
  const { ended, remainingMs } = countdown;
  const maint = ev.type === 'maintenance';
  const banner = ev.type === 'banner';
  const cycle = ev.type === 'cycle';
  const stream = ev.type === 'livestream';
  const endColor = endTone(remainingMs);
  const tone = endColor === 'var(--color-later)' ? 'var(--color-muted)' : endColor;
  const spanLabel = `${DateTime.fromMillis(ev.start, { zone: localTz }).toFormat('dd LLL')} → ${DateTime.fromMillis(ev.end, { zone: localTz }).toFormat('dd LLL')}`;
  // Computed once so the fill and the ink chosen for it can never disagree.
  // A livestream is a one-off marker only a few hours wide, so it carries the
  // least inset of any row: at that width a pale fill vanishes into the lane.
  const barFill = stream
    ? mix(ink, inset, 0.16)
    : maint
      ? mix(ink, inset, 0.22)
      : cycle
        ? mix(ink, inset, 0.34)
        : banner
          ? mix(ink, inset, 0.28)
          : mix(ink, inset, 0.46);
  const barInk = onColor(barFill);

  // Measure the countdown when its size changes so text zoom and longer arrival
  // labels reserve their true width. ResizeObserver avoids reads on every tick.
  const { barEndPct, tickFloats, showSpan, labelPlacement, barTextMaxWidth, clusterBefore } = timelineRowLayout(
    displayLeft,
    displayWidth,
    laneWidth,
    maint || stream ? 'outside' : 'auto',
    Math.max(COUNTDOWN_PX, countdownWidth + 8),
  );

  const tick = (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onToggleEvent(ev);
      }}
      aria-label={ev.done ? `Restore ${ev.name}` : `Mark ${ev.name} done`}
      className={`pointer-events-auto flex h-5 w-5 shrink-0 items-center justify-center rounded-ui-full transition-opacity duration-(--dur-fast) motion-reduce:transition-none ${
        tickFloats ? 'absolute z-30 -translate-y-1/2' : ''
      } ${
        ev.done
          ? ''
          : 'opacity-60 hover:opacity-100 focus-visible:opacity-100 sm:opacity-0 sm:group-hover/row:opacity-100 sm:group-focus-within/row:opacity-100'
      }`}
      style={
        tickFloats
          ? {
              left: `calc(max(${barEndPct}%, ${displayLeft}% + ${MIN_BAR_PX}px) + 0.375rem)`,
              top: 'calc(var(--lane-bar-h) / 2)',
            }
          : undefined
      }
    >
      {/* The tick wears the bar's own skin — same fill, same ink border — so it
          reads as the end cap of that bar rather than a control borrowed from
          somewhere else in the app. */}
      <span
        aria-hidden
        className="flex h-full w-full items-center justify-center rounded-ui-full border text-caption font-black"
        style={{
          backgroundColor: ev.done ? 'var(--color-ok)' : barFill,
          borderColor: ink,
          color: ev.done ? 'var(--color-fg-invert)' : barInk,
        }}
      >
        ✓
      </span>
    </button>
  );

  return (
    <m.div
      variants={slideIn}
      initial="hidden"
      animate="visible"
      data-timeline-event-row
      data-event-id={ev.id}
      className="relative"
    >
      {reorderHandle}
      <div
        className={`group/row relative block h-[var(--lane-row-h)] w-full rounded-ui-lg text-left ${
          ev.done ? 'opacity-40' : ''
        }`}
      >
        <button
          type="button"
          onClick={() => onOpenEvent(ev)}
          className="absolute inset-0 z-10 rounded-ui-lg"
          aria-label={`Open ${game.name} event: ${ev.name}`}
        />
        <div className="absolute inset-x-0 top-0 h-[var(--lane-bar-h)] rounded-ui-lg border border-line-hairline bg-fill-2" />
        <ProgressBar
          variant="timeline"
          value={displayWidth / 100}
          start={displayLeft / 100}
          color={ink}
          data-event-bar
          className="absolute top-0 z-[2] flex h-[var(--lane-bar-h)] items-center overflow-hidden rounded-ui-lg border px-2"
          style={{
            backgroundColor: barFill,
            borderColor: ink,
            opacity: ended ? 0.35 : 1,
          }}
        >
          {labelPlacement === 'inside' && (
            <span
              className={`flex min-w-0 flex-1 items-center gap-1 overflow-hidden text-meta ${maint || banner ? 'font-normal' : 'font-medium'}`}
              style={{ color: barInk, maxWidth: barTextMaxWidth }}
            >
              <EventTags game={game} event={ev} inherit availableWidth={barTextMaxWidth} />
              <span data-event-title className="min-w-0 truncate">
                {ev.name}
              </span>
            </span>
          )}
          {/* An uncrowded row keeps the range where it reads best: inside the bar
              it belongs to, revealed on hover. */}
          {showSpan && (
            <span
              className="numeral pointer-events-none absolute inset-y-0 right-2 z-30 flex items-center whitespace-nowrap pl-2 text-caption uppercase opacity-0 transition-opacity duration-(--dur-fast) group-hover/row:opacity-100 group-focus-within/row:opacity-100 motion-reduce:transition-none"
              style={{ backgroundColor: barFill, color: barInk }}
            >
              {spanLabel}
            </span>
          )}
        </ProgressBar>

        {labelPlacement !== 'inside' && labelPlacement !== 'none' && (
          <span
            className={`pointer-events-none absolute top-0 z-20 flex h-[var(--lane-bar-h)] items-center overflow-hidden text-meta text-fg-soft ${
              maint || banner ? 'font-normal' : 'font-medium'
            } ${labelPlacement === 'before' ? 'justify-end text-right' : ''}`}
            style={
              labelPlacement === 'after'
                ? {
                    left: `max(${barEndPct}%, calc(${displayLeft}% + ${MIN_BAR_PX}px))`,
                    width: barTextMaxWidth,
                  }
                : {
                    left: 0,
                    width: barTextMaxWidth,
                  }
            }
          >
            <span className="flex min-w-0 items-center gap-1">
              <EventTags game={game} event={ev} inherit availableWidth={barTextMaxWidth} />
              <span data-event-title className="min-w-0 truncate">
                {ev.name}
              </span>
            </span>
          </span>
        )}

        {tickFloats && tick}

        {/* One right-anchored cluster keeps the mandatory tick and countdown from
            stacking. The tick only joins it when the measured lane needs the gap. */}
        <span
          data-event-countdown
          className="pointer-events-none absolute right-1 top-0 z-30 flex h-[var(--lane-bar-h)] items-center gap-1.5"
          style={clusterBefore ? { right: `calc(${100 - displayLeft}% + 8px)` } : undefined}
        >
          {!tickFloats && tick}
          <Tooltip content="d = days · h = hours · m = minutes">
            <span
              ref={countdownRef}
              className={`whitespace-nowrap rounded-ui-sm bg-scrim-veil px-1.5 py-px text-caption font-bold tabular-nums ${
                !ended && !ev.done && remainingMs < DAY ? 'warn-pulse' : ''
              }`}
              style={{ color: ev.done ? 'var(--color-ok)' : tone }}
            >
              {countdown.label}
            </span>
          </Tooltip>
        </span>
      </div>
    </m.div>
  );
});

/** A dedicated handle leaves event actions and normal touch scrolling intact. */
export function ReorderableEventRows({
  events,
  game,
  ...rowProps
}: {
  events: GameEvent[];
  game: Game;
  ink: string;
  inset: string;
  now: number;
  ws: number;
  we: number;
  onOpenEvent: (event: GameEvent) => void;
  onToggleEvent: (event: GameEvent) => void;
  laneWidth: number;
  localTz: string;
}) {
  const reorder = useApp((s) => s.reorderEvents);
  const container = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ id: string; pointerId: number; y: number; order: string[]; moved: boolean } | null>(null);
  const [preview, setPreview] = useState<string[] | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const ids = events.map((event) => event.id);
  const visible = preview ? preview.flatMap((id) => events.filter((event) => event.id === id)) : events;
  const commit = (order: string[], id: string) => {
    reorder(game.id, order);
    setAnnouncement(
      `${events.find((event) => event.id === id)?.name} moved to position ${order.indexOf(id) + 1} of ${order.length}.`,
    );
  };
  return (
    <div
      ref={container}
      className="timeline-rows relative flex flex-col"
      onPointerMove={(e) => {
        const drag = gesture.current;
        if (!drag || drag.pointerId !== e.pointerId || (Math.abs(e.clientY - drag.y) < 5 && !drag.moved)) return;
        drag.moved = true;
        // Read current viewport positions: the page can scroll while the pointer is held.
        // A pointer-down snapshot targets stale slots after a long drag.
        const centers = [...e.currentTarget.querySelectorAll('[data-timeline-event-row]')].map((row) => {
          const rect = row.getBoundingClientRect();
          return rect.top + rect.height / 2;
        });
        const target = centers.reduce(
          (best, center, index) => (Math.abs(center - e.clientY) < Math.abs(centers[best] - e.clientY) ? index : best),
          0,
        );
        const order = drag.order.filter((id) => id !== drag.id);
        order.splice(target, 0, drag.id);
        drag.order = order;
        setPreview(order);
      }}
      onPointerUp={(e) => {
        const drag = gesture.current;
        if (!drag || drag.pointerId !== e.pointerId) return;
        gesture.current = null;
        if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
        if (drag?.moved) commit(drag.order, drag.id);
        setPreview(null);
      }}
      onPointerCancel={(e) => {
        if (gesture.current?.pointerId !== e.pointerId) return;
        gesture.current = null;
        setPreview(null);
      }}
      onLostPointerCapture={(e) => {
        if (gesture.current?.pointerId !== e.pointerId) return;
        gesture.current = null;
        setPreview(null);
      }}
    >
      <span className="sr-only" role="status">
        {announcement}
      </span>
      <CycleConnectors events={visible} ws={rowProps.ws} we={rowProps.we} ink={rowProps.ink} />
      {visible.map((event) => (
        <EventRow
          key={event.id}
          ev={event}
          game={game}
          {...rowProps}
          reorderHandle={
            <button
              type="button"
              aria-label={`Reorder ${event.name}`}
              aria-describedby="event-reorder-help"
              title="Hold and drag to reorder. Use Arrow Up or Arrow Down with the keyboard."
              disabled={events.length < 2}
              className="absolute -left-7 top-0 z-30 flex h-[var(--lane-row-h)] w-7 touch-none select-none items-center justify-center rounded-ui-sm text-muted hover:bg-fill-2 hover:text-fg disabled:opacity-30"
              style={{ cursor: preview ? 'grabbing' : 'grab' }}
              onPointerDown={(e) => {
                if (e.button !== 0 || gesture.current) return;
                e.preventDefault();
                e.currentTarget.focus();
                container.current?.setPointerCapture(e.pointerId);
                gesture.current = {
                  id: event.id,
                  pointerId: e.pointerId,
                  y: e.clientY,
                  order: ids,
                  moved: false,
                };
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  gesture.current = null;
                  setPreview(null);
                  return;
                }
                if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
                e.preventDefault();
                const from = ids.indexOf(event.id);
                const to = from + (e.key === 'ArrowUp' ? -1 : 1);
                if (to < 0 || to >= ids.length) return;
                const order = [...ids];
                [order[from], order[to]] = [order[to], order[from]];
                commit(order, event.id);
              }}
            >
              <span aria-hidden>⠿</span>
            </button>
          }
        />
      ))}
    </div>
  );
}

export function TimelinePage({ now }: { now: number }) {
  const state = useApp((s) => s.state);
  const upsertEvent = useApp((s) => s.upsertEvent);
  const resetEventOrder = useApp((s) => s.resetEventOrder);
  const openSheet = useUI((s) => s.openSheet);
  const ground = useGround();
  const laneInset = useInset();
  const reducedMotion = useReducedMotionConfig();
  const [timelineScaleRef, timelineWidth] = useElementWidth();
  const focusedGameId = useUI((s) => s.focusedGameId);
  const [search, setSearch] = useState('');
  const [view, setView] = useState('lanes');
  const [showFinished, setShowFinished] = useState(false);
  const openEvent = useCallback(
    (event: GameEvent) => openSheet({ kind: 'event', eventId: event.id, gameId: event.gameId }),
    [openSheet],
  );
  const toggleEvent = useCallback(
    (event: GameEvent) => upsertEvent({ id: event.id, gameId: event.gameId, done: !event.done }),
    [upsertEvent],
  );

  // Lane membership and the ruler only change on the hour; the playhead below
  // animates against raw `now`. Without this the whole grid rebuilt every tick.
  const hourBucket = Math.floor(now / HOUR);
  const { games, events, eventsByGame, ticks, ws, we, span } = useMemo(() => {
    const rangeNow = now;
    const rangeDays = RANGE_DAYS;
    const rangeStart = rangeNow - (rangeDays * DAY) / 3;
    const rangeEnd = rangeStart + rangeDays * DAY;
    const rangeSpan = rangeEnd - rangeStart;
    const live = state.events.filter(
      (event) => !event.deleted && event.name.toLowerCase().includes(search.trim().toLowerCase()),
    );
    const hasFocus = state.games.some((game) => !game.deleted && game.id === focusedGameId);
    const activeGames = state.games.filter((game) => !game.deleted && (!hasFocus || game.id === focusedGameId));
    const byGame = new Map<string, GameEvent[]>(
      activeGames.map((game) => [
        game.id,
        sortTimelineEvents(
          live.filter((event) => event.gameId === game.id && event.end > rangeStart && event.start < rangeEnd),
        ),
      ]),
    );
    const gridTicks = buildGridTicks(rangeStart, rangeEnd, timelineWidth, state.settings.localTz);

    return {
      games: activeGames,
      // The searched, undeleted set the list view shows. Both views read the
      // same filter so a search can never mean two different things.
      events: live,
      eventsByGame: byGame,
      ticks: gridTicks,
      ws: rangeStart,
      we: rangeEnd,
      span: rangeSpan,
    };
    // Timeline membership and grid construction intentionally invalidate on
    // the hour bucket; the red playhead below continues to use raw `now`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hourBucket, state.events, state.games, state.settings.localTz, timelineWidth, focusedGameId, search]);

  // One pass assigns every lane a colour, so the timeline and the dashboard agree
  // and no two lanes land in the same region of hue and lightness. Without it,
  // three of the five reference games resolve to near-identical greys.
  const laneInk = useMemo(() => assignGameInks(games, ground), [games, ground]);
  const identityColors = useIdentityColors(games);

  // Lanes whose finished pile has been opened. Finished means ticked off OR
  // simply over: once an event ends there is nothing left to act on, so it stops
  // competing for the eye with the things that are still running.
  const [laneOpen, setLaneOpen] = useState<Record<string, boolean>>({});

  return (
    <Page className="timeline-page">
      {/* The lanes are the page, so the title only has to exist for the heading
          outline and the landmark audit — a visible one spent a band of vertical
          space restating the tab you already pressed. */}
      <h1 className="sr-only">Event timeline</h1>
      <p id="event-reorder-help" className="sr-only">
        Hold and drag the handle to reorder events within a game. Or focus a handle and press Arrow Up or Arrow Down.
      </p>
      <TimelineTools
        search={search}
        onSearch={setSearch}
        view={view}
        onView={setView}
        showFinished={showFinished}
        onShowFinished={setShowFinished}
      />
      <div className="timeline-caption flex min-h-5 items-center gap-3 text-caption text-muted">
        <span>
          {view === 'lanes'
            ? `${DateTime.fromMillis(ws, { zone: state.settings.localTz }).toFormat('d LLL')}–${DateTime.fromMillis(we, { zone: state.settings.localTz }).toFormat('d LLL')}`
            : 'Event list'}{' '}
          · {state.settings.localTz}
        </span>
        {search && (
          <button className="truncate text-accent-fg" onClick={() => setSearch('')} aria-label="Clear event search">
            “{search}” ×
          </button>
        )}
        {showFinished && <span>Including finished</span>}
      </div>

      {view === 'list' ? (
        <TimelineList
          games={games}
          events={events}
          now={now}
          localTz={state.settings.localTz}
          showFinished={showFinished}
          onOpenEvent={openEvent}
          onToggleEvent={toggleEvent}
        />
      ) : (
        <div data-tour="timeline" className="timeline-board relative">
          <div ref={timelineScaleRef} data-timeline-scale className="ml-7">
            <div data-timeline-ruler className="relative h-5 text-caption text-muted">
              {ticks.map((tick, index) => {
                const first = index === 0;
                const last = index === ticks.length - 1;
                const previous = ticks[index - 1];
                const showMonth = first || previous?.month !== tick.month;
                return (
                  <span
                    key={tick.toMillis()}
                    data-timeline-tick
                    className={`absolute top-0 flex h-5 flex-row items-center gap-1 ${
                      first ? 'translate-x-0' : last ? '-translate-x-full' : '-translate-x-1/2'
                    }`}
                    style={{ left: `${((tick.toMillis() - ws) / span) * 100}%` }}
                  >
                    <span className="numeral h-3 text-caption uppercase text-dim">
                      {showMonth ? tick.toFormat('LLL') : ''}
                    </span>
                    <span className="numeral text-caption text-muted">{tick.toFormat('d')}</span>
                  </span>
                );
              })}
            </div>

            <div className="relative">
              {ticks.map((tick) => (
                <div
                  key={tick.toMillis()}
                  className="timeline-grid-dotted pointer-events-none absolute inset-y-0 w-px"
                  style={{ left: `${((tick.toMillis() - ws) / span) * 100}%` }}
                />
              ))}
              <m.div
                initial={false}
                animate={{ left: `${((now - ws) / span) * 100}%` }}
                transition={{ duration: reducedMotion ? 0 : 0.6, ease: 'linear' }}
                className="pointer-events-none absolute inset-y-0 z-10 w-px bg-danger"
              >
                <span className="absolute -top-1 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-ui-full bg-danger" />
              </m.div>

              {games.length === 0 && (
                <p className="py-8 text-center text-body text-dim">
                  No events yet — add banners and events so nothing ends without you noticing.
                </p>
              )}

              {games.map((game) => {
                const colors = identityColors[game.id] ?? game;
                const evs = eventsByGame.get(game.id) ?? [];
                const open = laneOpen[game.id] ?? evs.length > 0;
                const nextEnd = [...evs]
                  .sort((a, b) => a.end - b.end)
                  .find(
                    (e) =>
                      e.end > now &&
                      !e.done &&
                      e.type !== 'maintenance' &&
                      e.type !== 'banner' &&
                      e.type !== 'livestream',
                  );
                // `now` ticks, so a row leaves the lane the moment it ends without
                // anyone having to press anything.
                const running = evs.filter((event) => !event.done && event.end > now);
                const finishedCount = evs.length - running.length;
                const shown = showFinished ? evs : running;
                const serverLabel = serverRegionLabel(game.tz, now);
                const accountLabel = game.accountLabel?.trim();
                // The lane's colour: assigned in one distinct-lanes pass, with
                // the game's own primary as the fallback. Bars, connectors and
                // the heading rule all take it from here so they cannot drift.
                const ink = laneInk[game.id] ?? colors.color;
                const rim = gameRim(colors, ground);
                return (
                  <Disclosure
                    key={game.id}
                    headingLevel={2}
                    open={open}
                    onOpenChange={(nextOpen) => setLaneOpen((current) => ({ ...current, [game.id]: nextOpen }))}
                    title={
                      <span className="flex min-w-0 items-center gap-2">
                        <GameBadge short={game.short} {...colors} />
                        <span
                          className="min-w-0 truncate text-body font-semibold"
                          style={{ fontFamily: titleFont(game.titleFont), color: gameTitleInk(colors, ground) }}
                        >
                          {game.name}
                        </span>
                        <ServerChip label={serverLabel} />
                        {accountLabel && (
                          <span className="min-w-0 max-w-[35%] shrink-0 truncate text-body font-semibold text-fg-soft">
                            {accountLabel}
                          </span>
                        )}
                        <span
                          className="h-px flex-1"
                          style={{
                            background: `linear-gradient(90deg, ${mix(rim, ground, 0.3)}, ${mix(rim, ground, 0.08)})`,
                          }}
                        />
                      </span>
                    }
                    summary={
                      !open ? (
                        <span className="numeral flex flex-col text-caption text-muted">
                          <span>
                            {running.length} {running.length === 1 ? 'event' : 'events'}
                          </span>
                          <span>
                            {nextEnd ? (
                              <span style={{ color: endTone(nextEnd.end - now) }}>
                                next ends {fmtDur(nextEnd.end - now)}
                              </span>
                            ) : (
                              'no upcoming deadline'
                            )}
                          </span>
                        </span>
                      ) : undefined
                    }
                    triggerLabel={`${open ? 'Collapse' : 'Expand'} ${game.name}, ${serverLabel}${accountLabel ? `, ${accountLabel}` : ''} lane`}
                    className="relative"
                    triggerClassName="timeline-game-heading relative z-20 rounded-ui-md px-1 transition hover:bg-fill-1"
                    contentClassName="-ml-7 pb-1 pl-7"
                  >
                    {evs.length === 0 ? (
                      <p className="py-1 text-label text-muted">Nothing in this window — import or add events.</p>
                    ) : shown.length === 0 ? (
                      <p className="py-1 text-label text-muted">
                        Nothing running — {finishedCount} finished {finishedCount === 1 ? 'event' : 'events'}. Use the
                        history button to show them.
                      </p>
                    ) : (
                      <>
                        {state.events.some(
                          (event) => event.gameId === game.id && !event.deleted && event.sort !== undefined,
                        ) && (
                          <button
                            type="button"
                            className="mb-1 text-caption text-accent-fg hover:underline"
                            onClick={() => resetEventOrder(game.id)}
                          >
                            Reset automatic order
                          </button>
                        )}
                        <ReorderableEventRows
                          events={shown}
                          game={game}
                          ink={ink}
                          inset={laneInset}
                          now={now}
                          ws={ws}
                          we={we}
                          onOpenEvent={openEvent}
                          onToggleEvent={toggleEvent}
                          laneWidth={timelineWidth}
                          localTz={state.settings.localTz}
                        />
                      </>
                    )}
                  </Disclosure>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </Page>
  );
}
