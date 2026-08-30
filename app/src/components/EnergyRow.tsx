import { memo, useEffect, useRef, useState } from 'react';
import type { EnergyProjection, Resource } from '@memoria/shared';
import { effectiveReserveRegenMinutes, effectiveResourceKind } from '@memoria/shared';
import { useUI } from '../ui-store';
import { clamp, fmtClock, fmtDur, intOr } from '../util';
import { ProgressBar } from './primitives';

const ENERGY_STEP_KEYS: Readonly<Record<string, number>> = {
  a: -10,
  s: -1,
  d: 1,
  f: 10,
};

/** Hold-to-repeat: starts at 180ms, accelerates down to 40ms. */
function useHoldStep(onStep: (delta: number) => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const active = useRef(false);
  // Repeat ticks must see the handler from the latest render, not the one
  // captured when the press started, or steps after the first reuse stale drafts.
  const stepRef = useRef(onStep);
  useEffect(() => {
    stepRef.current = onStep;
  }, [onStep]);

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
      className="flex h-9 min-w-8 items-center justify-center rounded-ui-md bg-fill-2 px-1.5 text-meta font-bold text-fg-soft ring-1 ring-line-hairline transition hover:bg-fill-3 active:scale-90 sm:h-7 sm:min-w-7"
      aria-label={`${delta > 0 ? 'Increase' : 'Decrease'} ${label}`}
    >
      {delta > 0 ? `+${delta}` : delta}
    </button>
  );
}

/**
 * Resource row: regenerating energy shows a bar; counters and weekly refills use
 * the same controls without a fake regeneration bar.
 */
