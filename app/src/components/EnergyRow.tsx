import { useEffect, useRef, useState } from 'react';
import type { EnergyProjection, Resource } from '@technogg/shared';
import { effectiveResourceKind } from '@technogg/shared';
import { useReducedMotion } from '../hooks';
import { fmtClock, fmtDur, intOr, tint } from '../util';
import { ResourceIcon } from './ResourceIcon';

/** Hold-to-repeat: starts at 180ms, accelerates down to 40ms. */
function useHoldStep(onStep: (delta: number) => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const active = useRef(false);

  const clear = () => {
    active.current = false;
    if (timer.current) clearTimeout(timer.current);
    timer.current = undefined;
  };

  const tick = (delta: number, delay: number) => {
    if (!active.current) return;
    onStep(delta);
    timer.current = setTimeout(() => tick(delta, Math.max(40, delay - 20)), delay);
  };

  const start = (delta: number) => {
    clear();
    active.current = true;
    onStep(delta);
    timer.current = setTimeout(() => tick(delta, 160), 280);
  };

  useEffect(() => clear, []);

  return { start, clear };
}

function StepBtn({ delta, onStep }: { delta: number; onStep: (d: number) => void }) {
  const hold = useHoldStep(onStep);
  return (
    <button
      type="button"
      onMouseDown={(e) => {
        e.preventDefault();
        hold.start(delta);
      }}
      onMouseUp={hold.clear}
      onMouseLeave={hold.clear}
      onTouchStart={(e) => {
        e.preventDefault();
        hold.start(delta);
      }}
      onTouchEnd={hold.clear}
      className="flex h-11 min-w-9 items-center justify-center rounded-lg bg-white/[0.06] px-2 text-sm font-bold text-slate-200 ring-1 ring-white/10 transition hover:bg-white/[0.12] active:scale-90 sm:h-8 sm:min-w-8"
      aria-label={`${delta > 0 ? '+' : ''}${delta}`}
    >
      {delta > 0 ? `+${delta}` : delta}
    </button>
  );
}

/**
 * Resource row: regenerating energy shows a bar; counters and weekly refills use
 * the same controls without a fake regeneration bar.
 */
