import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';
import { tint } from '../util';

export type PillVariant = 'neutral' | 'muted' | 'warn' | 'paused' | 'dark' | 'light';

const PILL_VARIANTS: Record<PillVariant, string> = {
  neutral: 'bg-white/5 text-dim',
  muted: 'bg-white/10 text-muted',
  warn: 'bg-warn/10 text-amber-300/90',
  paused: 'bg-white/10 text-muted',
  dark: 'bg-black/30 text-white/85',
  light: 'bg-black/15 text-slate-800',
};

/** Compact metadata label shared by task, event, timeline, and paused states. */
export function Pill({
  children,
  variant = 'neutral',
  size = 'sm',
  className = '',
  title,
}: {
  children: ReactNode;
  variant?: PillVariant;
  size?: 'sm' | 'md';
  className?: string;
  title?: string;
}) {
  return (
    <span
      className={`shrink-0 rounded-ui-sm font-black uppercase tracking-wider ${
        size === 'sm' ? 'px-1 text-micro' : 'px-2 py-0.5 text-caption'
      } ${PILL_VARIANTS[variant]} ${className}`}
      title={title}
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
  checked = false,
  fraction,
  segments,
  sweep = false,
  onSweepEnd,
  className = '',
}: {
  color: string;
  checked?: boolean;
  fraction?: number;
  segments?: { current: number; total: number };
  sweep?: boolean;
  onSweepEnd?: () => void;
  className?: string;
}) {
  const progress = Math.max(
    0,
    Math.min(1, fraction ?? (segments && segments.total > 0 ? segments.current / segments.total : checked ? 1 : 0)),
  );
  const segmented = segments && segments.total > 1 && segments.total <= 12;
  const progressRing = fraction != null || (segments != null && segments.total > 12);

  return (
    <span
      aria-hidden
      className={`relative flex h-5 w-5 shrink-0 items-center justify-center rounded-ui-full transition group-active:scale-75 ${className}`}
    >
      <svg className="absolute inset-0" width="20" height="20" viewBox="0 0 20 20">
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
        {!segments && !progressRing && checked && <circle cx="10" cy="10" r="9" fill={color} />}
        {!segments && !progressRing && (
          <circle
            cx="10"
            cy="10"
            r="9"
            fill="none"
            stroke={checked ? color : 'var(--tick-idle)'}
            strokeWidth="var(--tick-ring-width)"
          />
        )}
        {segments && segments.total <= 1 && segments.current > 0 && <circle cx="10" cy="10" r="9" fill={color} />}
        {segments && !progressRing && (
          <circle
            cx="10"
            cy="10"
            r="9"
            fill="none"
            stroke={checked ? color : 'var(--tick-idle)'}
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
        {checked && !segments && !sweep && (
          <path
            className="check-pop"
            d="M6 10.5L8.8 13.2 14 7"
            fill="none"
            stroke="var(--color-surface-1)"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
        {sweep && (
          <circle
            cx="10"
            cy="10"
            r="9"
            fill="none"
            stroke="var(--color-ok)"
            strokeWidth="var(--tick-progress-width)"
            strokeLinecap="round"
            strokeDasharray={TICK_CIRCUMFERENCE}
            transform="rotate(-90 10 10)"
            className="ring-sweep"
            onAnimationEnd={onSweepEnd}
          />
        )}
      </svg>
    </span>
  );
}

type ProgressBarProps = Omit<HTMLAttributes<HTMLDivElement>, 'children'> & {
  value: number;
  color: string;
  color2?: string;
  variant?: 'linear' | 'ring' | 'timeline';
  start?: number;
  size?: number;
  stroke?: number;
  glow?: boolean;
  segmented?: boolean;
  fillStyle?: CSSProperties;
  children?: ReactNode;
};

/** Linear, circular, and timeline progress share clamping, motion, tracks, and tint behavior. */
export function ProgressBar({
  value,
  color,
  color2,
  variant = 'linear',
  start = 0,
  size = 40,
  stroke = 4,
  glow = false,
  segmented = false,
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
            className="[transition:stroke-dashoffset_0.6s_ease-out] motion-reduce:transition-none"
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
    <div
      {...props}
      aria-hidden="true"
      className={`relative mt-1.5 h-3.5 overflow-hidden rounded-ui-sm bg-black/40 ring-1 ring-white/10 ${className}`}
      style={{
        boxShadow: `inset 0 1px 3px rgba(0,0,0,0.6)${glow ? `, 0 0 12px ${tint(color, 0.45)}` : ''}`,
        ...style,
      }}
    >
      <div
        className="absolute inset-y-0 left-0 overflow-hidden rounded-r-[3px] transition-[width] duration-700 ease-out motion-reduce:transition-none"
        style={{
          width: `${progress * 100}%`,
          background: `linear-gradient(180deg, ${tint(color, 0.95)} 0%, ${color} 55%, ${tint(color2 ?? color, 0.72)} 100%)`,
          ...fillStyle,
        }}
      >
        <span className="absolute inset-x-0 top-0 h-1/2 bg-white/25" />
      </div>
      {segmented && (
        <span
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              'repeating-linear-gradient(90deg, transparent 0, transparent calc(10% - 1px), rgba(10,7,19,0.55) calc(10% - 1px), rgba(10,7,19,0.55) 10%)',
          }}
        />
      )}
      {glow && <span className="pulse-fade pointer-events-none absolute inset-0 bg-white/25 motion-reduce:hidden" />}
    </div>
  );
}
