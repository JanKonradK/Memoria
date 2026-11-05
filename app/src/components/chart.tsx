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
export function niceMax(value: number): number {
  if (value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 5, 10].find((m) => m * power >= value)!;
  return step * power;
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