export function EnergyRow({
  res,
  color,
  proj,
  reserve,
  onCommit,
}: {
  res: Resource;
  color: string;
  proj: EnergyProjection;
  reserve?: number;
  onCommit: (value: number, reserve?: number) => void;
}) {
  const reduced = useReducedMotion();
  const kind = effectiveResourceKind(res);
  const compact = kind === 'counter' || kind === 'weekly';
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [reserveDraft, setReserveDraft] = useState<string | null>(null);
  const liveRef = useRef({ value: proj.value, reserve: reserve ?? 0 });

  useEffect(() => {
    liveRef.current = { value: proj.value, reserve: reserve ?? 0 };
  }, [proj.value, reserve]);

  const liveValue = proj.hasSnapshot ? proj.value : null;
  const shown = draft ?? (liveValue == null ? '' : String(liveValue));

  const commit = (value: number, nextReserve = liveRef.current.reserve) => {
    const clamped = Math.min(res.cap, Math.max(0, Math.round(value)));
    onCommit(clamped, res.reserveCap > 0 ? nextReserve : undefined);
    setDraft(null);
  };

  const step = (d: number) => {
    const base =
      draft != null && draft !== ''
        ? intOr(draft, liveRef.current.value)
        : proj.hasSnapshot
          ? liveRef.current.value
          : 0;
    commit(base + d);
  };

  const pct = res.cap > 0 ? Math.min(100, (proj.precise / res.cap) * 100) : 0;
  const nearCap = !compact && proj.hasSnapshot && pct >= 90 && !proj.isFull;

  let subtitle = '';
  if (compact) {
    if (kind === 'weekly' && proj.weeklyResetAt != null) {
      subtitle = `refills ${fmtClock(proj.weeklyResetAt)}`;
      if (!proj.hasSnapshot) subtitle += ' · enter the current value →';
    } else if (!proj.hasSnapshot) subtitle = 'enter the current value →';
  } else if (!proj.hasSnapshot) subtitle = 'enter the current value →';
  else if (proj.isFull && res.reserveCap > 0 && reserve != null)
    subtitle = `FULL — reserve ${reserve}/${res.reserveCap}`;
  else if (proj.isFull) subtitle = `FULL${proj.overflow > 0 ? ` — ${proj.overflow} wasted` : ''}`;
  else if (proj.fullAt != null && proj.msToFull != null)
    subtitle = `full ${fmtClock(proj.fullAt)} · in ${fmtDur(proj.msToFull)}`;
  else subtitle = 'does not regenerate';

  return (
    <div className="group/row">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <span className="flex min-w-0 items-center gap-1.5">
          <ResourceIcon iconKey={res.icon} color={color} size={13} className="shrink-0" />
          <span className="truncate text-[11px] font-semibold uppercase tracking-wider text-slate-400">{res.name}</span>
        </span>

        <span className="ml-auto flex w-full items-center justify-end gap-1 sm:w-auto">
          <StepBtn delta={-1} onStep={step} />
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
              } else setDraft(null);
            }}
            className="h-11 w-14 rounded-lg bg-white/[0.07] text-center text-base font-bold tabular-nums ring-1 ring-white/10 outline-none transition focus:bg-white/[0.1] focus:ring-2 sm:h-8"
            style={{ color }}
            aria-label={`${res.name} current value`}
          />
          <StepBtn delta={1} onStep={step} />
          <span className="pl-0.5 text-xs text-slate-500">/ {res.cap}</span>
        </span>
      </div>

      {res.reserveCap > 0 && (
        <div className="mt-2 flex items-center justify-end gap-2 text-xs text-slate-400">
          <span>{res.reserveLabel ?? 'Reserve'}</span>
          <input
            value={reserveDraft ?? String(reserve ?? 0)}
            inputMode="numeric"
            onFocus={() => setReserveDraft(String(reserve ?? 0))}
            onChange={(e) => setReserveDraft(e.target.value.replace(/[^\d]/g, ''))}
            onBlur={() => {
              const next = intOr(reserveDraft ?? String(reserve ?? 0), reserve ?? 0);
              const clamped = Math.min(res.reserveCap, Math.max(0, next));
              onCommit(liveRef.current.value, clamped);
              setReserveDraft(null);
            }}
            className="h-9 w-16 rounded-lg bg-white/[0.07] text-center font-bold tabular-nums ring-1 ring-white/10 outline-none focus:ring-2 sm:h-8"
            aria-label={`${res.reserveLabel ?? 'Reserve'} for ${res.name}`}
          />
          <span>/ {res.reserveCap}</span>
        </div>
      )}

      {!compact && (
        <>
          <div
            className="relative mt-1.5 h-3.5 overflow-hidden rounded-md bg-black/40 ring-1 ring-white/10"
            style={{
              boxShadow: `inset 0 1px 3px rgba(0,0,0,0.6)${
                proj.isFull || nearCap ? `, 0 0 12px ${tint(color, 0.45)}` : ''
              }`,
            }}
          >
            <div
              className="absolute inset-y-0 left-0 overflow-hidden rounded-r-[3px] transition-[width] duration-700 ease-out motion-reduce:transition-none"
              style={{
                width: `${pct}%`,
                background: `linear-gradient(180deg, ${tint(color, 0.95)} 0%, ${color} 55%, ${tint(color, 0.72)} 100%)`,
              }}
            >
              <span className="absolute inset-x-0 top-0 h-1/2 bg-white/25" />
            </div>
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0"
              style={{
                backgroundImage:
                  'repeating-linear-gradient(90deg, transparent 0, transparent calc(10% - 1px), rgba(10,7,19,0.55) calc(10% - 1px), rgba(10,7,19,0.55) 10%)',
              }}
            />
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
        </>
      )}

      {compact && subtitle && <div className="mt-1 text-xs tabular-nums text-slate-300">{subtitle}</div>}
    </div>
  );
}
