import { motion, useReducedMotion } from 'framer-motion';
import { useRef, useState } from 'react';
import type { EnergyProjection, Resource } from '@technogg/shared';
import { fmtClock, fmtDur, intOr, tint } from '../util';
import { ResourceIcon } from './ResourceIcon';

/** Keyboard steps while the value box is focused. */
const KEYMAP: Record<string, number> = { a: -10, s: -1, d: 1, f: 10 };
const STEPS: Array<{ delta: number; hint: string }> = [
  { delta: -10, hint: 'A' },
  { delta: -1, hint: 'S' },
  { delta: 1, hint: 'D' },
  { delta: 10, hint: 'F' },
];

function StepBtn({ delta, hint, onStep }: { delta: number; hint: string; onStep: (d: number) => void }) {
  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.85 }}
      // Don't steal focus from the value box, so A/S/D/F keep working.
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => onStep(delta)}
      className="flex h-8 min-w-8 flex-col items-center justify-center rounded-lg bg-white/[0.06] px-1 leading-none ring-1 ring-white/10 transition hover:bg-white/[0.12]"
      aria-label={`${delta > 0 ? '+' : ''}${delta} (key ${hint})`}
      title={`Key: ${hint}`}
    >
      <span className="text-[10px] font-bold text-slate-200 tabular-nums">
        {delta > 0 ? `+${delta}` : delta}
      </span>
      <span className="mt-0.5 text-[7px] font-black tracking-widest text-slate-500">{hint}</span>
    </motion.button>
  );
}

/**
 * One resource on a game card: live value box (A/S/D/F + typing + steppers),
 * editable cap (Dokkan rank/event cap changes), animated fill bar.
 */
