import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';

export type PillVariant = 'neutral' | 'muted' | 'warn' | 'paused';

const PILL_VARIANTS: Record<PillVariant, string> = {
  neutral: 'bg-fill-2 text-muted',
  muted: 'bg-fill-3 text-muted',
  warn: 'bg-warn/10 text-warn-fg',
  paused: 'bg-fill-3 text-muted',
};

/**
 * Compact metadata label shared by task, event, timeline, and paused states.
 *
 * Native `title` tooltips are banned app-wide — the browser leaves them on
 * screen for seconds after the element under the cursor is gone. Use the Radix
 * `Tooltip` from ./ui when a hover hint is genuinely needed.
 */
export function Pill({
  children,
  variant = 'neutral',
  size = 'sm',
  className = '',
}: {
  children: ReactNode;
  variant?: PillVariant;
  size?: 'sm' | 'md';
  className?: string;
}) {
  return (
    <span
      className={`shrink-0 rounded-ui-sm font-black uppercase tracking-wider ${
        size === 'sm' ? 'px-1 text-caption' : 'px-2 py-0.5 text-caption'
      } ${PILL_VARIANTS[variant]} ${className}`}
    >
      {children}
    </span>
  );
}

const TICK_CENTER = 10;
const TICK_RADIUS = 9;
const TICK_CIRCUMFERENCE = 2 * Math.PI * TICK_RADIUS;

function pointOnTick(degrees: number): [number, number] {
  const radians = (degrees * Math.PI) / 180;
  return [TICK_CENTER + TICK_RADIUS * Math.cos(radians), TICK_CENTER + TICK_RADIUS * Math.sin(radians)];
}

function sectorPath(index: number, total: number): string {
  const degrees = 360 / total;
  const [x0, y0] = pointOnTick(-90 + index * degrees);
  const [x1, y1] = pointOnTick(-90 + (index + 1) * degrees);
  return `M ${TICK_CENTER} ${TICK_CENTER} L ${x0.toFixed(3)} ${y0.toFixed(3)} A ${TICK_RADIUS} ${TICK_RADIUS} 0 0 1 ${x1.toFixed(3)} ${y1.toFixed(3)} Z`;
}

/**
 * One 20px ring language for binary ticks, timer progress, and segmented counts.
 * The containing button owns the accessible label; this graphic stays decorative.
 */
export function Tick({
  color,
  danger = false,
  checked = false,
  fraction,
  segments,
  sweep = false,
  checkEnter = 'pop',
  onSweepEnd,
  className = '',
}: {
  color: string;
  danger?: boolean;
  checked?: boolean;
  fraction?: number;
  segments?: { current: number; total: number };
  sweep?: boolean;
  /**
   * How the completed face arrives. `none` matters: once the burst has played,
   * the tick must simply BE there. Re-running the pop on the next render made
   * the check animate in a second time, right after the celebration.
   */
  checkEnter?: 'burst' | 'pop' | 'none';
  onSweepEnd?: () => void;
  className?: string;
}) {
  const progress = Math.max(
    0,
    Math.min(1, fraction ?? (segments && segments.total > 0 ? segments.current / segments.total : checked ? 1 : 0)),
  );
  const segmented = segments && segments.total > 1 && segments.total <= 12;
  const progressRing = fraction != null || (segments != null && segments.total > 12);
  // Timer and large-count ticks read their state from the arc, so they never
  // get a check; everything else does the moment it is done.
  const completed = checked && !progressRing;

  return (
    <span
      aria-hidden
      className={`relative flex h-5 w-5 shrink-0 items-center justify-center rounded-ui-full transition group-active:scale-75 ${className}`}
    >
      {/* overflow-visible: the burst deliberately overshoots past the ring, and
          an SVG clips to its viewBox by default. */}
      <svg className="absolute inset-0 overflow-visible" width="20" height="20" viewBox="0 0 20 20">
        {segmented &&
          Array.from({ length: segments.total }, (_, index) => {
            const [x, y] = pointOnTick(-90 + index * (360 / segments.total));
            return (
              <line
                key={`spoke-${index}`}
                x1={TICK_CENTER}
                y1={TICK_CENTER}
                x2={x.toFixed(3)}
                y2={y.toFixed(3)}
                stroke="var(--tick-idle)"
                strokeWidth="var(--tick-spoke-width)"
              />
            );
          })}
        {segmented &&
          Array.from({ length: segments.total }, (_, index) =>
            index < segments.current ? (
              <path
                key={`sector-${index}`}
                d={sectorPath(index, segments.total)}
                fill={color}
                stroke="var(--color-surface-1)"
                strokeWidth="var(--tick-spoke-width)"
              />
            ) : null,
          )}
        {/* The completed face: the filled disc and the check as ONE group, so
            the burst scales them together. Scaling the check alone would throw a
            dark mark onto the dark card at the top of the overshoot, where there
            is no disc under it any more. Drawn for segmented counts too — a
            finished multi-step task earns the same tick as a single one. */}
        {completed && (
          <g className={checkEnter === 'none' ? undefined : checkEnter === 'burst' ? 'check-burst' : 'check-pop'}>
            <circle cx="10" cy="10" r="9" fill={color} />
            <path
              d="M6 10.5L8.8 13.2 14 7"
              fill="none"
              stroke="var(--color-surface-0)"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </g>
        )}
        {/* The outline every non-progress tick wears, segmented or not: the ring
            is the shape, and the sectors are drawn inside it. */}
        {!progressRing && (
          <circle
            cx="10"
            cy="10"
            r="9"
            fill="none"
            stroke={checked ? color : danger ? 'var(--color-danger)' : 'var(--tick-idle)'}
            strokeWidth="var(--tick-ring-width)"
          />
        )}
        {progressRing && (
          <>
            <circle cx="10" cy="10" r="9" fill="none" stroke="var(--tick-idle)" strokeWidth="var(--tick-ring-width)" />
            <circle
              cx="10"
              cy="10"
              r="9"
              fill="none"
              stroke={color}
              strokeWidth="var(--tick-progress-width)"
              strokeLinecap="round"
              strokeDasharray={TICK_CIRCUMFERENCE}
              strokeDashoffset={TICK_CIRCUMFERENCE * (1 - progress)}
              transform="rotate(-90 10 10)"
            />
          </>
        )}
      </svg>
      {sweep && (
        <span className="pointer-events-none absolute inset-0" aria-hidden>
          <span
            className="nova-wave absolute inset-0 rounded-ui-full ring-2 ring-ok"
            // The longest-running piece owns the completion callback, so the
            // sweep state clears exactly once rather than per element.
            onAnimationEnd={onSweepEnd}
          />
        </span>
      )}
    </span>
  );
}

