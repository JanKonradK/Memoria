import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { RING_PATH_LENGTH, stadiumPath, sweepDasharray } from './ring-geometry';

export type RingFill = string | readonly [string, string] | readonly [string, string, string];

/**
 * The incomplete ring: a stroked outline with a visible gap.
 *
 * Stroked as an SVG path rather than a clip-path, because a clip-path cannot be
 * stroked — that limitation is what forced the previous hexagon badge into a
 * two-layer workaround.
 */
export function Ring({
  size,
  width,
  strokeWidth = 2,
  sweep = 0.75,
  stroke = 'currentColor',
  fill = 'transparent',
  track,
  dashed = false,
  glow,
  className = '',
  children,
}: {
  /** Height, and the diameter of the caps. */
  size: number;
  /**
   * Total width. A number stretches the flat edges into a stadium; `'fluid'`
   * measures the rendered box instead, which is what content-sized badges need
   * — their width depends on the label, so it cannot be known at render time.
   */
  width?: number | 'fluid';
  strokeWidth?: number;
  /** 0..1 portion of the outline that is drawn; the remainder is the gap. */
  sweep?: number;
  stroke?: RingFill;
  fill?: string;
  /** Faint full outline behind the swept arc, so the gap reads as "not yet done". */
  track?: string;
  dashed?: boolean;
  glow?: string;
  className?: string;
  children?: ReactNode;
}) {
  const gradientId = `ring-${useId().replaceAll(':', '')}`;
  const fluid = width === 'fluid';
  const hostRef = useRef<HTMLSpanElement | null>(null);
  const [measured, setMeasured] = useState(size);

  useEffect(() => {
    if (!fluid) return;
    const host = hostRef.current;
    if (!host) return;
    const sync = () => setMeasured(Math.max(size, host.getBoundingClientRect().width));
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(host);
    return () => observer.disconnect();
  }, [fluid, size]);

  const total = fluid ? measured : Math.max(typeof width === 'number' ? width : size, size);
  const inset = strokeWidth / 2;
  const outline = stadiumPath(total - strokeWidth, size - strokeWidth);
  const stops = typeof stroke === 'string' ? null : stroke;
  const strokeValue = typeof stroke === 'string' ? stroke : `url(#${gradientId})`;

  return (
    <span
      ref={hostRef}
      className={`relative inline-flex shrink-0 items-center justify-center align-middle ${className}`}
      style={fluid ? { height: size, width: '100%' } : { width: total, height: size }}
      data-ring
    >
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-visible"
        width={total}
        height={size}
        viewBox={`0 0 ${total} ${size}`}
        fill="none"
      >
        {stops && (
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
              {stops.map((color, index) => (
                <stop key={`${color}-${index}`} offset={`${(index / (stops.length - 1)) * 100}%`} stopColor={color} />
              ))}
            </linearGradient>
          </defs>
        )}
        <g transform={`translate(${inset} ${inset})`}>
          {fill !== 'transparent' && <path d={outline} fill={fill} stroke="none" />}
          {track && (
            <path
              d={outline}
              stroke={track}
              strokeWidth={strokeWidth}
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          )}
          <path
            d={outline}
            stroke={strokeValue}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            pathLength={RING_PATH_LENGTH}
            strokeDasharray={dashed ? '4 4' : sweepDasharray(sweep)}
            vectorEffect="non-scaling-stroke"
            style={glow ? ({ filter: `drop-shadow(0 0 ${size >= 40 ? 7 : 4}px ${glow})` } as CSSProperties) : undefined}
          />
        </g>
      </svg>
      <span className="relative flex items-center justify-center leading-none">{children}</span>
    </span>
  );
}
