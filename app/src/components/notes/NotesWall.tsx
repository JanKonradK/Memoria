import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Cards in columns of their own, dealt left to right in order: a tall card
 * only lengthens its own column, never the row beside it, and a card being
 * written in never jumps to another column as it grows.
 */
export function NotesWall({
  items,
  min = 288,
  gap = 16,
  className = '',
  label,
}: {
  items: { key: string; node: ReactNode }[];
  /** The narrowest a column may be, in CSS pixels. */
  min?: number;
  gap?: number;
  className?: string;
  label?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(1);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measure = () => {
      const width = node.clientWidth;
      setColumns(Math.max(1, Math.floor((width + gap) / (min + gap))));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [min, gap]);
  const dealt = Array.from({ length: columns }, (_, column) => items.filter((_, index) => index % columns === column));
  return (
    <div
      ref={ref}
      className={`notes-wall ${className}`}
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap }}
      role={label ? 'list' : undefined}
      aria-label={label}
    >
      {dealt.map((column, index) => (
        <div key={index} role={label ? 'none' : undefined} className="notes-wall-column" style={{ gap }}>
          {column.map((item) => (
            <div key={item.key} role={label ? 'listitem' : undefined} className="notes-wall-item">
              {item.node}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