export const EnergyRow = memo(function EnergyRow({
  res,
  color,
  reserveColor,
  proj,
  reserve,
  now,
  localTz,
  onCommit,
}: {
  res: Resource;
  color: string;
  reserveColor?: string;
  proj: EnergyProjection;
  reserve?: number;
  now: number;
  localTz: string;
  onCommit: (value: number, reserve?: number) => void;
}) {
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
  const reserveAccent = reserveColor ?? color;
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
      subtitle = `refills ${fmtClock(proj.weeklyResetAt, localTz)}`;
      if (!proj.hasSnapshot) subtitle += ' · enter the current value';
    } else if (!proj.hasSnapshot) subtitle = 'enter the current value';
  } else if (!proj.hasSnapshot) subtitle = 'enter the current value';
  else if (proj.isFull && res.reserveCap > 0) subtitle = 'FULL';
  else if (proj.isFull) subtitle = `FULL${proj.overflow > 0 ? ` — ${proj.overflow} wasted` : ''}`;
  else if (proj.fullAt != null && proj.msToFull != null)
    subtitle = `full ${fmtClock(proj.fullAt, localTz)} · in ${fmtDur(proj.msToFull)}`;
  else subtitle = 'does not regenerate';

  let reserveSubtitle = '';
  if (res.reserveCap > 0) {
    if (reserveValue >= res.reserveCap) reserveSubtitle = 'FULL';
    else if (proj.isFull) {
      const reserveRegenMinutes = effectiveReserveRegenMinutes(res);
      const reserveFullAt = now + (res.reserveCap - reserveValue) * reserveRegenMinutes * 60_000;
      reserveSubtitle = `+1 / ${reserveRegenMinutes}m · full ${fmtClock(reserveFullAt, localTz)} · in ${fmtDur(reserveFullAt - now)}`;
    } else reserveSubtitle = `fills while ${res.name} is capped`;
  }

  return (
    <div className="group/row">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <span className="flex min-w-0 items-center">
          <span className="truncate text-label font-semibold uppercase tracking-wider text-muted">{res.name}</span>
        </span>

        <span className="ml-auto flex w-full items-center justify-end gap-1 sm:w-auto">
          <StepBtn delta={-1} onStep={step} label={res.name} />
          {/* One pill: editable value + "/ cap" together inside the same box. */}
          <span
            className="focus-ring-group flex h-9 cursor-text items-center rounded-ui-md bg-fill-2 px-2 ring-1 ring-line-hairline transition focus-within:bg-fill-3 sm:h-7"
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
                const delta = ENERGY_STEP_KEYS[e.key.toLowerCase()];
                if (delta !== undefined && !e.ctrlKey && !e.altKey && !e.metaKey) {
                  // Browser repeat already supplies one event per tick; a second
                  // timer here would make a held key accelerate unpredictably.
                  e.preventDefault();
                  step(delta);
                  return;
                }
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
              // The readout is the content. It used to sit at text-body, the
              // same size as every task name on the card, which left the number
              // the user opened the app to read tied for smallest-thing-on-
              // screen. Title size makes it the clear second voice after the
              // game's own name. leading-none keeps it inside the 28px pill.
              className="bg-transparent text-right text-title font-black leading-none tabular-nums outline-none"
              style={{ color, width: `${Math.max(2, shown.length || 1) + 0.5}ch` }}
              aria-label={`${res.name} current value`}
              aria-keyshortcuts="a s d f Enter Escape"
            />
            <span className="pl-1 text-label tabular-nums text-dim">/ {res.cap}</span>
          </span>
          <StepBtn delta={1} onStep={step} label={res.name} />
        </span>
      </div>

      {!compact && (
        <>
          <ProgressBar value={pct / 100} color={color} glow={glow} segmented />

          {res.reserveCap > 0 && (
            <>
              <button
                type="button"
                aria-expanded={reserveIsOpen}
                onClick={() => setReserveOpen(res.id, !reserveIsOpen)}
                className="mt-1 flex w-full items-center gap-1 text-left text-caption font-semibold tabular-nums text-dim transition hover:text-fg-soft"
              >
                <svg
                  viewBox="0 0 20 20"
                  fill="none"
                  stroke="currentColor"
                  className={`icon h-3 w-3 shrink-0 transition-transform ${reserveIsOpen ? 'rotate-90' : ''}`}
                  aria-hidden
                >
                  <path d="m7 5 5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span>
                  {reserveLabel} {reserveValue}/{res.reserveCap}
                </span>
              </button>

              {reserveIsOpen && (
                <div className="mt-1.5 border-t border-line-hairline pt-2">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                    <span
                      className="min-w-0 flex-1 truncate text-label font-semibold uppercase tracking-wider"
                      style={{ color: reserveAccent }}
                    >
                      {reserveLabel}
                    </span>
                    <span className="ml-auto flex w-full items-center justify-end gap-1 sm:w-auto">
                      <StepBtn delta={-1} onStep={reserveStep} label={reserveLabel} />
                      <span
                        className="focus-ring-group flex h-9 cursor-text items-center rounded-ui-md bg-fill-2 px-2 ring-1 ring-line-hairline transition focus-within:bg-fill-3 sm:h-7"
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
                            const delta = ENERGY_STEP_KEYS[e.key.toLowerCase()];
                            if (delta !== undefined && !e.ctrlKey && !e.altKey && !e.metaKey) {
                              e.preventDefault();
                              reserveStep(delta);
                              return;
                            }
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
                          className="bg-transparent text-right text-body font-bold tabular-nums outline-none"
                          style={{
                            color: reserveAccent,
                            width: `${Math.max(2, (reserveDraft ?? String(reserveValue)).length) + 0.5}ch`,
                          }}
                          aria-label={`${reserveLabel} for ${res.name}`}
                          aria-keyshortcuts="a s d f Enter Escape"
                        />
                        <span className="pl-1 text-label tabular-nums text-dim">/ {res.reserveCap}</span>
                      </span>
                      <StepBtn delta={1} onStep={reserveStep} label={reserveLabel} />
                    </span>
                  </div>
                  <ProgressBar
                    value={reservePct / 100}
                    color={reserveAccent}
                    glow={reserveValue >= res.reserveCap}
                    segmented
                  />
                  <div
                    className={`mt-1 text-meta tabular-nums ${
                      reserveValue >= res.reserveCap
                        ? 'font-bold text-danger-fg'
                        : proj.isFull
                          ? 'text-ok-fg'
                          : 'text-dim'
                    }`}
                  >
                    {reserveSubtitle}
                  </div>
                </div>
              )}
            </>
          )}

          <div
            className={`mt-1 text-meta tabular-nums ${
              proj.isFull
                ? 'font-bold text-danger-fg'
                : urgency === 'danger'
                  ? 'text-danger-fg'
                  : urgency === 'warn'
                    ? 'text-warn-fg'
                    : urgency === 'ok'
                      ? 'text-ok-fg'
                      : 'text-fg-soft'
            }`}
          >
            {subtitle}
          </div>
        </>
      )}

      {compact && subtitle && <div className="mt-1 text-meta tabular-nums text-fg-soft">{subtitle}</div>}
    </div>
  );
});
