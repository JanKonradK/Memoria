import { motion, useReducedMotion } from 'framer-motion';

/** Small celebratory burst, re-fired whenever `burstKey` increments. */
export function ConfettiBurst({ burstKey, color }: { burstKey: number; color: string }) {
  const reduced = useReducedMotion();
  if (reduced || burstKey === 0) return null;
  const palette = [color, '#fbbf24', '#f472b6', '#34d399', '#818cf8'];
  const parts = Array.from({ length: 22 }, (_, i) => {
    const angle = (i / 22) * Math.PI * 2 + (burstKey % 7) * 0.3;
    const dist = 60 + ((i * 37 + burstKey * 13) % 70);
    return {
      dx: Math.cos(angle) * dist,
      dy: Math.sin(angle) * dist - 40,
      rot: ((i * 97) % 360) - 180,
      color: palette[i % palette.length]!,
      dur: 0.8 + ((i * 13) % 5) * 0.12,
    };
  });
  return (
    <div key={burstKey} className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
      {parts.map((p, i) => (
        <motion.span
          key={i}
          className="absolute h-2 w-1.5 rounded-[2px]"
          style={{ left: '50%', top: '45%', background: p.color }}
          initial={{ x: 0, y: 0, opacity: 1, scale: 1, rotate: 0 }}
          animate={{ x: p.dx, y: p.dy + 80, opacity: 0, scale: 0.4, rotate: p.rot }}
          transition={{ duration: p.dur, ease: 'easeOut' }}
        />
      ))}
    </div>
  );
}
