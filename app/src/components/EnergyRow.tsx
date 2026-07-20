import { useEffect, useRef, useState } from 'react';
import type { EnergyProjection, Resource } from '@technogg/shared';
import { effectiveReserveRegenMinutes, effectiveResourceKind } from '@technogg/shared';
import { useReducedMotion } from '../hooks';
import { useUI } from '../ui-store';
import { clamp, fmtClock, fmtDur, intOr, tint } from '../util';
import { ResourceIcon } from './ResourceIcon';

/** Dark secondary card accents disappear on the reserve rail; fall back to the primary accent. */
function visibleReserveAccent(primary: string, secondary?: string): string {
  if (!secondary) return primary;
  const match = /^#?([0-9a-f]{6})$/i.exec(secondary.trim());
  if (!match) return secondary;
  const rgb = parseInt(match[1]!, 16);
  const red = (rgb >> 16) & 255;
  const green = (rgb >> 8) & 255;
  const blue = rgb & 255;
  const luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
  return luminance >= 0.28 ? secondary : primary;
}

/** Hold-to-repeat: starts at 180ms, accelerates down to 40ms. */
function useHoldStep(onStep: (delta: number) => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const active = useRef(false);
  // Repeat ticks must see the handler from the latest render, not the one
  // captured when the press started, or steps after the first reuse stale drafts.
  const stepRef = useRef(onStep);
  stepRef.current = onStep;

  const clear = () => {
    active.current = false;
    if (timer.current) clearTimeout(timer.current);
    timer.current = undefined;
  };

  const tick = (delta: number, delay: number) => {
    if (!active.current) return;
    stepRef.current(delta);
    timer.current = setTimeout(() => tick(delta, Math.max(40, delay - 20)), delay);
  };

  const start = (delta: number) => {
    clear();
    active.current = true;
    stepRef.current(delta);
    timer.current = setTimeout(() => tick(delta, 160), 280);
  };

  useEffect(() => clear, []);

  return { start, clear };
}

function StepBtn({ delta, onStep, label }: { delta: number; onStep: (d: number) => void; label: string }) {
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
      // detail === 0 means a keyboard-triggered click; mouse presses are already
      // handled by mousedown (which does not suppress the trailing click event).
      onClick={(e) => {
        if (e.detail === 0) onStep(delta);
      }}
      className="flex h-9 min-w-8 items-center justify-center rounded-lg bg-white/[0.06] px-1.5 text-xs font-bold text-slate-200 ring-1 ring-white/10 transition hover:bg-white/[0.12] active:scale-90"
      aria-label={`${delta > 0 ? 'Increase' : 'Decrease'} ${label}`}
    >
      {delta > 0 ? `+${delta}` : delta}
    </button>
  );
}

function RegenBar({ pct, color, glow, reduced }: { pct: number; color: string; glow: boolean; reduced: boolean }) {
  return (
    <div
      aria-hidden
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
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            'repeating-linear-gradient(90deg, transparent 0, transparent calc(10% - 1px), rgba(10,7,19,0.55) calc(10% - 1px), rgba(10,7,19,0.55) 10%)',
        }}
      />
      {glow && !reduced && <span className="pulse-fade pointer-events-none absolute inset-0 bg-white/25" />}
    </div>
  );
}

/**
 * Resource row: regenerating energy shows a bar; counters and weekly refills use
 * the same controls without a fake regeneration bar.
 */
