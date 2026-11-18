import type { ReactNode } from 'react';

/** Shared pieces of the Pulls page charts: number formats, axis steps, legend and tooltip. */

export const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
export const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
export const fmt = (value: number | null | undefined) =>
  value === null || value === undefined ? '—' : number.format(value);
export const signed = (value: number | null) =>
  value === null ? '—' : `${value > 0 ? '+' : value < 0 ? '−' : ''}${number.format(Math.abs(value))}`;
export const shortDate = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString(undefined, { month: 'short', year: 'numeric', timeZone: 'UTC' });

/** Round an axis maximum up to 1, 2 or 5 times a power of ten. */
/**
 * The axis ceiling: the smallest round value at or above `value` whose
 * quarters are round too, so the four gridlines read 60, 120, 180, 240 rather
 * than leaving the top half of a chart empty under a ceiling of 500.
 */
export function niceMax(value: number): number {
  if (value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  const step = [1, 1.2, 1.6, 2, 2.4, 3, 4, 5, 6, 8, 10].find((m) => m * power >= value)!;
  return Math.round(step * power * 1000) / 1000;
}

/**
 * Label positions beside the ends of several lines: each as close to its line's
 * end as it can be, at least `gap` apart, inside [top, bottom].
 */
export function spreadLabels(wanted: number[], gap: number, top: number, bottom: number): number[] {
  const order = wanted.map((y, index) => ({ y, index })).sort((a, b) => a.y - b.y);
  const placed: number[] = [];
  for (const [i, item] of order.entries()) placed[i] = Math.max(item.y, i > 0 ? placed[i - 1]! + gap : top);
  // Anything pushed past the bottom pushes the stack back up.
  for (let i = order.length - 1; i >= 0; i--)
    placed[i] = Math.min(placed[i]!, i < order.length - 1 ? placed[i + 1]! - gap : bottom);
  const result: number[] = [];
  for (const [i, item] of order.entries()) result[item.index] = placed[i]!;
  return result;
}
export const ticks = (max: number) => [0, max / 4, max / 2, (max * 3) / 4, max];
export const tickLabel = (value: number, max: number) => (max >= 10_000 ? compact.format(value) : number.format(value));

export function Legend({ items }: { items: { label: string; color: string; line?: boolean }[] }) {
  return (
    <ul className="history-legend mb-2 flex flex-wrap gap-x-4 gap-y-1 text-caption text-muted" aria-label="Legend">
      {items.map((item) => (
        <li key={item.label} className="inline-flex items-center gap-1.5">
          <span
            aria-hidden
            className={item.line ? 'history-key-line' : 'history-key-box'}
            style={{ background: item.color }}
          />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

export function ChartTip({ x, y, width, children }: { x: number; y: number; width: number; children: ReactNode }) {
  // Keep the tip inside the chart: flip to the left of the mark past the middle.
  const right = x > width / 2;
  return (
    <div
      role="status"
      className="history-tip"
      style={{ top: Math.max(y - 12, 0), ...(right ? { right: width - x + 12 } : { left: x + 12 }) }}
    >
      {children}
    </div>
  );
}