type ProgressBarProps = Omit<HTMLAttributes<HTMLDivElement>, 'children'> & {
  value: number;
  color: string;
  variant?: 'linear' | 'ring' | 'timeline';
  start?: number;
  size?: number;
  stroke?: number;
  fillStyle?: CSSProperties;
  children?: ReactNode;
};

/** Linear, circular, and timeline progress share clamping, motion, tracks, and tint behavior. */
export function ProgressBar({
  value,
  color,
  variant = 'linear',
  start = 0,
  size = 40,
  stroke = 4,
  fillStyle,
  children,
  className = '',
  style,
  ...props
}: ProgressBarProps) {
  const progress = Math.max(0, Math.min(1, value));

  if (variant === 'ring') {
    const radius = (size - stroke) / 2;
    const circumference = 2 * Math.PI * radius;
    return (
      <div
        {...props}
        className={`relative inline-flex items-center justify-center ${className}`}
        style={{ width: size, height: size, ...style }}
      >
        <svg aria-hidden width={size} height={size} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="var(--progress-track)"
            strokeWidth={stroke}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - progress)}
            className="transition-[stroke-dashoffset] duration-(--dur-slow) ease-(--ease-out) motion-reduce:transition-none"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center text-caption font-bold text-fg-soft">
          {children}
        </div>
      </div>
    );
  }

  if (variant === 'timeline') {
    return (
      <div
        {...props}
        className={className}
        style={{ left: `${Math.max(0, Math.min(1, start)) * 100}%`, width: `${progress * 100}%`, ...style }}
      >
        {children}
      </div>
    );
  }

  return (
    <ReactorTube value={progress} tone={color} className={className} style={style} fillStyle={fillStyle} {...props} />
  );
}

/** A flat energy level. Text beside the bar carries the value and status. */
export function ReactorTube({
  value,
  tone,
  height = 4,
  className = '',
  style,
  fillStyle,
  ...props
}: Omit<HTMLAttributes<HTMLDivElement>, 'children'> & {
  value: number;
  tone: string;
  height?: number;
  fillStyle?: CSSProperties;
}) {
  return (
    <div
      {...props}
      aria-hidden="true"
      className={`relative mt-1.5 overflow-hidden rounded-ui-full bg-fill-3 ${className}`}
      style={{ height, ...style }}
    >
      <div
        className="h-full w-full origin-left rounded-ui-full transition-transform duration-(--dur-slow) ease-(--ease-out) motion-reduce:transition-none"
        style={{ transform: `scaleX(${Math.max(0, Math.min(1, value))})`, background: tone, ...fillStyle }}
      />
    </div>
  );
}