export function EnergyRow({
  res,
  color,
  reserveColor,
  proj,
  reserve,
  now,
  onCommit,
}: {
  res: Resource;
  color: string;
  reserveColor?: string;
  proj: EnergyProjection;
  reserve?: number;
  now: number;
  onCommit: (value: number, reserve?: number) => void;
}) {
  const reduced = useReducedMotion();
  const kind = effectiveResourceKind(res);
  const compact = kind === 'counter' || kind === 'weekly';
  const inputRef = useRef<HTMLInputElement>(null);
  const reserveInputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [reserveDraft, setReserveDraft] = useState<string | null>(null);
  const liveRef = useRef({ value: proj.value, reserve: reserve ?? 0 });
  // Commit on blur only after a real edit (dirty) that wasn't cancelled with
  // Escape; otherwise focusing a row while the projection ticks would commit
  // the stale displayed value and roll back regenerated energy.
  const mainEdit = useRef({ dirty: false, cancelled: false });
  const reserveEdit = useRef({ dirty: false, cancelled: false });
  const pinnedReserveOpen = useUI((state) => state.reserveOpen[res.id]);
  const setReserveOpen = useUI((state) => state.setReserveOpen);

  useEffect(() => {
    liveRef.current = { value: proj.value, reserve: reserve ?? 0 };
  }, [proj.value, reserve]);

  useEffect(() => {
    if (res.reserveCap <= 0 && pinnedReserveOpen !== undefined) setReserveOpen(res.id, undefined);
  }, [pinnedReserveOpen, res.id, res.reserveCap, setReserveOpen]);

  const liveValue = proj.hasSnapshot ? proj.value : null;
  const shown = draft ?? (liveValue == null ? '' : String(liveValue));

  const commit = (value: number, nextReserve = liveRef.current.reserve) => {
    const clamped = Math.min(res.cap, Math.max(0, Math.round(value)));
    onCommit(clamped, res.reserveCap > 0 ? nextReserve : undefined);
    setDraft(null);
    mainEdit.current.dirty = false;
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

  const reserveStep = (d: number) => {
    const base =
      reserveDraft != null && reserveDraft !== ''
        ? intOr(reserveDraft, liveRef.current.reserve)
        : liveRef.current.reserve;
    onCommit(liveRef.current.value, clamp(base + d, 0, res.reserveCap));
    setReserveDraft(null);
    reserveEdit.current.dirty = false;
  };

  const pct = res.cap > 0 ? Math.min(100, (proj.precise / res.cap) * 100) : 0;
  const reserveValue = reserve ?? 0;
  const reservePct = res.reserveCap > 0 ? Math.min(100, (reserveValue / res.reserveCap) * 100) : 0;
  const reserveAccent = visibleReserveAccent(color, reserveColor);
  const reserveLabel = res.reserveLabel ?? 'Reserve';
  const autoOpen = res.reserveCap > 0 && (proj.isFull || reserveValue > 0);
  const reserveIsOpen = pinnedReserveOpen ?? autoOpen;
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
  else if (proj.isFull && res.reserveCap > 0) subtitle = 'FULL';
  else if (proj.isFull) subtitle = `FULL${proj.overflow > 0 ? ` — ${proj.overflow} wasted` : ''}`;
  else if (proj.fullAt != null && proj.msToFull != null)
    subtitle = `full ${fmtClock(proj.fullAt)} · in ${fmtDur(proj.msToFull)}`;
  else subtitle = 'does not regenerate';

  let reserveSubtitle = '';
  if (res.reserveCap > 0) {
    if (reserveValue >= res.reserveCap) reserveSubtitle = 'FULL';
    else if (proj.isFull) {
      const reserveRegenMinutes = effectiveReserveRegenMinutes(res);
      const reserveFullAt = now + (res.reserveCap - reserveValue) * reserveRegenMinutes * 60_000;
      reserveSubtitle = `+1 / ${reserveRegenMinutes}m · full ${fmtClock(reserveFullAt)} · in ${fmtDur(reserveFullAt - now)}`;
    } else reserveSubtitle = `fills while ${res.name} is capped`;
  }

  return (
    <div className="group/row">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <span className="flex min-w-0 items-center gap-1.5">
          <ResourceIcon iconKey={res.icon} color={color} size={13} className="shrink-0" />
          <span className="truncate text-2xs font-semibold uppercase tracking-wider text-slate-400">{res.name}</span>
        </span>

        <span className="ml-auto flex w-full items-center justify-end gap-1 sm:w-auto">
          <StepBtn delta={-1} onStep={step} label={res.name} />
          {/* One pill: editable value + "/ cap" together inside the same box. */}
          <span
            className="flex h-9 cursor-text items-center rounded-lg bg-white/[0.07] px-2 ring-1 ring-white/10 transition focus-within:bg-white/[0.1] focus-within:ring-2"
            onMouseDown={(e) => {
              if (e.target !== inputRef.current) {
                e.preventDefault();
                inputRef.current?.focus();
              }
            }}
          >
            <input
              ref={inputRef}
              value={shown}
              placeholder="—"
              inputMode="numeric"
              onFocus={(e) => {
                mainEdit.current = { dirty: false, cancelled: false };
                setDraft(liveValue == null ? '' : String(liveValue));
                e.target.select();
              }}
              onChange={(e) => {
                mainEdit.current.dirty = true;
                setDraft(e.target.value.replace(/[^\d]/g, ''));
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  commit(intOr(shown, liveValue ?? 0));
                  inputRef.current?.blur();
                }
                if (e.key === 'Escape') {
                  mainEdit.current.cancelled = true;
                  setDraft(null);
                  inputRef.current?.blur();
                }
              }}
              onBlur={() => {
                const edit = mainEdit.current;
                if (
                  !edit.cancelled &&
                  edit.dirty &&
                  draft != null &&
                  draft !== '' &&
                  intOr(draft, -1) !== liveRef.current.value
                ) {
                  commit(intOr(draft, liveValue ?? 0));
                } else setDraft(null);
                mainEdit.current = { dirty: false, cancelled: false };
              }}
              className="bg-transparent text-right text-sm font-bold tabular-nums outline-none"
              style={{ color, width: `${Math.max(2, shown.length || 1) + 0.5}ch` }}
              aria-label={`${res.name} current value`}
            />
            <span className="pl-1 text-2xs tabular-nums text-slate-500">/ {res.cap}</span>
          </span>
          <StepBtn delta={1} onStep={step} label={res.name} />
        </span>
      </div>

      {!compact && (
        <>
          <RegenBar pct={pct} color={color} glow={glow} reduced={reduced} />

          {res.reserveCap > 0 && (
            <>
              <button
                type="button"
                aria-expanded={reserveIsOpen}
                onClick={() => setReserveOpen(res.id, !reserveIsOpen)}
                className="mt-1 w-full text-left text-2xs font-semibold tabular-nums text-slate-500 transition hover:text-slate-300"
              >
                {reserveIsOpen ? '▾' : '▸'} {reserveLabel} {reserveValue}/{res.reserveCap}
              </button>

              {reserveIsOpen && (
                <div className="mt-1.5 border-t border-white/[0.08] pt-2">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                    <span
                      className="min-w-0 flex-1 truncate text-2xs font-semibold uppercase tracking-wider"
                      style={{ color: reserveAccent }}
                    >
                      {reserveLabel}
                    </span>
                    <span className="ml-auto flex w-full items-center justify-end gap-1 sm:w-auto">
                      <StepBtn delta={-1} onStep={reserveStep} label={reserveLabel} />
                      <span
                        className="flex h-9 cursor-text items-center rounded-lg bg-white/[0.07] px-2 ring-1 ring-white/10 transition focus-within:bg-white/[0.1] focus-within:ring-2"
                        onMouseDown={(e) => {
                          if (e.target !== reserveInputRef.current) {
                            e.preventDefault();
                            reserveInputRef.current?.focus();
                          }
                        }}
                      >
                        <input
                          ref={reserveInputRef}
                          value={reserveDraft ?? String(reserveValue)}
                          inputMode="numeric"
                          onFocus={(e) => {
                            reserveEdit.current = { dirty: false, cancelled: false };
                            setReserveDraft(String(reserveValue));
                            e.target.select();
                          }}
                          onChange={(e) => {
                            reserveEdit.current.dirty = true;
                            setReserveDraft(e.target.value.replace(/[^\d]/g, ''));
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') e.currentTarget.blur();
                            if (e.key === 'Escape') {
                              reserveEdit.current.cancelled = true;
                              setReserveDraft(null);
                              e.currentTarget.blur();
                            }
                          }}
                          onBlur={() => {
                            const edit = reserveEdit.current;
                            if (!edit.cancelled && edit.dirty && reserveDraft != null && reserveDraft !== '') {
                              const next = clamp(intOr(reserveDraft, reserveValue), 0, res.reserveCap);
                              if (next !== liveRef.current.reserve) onCommit(liveRef.current.value, next);
                            }
                            setReserveDraft(null);
                            reserveEdit.current = { dirty: false, cancelled: false };
                          }}
                          className="bg-transparent text-right text-sm font-bold tabular-nums outline-none"
                          style={{
                            color: reserveAccent,
                            width: `${Math.max(2, (reserveDraft ?? String(reserveValue)).length) + 0.5}ch`,
                          }}
                          aria-label={`${reserveLabel} for ${res.name}`}
                        />
                        <span className="pl-1 text-2xs tabular-nums text-slate-500">/ {res.reserveCap}</span>
                      </span>
                      <StepBtn delta={1} onStep={reserveStep} label={reserveLabel} />
                    </span>
                  </div>
                  <RegenBar
                    pct={reservePct}
                    color={reserveAccent}
                    glow={reserveValue >= res.reserveCap}
                    reduced={reduced}
                  />
                  <div
                    className={`mt-1 text-xs tabular-nums ${
                      reserveValue >= res.reserveCap
                        ? 'font-bold text-rose-300'
                        : proj.isFull
                          ? 'text-emerald-300/90'
                          : 'text-slate-500'
                    }`}
                  >
                    {reserveSubtitle}
                  </div>
                </div>
              )}
            </>
          )}

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
