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
      className="flex h-9 min-w-8 items-center justify-center rounded-lg bg-white/[0.06] px-1.5 text-xs font-bold text-slate-200 ring-1 ring-white/10 transition hover:bg-white/[0.12] active:scale-90 sm:h-7 sm:min-w-7"
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
  // Urgency is TIME based, not %: red when capping within 2h (or already full),
  // amber within 8h, green otherwise.
  const urgency =
    !compact && proj.hasSnapshot && res.regenMinutes > 0
      ? proj.isFull || (proj.msToFull != null && proj.msToFull < 2 * 3_600_000)
        ? 'danger'
        : proj.msToFull != null && proj.msToFull < 8 * 3_600_000
          ? 'warn'
          : 'ok'
      : null;
  const glow = proj.isFull || urgency === 'danger';

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
      {res.reserveCap > 0 && (
        <div className="mb-1 flex items-center justify-end gap-1 text-[10px] uppercase tracking-wider text-slate-500">
          <span className="truncate">{res.reserveLabel ?? 'Reserve'}</span>
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
            className="h-7 w-12 rounded-md bg-white/[0.05] text-center text-[11px] font-bold tabular-nums text-slate-300 ring-1 ring-white/10 outline-none focus:ring-2 sm:h-6"
            aria-label={`${res.reserveLabel ?? 'Reserve'} for ${res.name}`}
          />
          <span className="tabular-nums">/ {res.reserveCap}</span>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <span className="flex min-w-0 items-center gap-1.5">
          <ResourceIcon iconKey={res.icon} color={color} size={13} className="shrink-0" />
          <span className="truncate text-[11px] font-semibold uppercase tracking-wider text-slate-400">{res.name}</span>
        </span>

        <span className="ml-auto flex w-full items-center justify-end gap-1 sm:w-auto">
          <StepBtn delta={-1} onStep={step} />
          {/* One pill: editable value + "/ cap" together inside the same box. */}
          <span className="flex h-9 items-center rounded-lg bg-white/[0.07] px-2 ring-1 ring-white/10 transition focus-within:bg-white/[0.1] focus-within:ring-2 sm:h-7">
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
              className="bg-transparent text-right text-sm font-bold tabular-nums outline-none"
              style={{ color, width: `${Math.max(2, shown.length || 1) + 0.5}ch` }}
              aria-label={`${res.name} current value`}
            />
            <span className="pl-1 text-[11px] tabular-nums text-slate-500">/ {res.cap}</span>
          </span>
          <StepBtn delta={1} onStep={step} />
        </span>
      </div>

      {!compact && (
        <>
          <div
            className="relative mt-1.5 h-3.5 overflow-hidden rounded-md bg-black/40 ring-1 ring-white/10"
            style={{
              boxShadow: `inset 0 1px 3px rgba(0,0,0,0.6)${glow ? `, 0 0 12px ${tint(color, 0.45)}` : ''}`,
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
              proj.isFull
                ? 'font-bold text-rose-300'
                : urgency === 'danger'
                  ? 'text-rose-300'
                  : urgency === 'warn'
                    ? 'text-amber-300'
                    : urgency === 'ok'
                      ? 'text-emerald-300/90'
                      : 'text-slate-300'
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