export function EnergyRow({
  res,
  color,
  proj,
  reserve,
  onCommit,
  onCapCommit,
}: {
  res: Resource;
  color: string;
  proj: EnergyProjection;
  /** Overflow reserve level (HSR), from the latest auto-imported snapshot. */
  reserve?: number;
  onCommit: (value: number) => void;
  onCapCommit: (cap: number) => void;
}) {
  const reduced = useReducedMotion();
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [capDraft, setCapDraft] = useState<string | null>(null);

  const liveValue = proj.hasSnapshot ? proj.value : null;
  const shown = draft ?? (liveValue == null ? '' : String(liveValue));

  const commit = (v: number) => {
    onCommit(Math.max(0, Math.round(v)));
    setDraft(null);
  };
  const step = (d: number) => {
    const base = draft != null && draft !== '' ? intOr(draft, liveValue ?? 0) : (liveValue ?? 0);
    commit(base + d);
  };

  const pct = res.cap > 0 ? Math.min(100, (proj.precise / res.cap) * 100) : 0;
  const nearCap = proj.hasSnapshot && pct >= 90 && !proj.isFull;

  let subtitle: string;
  if (!proj.hasSnapshot) subtitle = 'enter the current value →';
  else if (proj.isFull && res.reserveCap > 0 && reserve != null)
    subtitle = `FULL — overflowing into reserve (${reserve}/${res.reserveCap})`;
  else if (proj.isFull) subtitle = `FULL${proj.overflow > 0 ? ` — ${proj.overflow} wasted` : ' — regen wasted'}`;
  else if (proj.fullAt != null && proj.msToFull != null)
    subtitle = `full ${fmtClock(proj.fullAt)} · in ${fmtDur(proj.msToFull)}${reserve ? ` · reserve ${reserve}` : ''}`;
  else subtitle = 'does not regenerate';

  return (
    <div className="group/row">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <span className="flex min-w-0 items-center gap-1.5">
          <ResourceIcon iconKey={res.icon} color={color} size={13} className="shrink-0" />
          <span className="truncate text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            {res.name}
          </span>
        </span>

        <span className="ml-auto flex items-center gap-1">
          <StepBtn delta={STEPS[0]!.delta} hint={STEPS[0]!.hint} onStep={step} />
          <StepBtn delta={STEPS[1]!.delta} hint={STEPS[1]!.hint} onStep={step} />
          <input
            ref={inputRef}
            value={shown}
            placeholder="—"
            inputMode="numeric"
            onFocus={(e) => {
              setDraft(liveValue == null ? '' : String(liveValue));
              e.target.select();
            }}
            onChange={(e) => setDraft(e.target.value.replace(/[^\d]/g, ''))}
            onKeyDown={(e) => {
              const d = KEYMAP[e.key.toLowerCase()];
              if (d != null && !e.ctrlKey && !e.metaKey && !e.altKey) {
                e.preventDefault();
                step(d);
                return;
              }
              if (e.key === 'Enter') {
                commit(intOr(shown, liveValue ?? 0));
                inputRef.current?.blur();
              }
              if (e.key === 'Escape') {
                setDraft(null);
                inputRef.current?.blur();
              }
            }}
            onBlur={() => {
              if (draft != null && draft !== '' && intOr(draft, -1) !== liveValue) {
                commit(intOr(draft, liveValue ?? 0));
              } else {
                setDraft(null);
              }
            }}
            className="h-8 w-14 rounded-lg bg-white/[0.07] text-center text-base font-bold tabular-nums ring-1 ring-white/10 outline-none transition focus:bg-white/[0.1] focus:ring-2"
            style={{ color }}
            aria-label={`${res.name} current value (A/S/D/F to step)`}
            title="Type the value · A −10 · S −1 · D +1 · F +10 · Enter saves"
          />
          <StepBtn delta={STEPS[2]!.delta} hint={STEPS[2]!.hint} onStep={step} />
          <StepBtn delta={STEPS[3]!.delta} hint={STEPS[3]!.hint} onStep={step} />

          <span className="pl-0.5 text-xs text-slate-500">/</span>
          {capDraft == null ? (
            <button
              type="button"
              onClick={() => setCapDraft(String(res.cap))}
              className="text-xs font-semibold tabular-nums text-slate-400 underline decoration-dotted decoration-slate-600 underline-offset-2 transition hover:text-slate-200"
              title="Edit cap (changes with rank/events)"
              aria-label={`Edit ${res.name} cap`}
            >
              {res.cap}
            </button>
          ) : (
            <input
              autoFocus
              value={capDraft}
              inputMode="numeric"
              onChange={(e) => setCapDraft(e.target.value.replace(/[^\d]/g, ''))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const v = intOr(capDraft, res.cap);
                  if (v > 0) onCapCommit(v);
                  setCapDraft(null);
                }
                if (e.key === 'Escape') setCapDraft(null);
              }}
              onBlur={() => {
                const v = intOr(capDraft, res.cap);
                if (v > 0 && v !== res.cap) onCapCommit(v);
                setCapDraft(null);
              }}
              className="h-8 w-14 rounded-lg bg-white/[0.07] text-center text-xs font-bold tabular-nums ring-1 ring-white/10 outline-none focus:ring-2"
              aria-label={`${res.name} cap`}
            />
          )}
        </span>
      </div>

      {/* Game-style segmented energy bar. Every animated layer lives inside the
          clipped fill, so nothing can render past the end of the charge. */}
      <div
        className="relative mt-1.5 h-3.5 overflow-hidden rounded-md bg-black/40 ring-1 ring-white/10"
        style={{
          boxShadow: `inset 0 1px 3px rgba(0,0,0,0.6)${
            proj.isFull || nearCap ? `, 0 0 12px ${tint(color, 0.45)}` : ''
          }`,
        }}
      >
        <motion.div
          className="absolute inset-y-0 left-0 overflow-hidden rounded-r-[3px]"
          style={{ background: `linear-gradient(180deg, ${tint(color, 0.95)} 0%, ${color} 55%, ${tint(color, 0.72)} 100%)` }}
          initial={false}
          animate={{ width: `${pct}%` }}
          transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 120, damping: 26 }}
        >
          {/* glass highlight on the top half of the charge */}
          <span className="absolute inset-x-0 top-0 h-1/2 bg-white/25" />
          {/* flowing current while regenerating */}
          {!reduced && proj.hasSnapshot && pct > 8 && !proj.isFull && (
            <span
              className="absolute inset-y-0 left-0 w-1/2"
              style={{
                background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.4), transparent)',
                animation: 'energyFlow 2.6s linear infinite',
              }}
            />
          )}
          {/* bright leading edge of the charge */}
          {proj.hasSnapshot && !proj.isFull && pct > 2 && (
            <span className="absolute inset-y-0 right-0 w-[2px] bg-white/80" />
          )}
        </motion.div>

        {/* segment ticks (10 cells), drawn over the fill */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              'repeating-linear-gradient(90deg, transparent 0, transparent calc(10% - 1px), rgba(10,7,19,0.55) calc(10% - 1px), rgba(10,7,19,0.55) 10%)',
          }}
        />

        {/* fully charged: slow pulse across the whole bar */}
        {proj.isFull && !reduced && (
          <span className="pulse-fade pointer-events-none absolute inset-0 bg-white/25" />
        )}
      </div>

      <div
        className={`mt-1 text-xs tabular-nums ${
          proj.isFull ? 'font-bold text-rose-300' : nearCap ? 'text-amber-300' : 'text-slate-300'
        }`}
      >
        {subtitle}
      </div>
    </div>
  );
}
