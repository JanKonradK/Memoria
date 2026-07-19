import { useEffect, useRef, useState } from 'react';
import type { ChecklistItem, Game, GameUrgency } from '@technogg/shared';
import { checklistFor, effectiveResourceKind, latestSnapshots, projectEnergy, sleepCheck } from '@technogg/shared';
import { useApp } from '../store';
import { useUI } from '../ui-store';
import { useReducedMotion } from '../hooks';

import { endTone, fmtClock, fmtDur, tint } from '../util';
import { EnergyRow } from './EnergyRow';
import { ProgressRing } from './ProgressRing';

const CADENCE_RANK = { daily: 0, custom: 1, weekly: 2, monthly: 3 } as const;

/** Undone tasks escalate as their reset approaches: amber < 2h, pulsing red < 20 min. */
const TASK_DANGER_MS = 20 * 60_000;
const TASK_WARN_MS = 120 * 60_000;

/** Circumference of the r=9 circle every 20×20 control is built on. */
const RING_C = 56.549;

/** Left-edge cadence tag — same shape the event strip uses, so rows share one language. */
function CadenceTag({ cadence }: { cadence: ChecklistItem['cadence'] }) {
  if (cadence === 'daily') return null;
  return (
    <span className="shrink-0 rounded bg-white/5 px-1 text-[8px] font-black uppercase tracking-wider text-slate-500">
      {cadence === 'custom' ? 'cycle' : cadence}
    </span>
  );
}

/** One green celebratory sweep when `done` flips true; skipped under reduced motion. */
function useCompletionSweep(done: boolean): { sweep: boolean; end: () => void } {
  const reduced = useReducedMotion();
  const [sweep, setSweep] = useState(false);
  const prev = useRef(done);
  useEffect(() => {
    if (done && !prev.current && !reduced) setSweep(true);
    if (!done) setSweep(false);
    prev.current = done;
  }, [done, reduced]);
  return { sweep, end: () => setSweep(false) };
}

function SweepRing({ onEnd }: { onEnd: () => void }) {
  return (
    <svg aria-hidden className="pointer-events-none absolute inset-0" width="20" height="20" viewBox="0 0 20 20">
      <circle
        cx="10"
        cy="10"
        r="9"
        fill="none"
        stroke="#34d399"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={RING_C}
        transform="rotate(-90 10 10)"
        className="ring-sweep"
        onAnimationEnd={onEnd}
      />
    </svg>
  );
}

/** Circular tick box at the right edge of a row: sweep plays, then the tick pops. */
function CheckCircle({ done, color }: { done: boolean; color: string }) {
  const { sweep, end } = useCompletionSweep(done);
  return (
    <span
      className="relative flex h-5 w-5 shrink-0 items-center justify-center rounded-full transition group-active:scale-75"
      style={{
        background: done ? color : 'transparent',
        boxShadow: `inset 0 0 0 1.5px ${done ? color : 'rgba(255,255,255,0.25)'}`,
      }}
    >
      {done && !sweep && (
        <svg className="check-pop" width="11" height="11" viewBox="0 0 12 12" fill="none">
          <path
            d="M2 6.5L4.8 9.2 10 3"
            stroke="#0b0f1a"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
      {sweep && <SweepRing onEnd={end} />}
    </span>
  );
}

/** Progress ring for a running timer — fills clockwise as the timer completes. */
function TimerRing({ fraction, color }: { fraction: number; color: string }) {
  return (
    <svg aria-hidden width="20" height="20" viewBox="0 0 20 20" className="shrink-0">
      <circle cx="10" cy="10" r="9" fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="1.5" />
      <circle
        cx="10"
        cy="10"
        r="9"
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={RING_C}
        strokeDashoffset={RING_C * (1 - fraction)}
        transform="rotate(-90 10 10)"
      />
    </svg>
  );
}

function TimerTaskRow({
  item,
  color,
  now,
  onStart,
  onRestart,
}: {
  item: ChecklistItem;
  color: string;
  now: number;
  onStart: () => void;
  onRestart: () => void;
}) {
  const left = item.timerEndsAt != null ? item.timerEndsAt - now : 0;
  const durationMs = item.timerDurationMinutes * 60_000;
  const running = item.timerRunning;
  const ready = item.timerReady && !running;
  const fraction = running && durationMs > 0 ? Math.min(1, Math.max(0, 1 - left / durationMs)) : 0;
  return (
    <button
      type="button"
      onClick={running || ready ? onRestart : onStart}
      className="group flex min-h-11 w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left transition hover:bg-white/5 sm:min-h-8"
      aria-label={`${item.name}: ${running ? 'restart timer' : ready ? 'timer ready — restart' : 'start timer'}`}
      title={running || ready ? 'Click to restart the timer' : 'Click to start the timer'}
    >
      <CadenceTag cadence={item.cadence} />
      <span className={`min-w-0 flex-1 truncate text-sm ${ready ? 'text-slate-500 line-through' : 'text-slate-200'}`}>
        {item.name}
      </span>
      {running && <span className="shrink-0 text-xs font-bold tabular-nums text-amber-200">{fmtDur(left)}</span>}
      {ready && <span className="shrink-0 text-xs font-bold text-emerald-300">Ready</span>}
      {running ? (
        <span className="relative flex h-5 w-5 shrink-0 items-center justify-center transition group-active:scale-75">
          <TimerRing fraction={fraction} color={color} />
        </span>
      ) : (
        <CheckCircle done={ready} color={color} />
      )}
    </button>
  );
}

/**
 * A single circular tick box divided into `countTarget` pie sectors, spokes
 * from the center like a Mercedes badge (3) or BMW roundel (4). Each click
 * fills one sector clockwise from the top; a click on the full circle clears it.
 */
function SegmentedCircle({
  countDone,
  countTarget,
  done,
  color,
}: Pick<ChecklistItem, 'countDone' | 'countTarget' | 'done'> & { color: string }) {
  const c = 10;
  const r = 9;
  // Beyond ~12 sectors the pie is unreadable (and unbounded targets would mean
  // unbounded SVG elements) — degrade to a single progress arc.
  if (countTarget > 12) {
    const fraction = Math.min(1, countDone / countTarget);
    return (
      <svg aria-hidden width="20" height="20" viewBox="0 0 20 20" className="absolute inset-0">
        <circle cx={c} cy={c} r={r} fill="none" stroke="rgba(255,255,255,0.28)" strokeWidth="1.5" />
        <circle
          cx={c}
          cy={c}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={RING_C}
          strokeDashoffset={RING_C * (1 - fraction)}
          transform="rotate(-90 10 10)"
        />
      </svg>
    );
  }
  const seg = 360 / countTarget;
  const pt = (deg: number): [number, number] => {
    const rad = (deg * Math.PI) / 180;
    return [c + r * Math.cos(rad), c + r * Math.sin(rad)];
  };
  const sector = (index: number): string => {
    const [x0, y0] = pt(-90 + index * seg);
    const [x1, y1] = pt(-90 + (index + 1) * seg);
    return `M ${c} ${c} L ${x0.toFixed(3)} ${y0.toFixed(3)} A ${r} ${r} 0 0 1 ${x1.toFixed(3)} ${y1.toFixed(3)} Z`;
  };
  return (
    <svg aria-hidden width="20" height="20" viewBox="0 0 20 20" className="absolute inset-0">
      {countTarget > 1 &&
        Array.from({ length: countTarget }, (_, index) => {
          const [x, y] = pt(-90 + index * seg);
          return (
            <line
              key={index}
              x1={c}
              y1={c}
              x2={x.toFixed(3)}
              y2={y.toFixed(3)}
              stroke="rgba(255,255,255,0.28)"
              strokeWidth="1"
            />
          );
        })}
      {countTarget > 1
        ? Array.from({ length: countTarget }, (_, index) =>
            index < countDone ? (
              <path key={index} d={sector(index)} fill={color} stroke="#0b0f1a" strokeWidth="1" />
            ) : null,
          )
        : countDone > 0 && <circle cx={c} cy={c} r={r} fill={color} />}
      <circle cx={c} cy={c} r={r} fill="none" stroke={done ? color : 'rgba(255,255,255,0.28)'} strokeWidth="1.5" />
    </svg>
  );
}

function CountTaskRow({ item, color, onAdvance }: { item: ChecklistItem; color: string; onAdvance: () => void }) {
  const { sweep, end } = useCompletionSweep(item.done);
  return (
    <button
      type="button"
      onClick={onAdvance}
      className="group flex min-h-11 w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left transition hover:bg-white/5 sm:min-h-8"
      aria-label={`${item.name}: ${item.countDone} of ${item.countTarget} done${item.done ? ', complete — click to reset' : ', click to mark one more'}`}
    >
      <CadenceTag cadence={item.cadence} />
      <span
        className={`min-w-0 flex-1 truncate text-sm transition ${item.done ? 'text-slate-500 line-through' : 'text-slate-200'}`}
      >
        {item.name}
      </span>
      {!item.done && item.countDone > 0 && (
        <span className="shrink-0 text-[10px] font-bold tabular-nums text-slate-400">
          {item.countDone}/{item.countTarget}
        </span>
      )}
      {/* No checkmark on the pie — fully filled sectors ARE the done state. */}
      <span className="relative flex h-5 w-5 shrink-0 items-center justify-center transition group-active:scale-75">
        <SegmentedCircle countDone={item.countDone} countTarget={item.countTarget} done={item.done} color={color} />
        {sweep && <SweepRing onEnd={end} />}
      </span>
    </button>
  );
}

function TaskRow({
  item,
  color,
  now,
  onToggle,
}: {
  item: ChecklistItem;
  color: string;
  now: number;
  onToggle: () => void;
}) {
  const left = item.resetAt - now;
  const danger = !item.done && left < TASK_DANGER_MS;
  const warn = !item.done && !danger && left < TASK_WARN_MS;
  return (
    <button
      type="button"
      onClick={onToggle}
      className="group flex min-h-11 w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left transition hover:bg-white/5 sm:min-h-8"
    >
      <CadenceTag cadence={item.cadence} />
      <span
        className={`min-w-0 flex-1 truncate text-sm transition ${
          item.done
            ? 'text-slate-500 line-through'
            : danger
              ? 'warn-pulse font-bold text-rose-300'
              : warn
                ? 'text-amber-200'
                : 'text-slate-200'
        }`}
      >
        {item.name}
      </span>
      {(danger || warn) && (
        <span
          className={`shrink-0 text-[10px] font-bold tabular-nums ${danger ? 'text-rose-300' : 'text-amber-300'}`}
          title={`Resets in ${fmtDur(left)}`}
        >
          {fmtDur(left)}
        </span>
      )}
      <CheckCircle done={item.done} color={color} />
    </button>
  );
}

/**
 * The game's running events with real deadlines, soonest first — the ONLY
 * place events appear on the card (never as checkboxes). Daily-touch events
 * always show while active; other notify-flagged events fill up to 3 extra
 * rows. Quiet version-long filler stays on the Timeline.
 */
function EventStrip({ game, now }: { game: Game; now: number }) {
  const state = useApp((s) => s.state);
  const openSheet = useUI((s) => s.openSheet);
  const active = state.events
    .filter((e) => !e.deleted && !e.done && e.gameId === game.id && e.start <= now && e.end > now)
    .sort((a, b) => a.end - b.end);
  const events = [
    ...active.filter((e) => e.dailyTouch),
    ...active
      .filter((e) => !e.dailyTouch && e.notify && (e.type === 'event' || e.type === 'custom' || e.type === 'cycle'))
      .slice(0, 3),
  ].sort((a, b) => a.end - b.end);
  if (events.length === 0) return null;
  return (
    <div className="mt-3 space-y-0.5">
      {events.map((ev) => (
        <button
          key={ev.id}
          type="button"
          onClick={() => openSheet({ kind: 'event', eventId: ev.id, gameId: game.id })}
          className="flex min-h-11 w-full items-center gap-2 rounded-lg px-1.5 py-0.5 text-left text-[11px] transition hover:bg-white/5 sm:min-h-8"
          title={ev.notes || ev.name}
        >
          <span className="shrink-0 rounded bg-white/5 px-1 text-[8px] font-black uppercase tracking-wider text-slate-500">
            {ev.type === 'cycle' ? 'cycle' : ev.type === 'banner' ? 'banner' : 'event'}
          </span>
          {ev.dailyTouch && (
            <span
              className="shrink-0 rounded bg-amber-400/10 px-1 text-[8px] font-black uppercase tracking-wider text-amber-300/90"
              title="Needs a daily login/claim"
            >
              daily
            </span>
          )}
          <span className="truncate text-slate-300">{ev.name}</span>
          <span className="ml-auto shrink-0 font-bold tabular-nums" style={{ color: endTone(ev.end - now) }}>
            {fmtDur(ev.end - now)}
          </span>
        </button>
      ))}
    </div>
  );
}

/** Passive advance-notice banner: the evening safe-to-sleep verdict, big, at the bottom of the card. */
function StatusStrip({ game, now }: { game: Game; now: number }) {
  const state = useApp((s) => s.state);
  const hour = new Date(now).getHours();
  const night = hour >= 20 || hour < 5;
  const sleep = night ? sleepCheck(state, game, state.settings.sleepHours, now) : null;
  if (!sleep) return null;

  // mt-auto pins the banner to the card's bottom edge — every card in a grid
  // row shares its height, so all banners sit at the same distance.
  return (
    <div className="mt-auto pt-3">
      {sleep.caps ? (
        <div
          className="flex min-h-12 flex-wrap items-baseline justify-center gap-x-2 gap-y-0 rounded-2xl bg-amber-400/10 px-3 py-2.5 ring-1 ring-amber-300/25"
          title="Energy will cap while you sleep — spend before bed"
        >
          <span className="text-lg font-black uppercase tracking-wider text-amber-200 tabular-nums">
            caps {fmtClock(sleep.fullAt!)}
          </span>
          <span className="text-xs font-semibold text-amber-200/70">spend before bed</span>
        </div>
      ) : (
        <div
          className="flex min-h-12 flex-wrap items-baseline justify-center gap-x-2 gap-y-0 rounded-2xl bg-emerald-400/10 px-3 py-2.5 ring-1 ring-emerald-300/25"
          title={`Nothing caps in the next ${state.settings.sleepHours}h`}
        >
          <span className="text-lg font-black uppercase tracking-wider text-emerald-200">sleep safe</span>
          <span className="text-xs font-semibold text-emerald-200/70">
            nothing caps in {state.settings.sleepHours}h
          </span>
        </div>
      )}
    </div>
  );
}

export function GameCard({ entry, now }: { entry: GameUrgency; now: number }) {
  const { game, next } = entry;
  const reduced = useReducedMotion();
  const state = useApp((s) => s.state);
  const setTaskDone = useApp((s) => s.setTaskDone);
  const startTaskTimer = useApp((s) => s.startTaskTimer);
  const restartTaskTimer = useApp((s) => s.restartTaskTimer);
  const setTaskCount = useApp((s) => s.setTaskCount);
  const setEnergy = useApp((s) => s.setEnergy);
  const adjustEnergy = useApp((s) => s.adjustEnergy);
  const openSheet = useUI((s) => s.openSheet);

  const resources = state.resources.filter((r) => r.gameId === game.id && !r.deleted).sort((a, b) => a.sort - b.sort);
  const cardResources = resources.filter((res) => effectiveResourceKind(res) === 'regen');
  const primaryEnergy = cardResources[0];
  const quickChips = state.chips
    .filter((chip) => chip.gameId === game.id && !chip.deleted)
    .sort((a, b) => a.sort - b.sort);
  const snaps = latestSnapshots(state.snapshots);
  const checklist = [...checklistFor(state, game, now)].sort(
    (a, b) => CADENCE_RANK[a.cadence] - CADENCE_RANK[b.cadence] || a.sort - b.sort,
  );
  const dailies = checklist.filter((c) => c.cadence === 'daily');

  const urgent = !game.paused && next != null && next.at - now < 60 * 60_000;

  return (
    <div
      className="card-enter group relative flex h-full flex-col overflow-hidden rounded-3xl p-4"
      style={{
        // Each card carries its game's color: tinted corners over a near-black
        // core, hairline ring and a soft outer glow in the same hue (OLED-safe).
        background: `linear-gradient(155deg, ${tint(game.color, 0.2)} 0%, transparent 46%), linear-gradient(335deg, ${tint(game.color2 ?? game.color, 0.13)} 0%, transparent 42%), #07060c`,
        boxShadow: `inset 0 0 0 1px ${tint(game.color, 0.3)}, inset 0 1px 0 rgba(255,255,255,0.07), 0 0 56px -22px ${tint(game.color, 0.55)}`,
      }}
    >
      <div
        className="absolute inset-x-0 top-0 h-[3px]"
        style={{
          background: `linear-gradient(90deg, transparent, ${game.color}, ${game.color2 ?? game.color}, transparent)`,
        }}
      />
      {/* Character art wash: the chosen image fades in from the right edge. */}
      {game.image && (
        <div className="pointer-events-none absolute inset-y-0 right-0 w-2/3 overflow-hidden rounded-r-3xl">
          <img
            src={game.image}
            alt=""
            className="absolute right-0 top-1/2 h-[135%] max-w-none -translate-y-1/2 object-cover opacity-40 saturate-125 transition duration-500 group-hover:opacity-55"
            style={{
              WebkitMaskImage: 'linear-gradient(90deg, transparent, rgba(0,0,0,0.55) 55%, #000 100%)',
              maskImage: 'linear-gradient(90deg, transparent, rgba(0,0,0,0.55) 55%, #000 100%)',
            }}
          />
          <div
            className="absolute inset-0"
            style={{
              background: `linear-gradient(90deg, rgba(5,4,10,0.95) 6%, transparent 60%), linear-gradient(0deg, ${tint(game.color, 0.14)}, transparent 70%)`,
            }}
          />
        </div>
      )}
      {urgent && !reduced && (
        <div
          className="pulse-fade pointer-events-none absolute inset-0 rounded-3xl"
          style={{ boxShadow: `inset 0 0 0 1.5px ${tint(game.color, 0.8)}, inset 0 0 24px ${tint(game.color, 0.12)}` }}
        />
      )}

      <div className="relative z-10 flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2.5">
            <h2
              className="truncate text-2xl font-black tracking-tight text-slate-50"
              style={{
                fontFamily: game.titleFont,
                textShadow: `0 0 24px ${tint(game.color, 0.55)}, 0 1px 0 rgba(0,0,0,0.4)`,
              }}
            >
              {game.name}
            </h2>
            {game.paused && (
              <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                paused
              </span>
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-slate-500">
            <span className="h-[3px] w-8 rounded-full" style={{ background: game.color }} />
            reset {String(game.dailyResetHour).padStart(2, '0')}:00 server
          </div>
        </div>
        {!game.paused && !game.hideProgressRing && dailies.length > 0 && (
          <ProgressRing fraction={dailies.filter((d) => d.done).length / dailies.length} color={game.color}>
            {dailies.filter((d) => d.done).length}/{dailies.length}
          </ProgressRing>
        )}
        <button
          type="button"
          onClick={() => openSheet({ kind: 'game', gameId: game.id })}
          className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/5 text-slate-400 ring-1 ring-white/10 transition hover:bg-white/10 hover:text-slate-200 sm:h-9 sm:w-9"
          aria-label={`Edit ${game.name}`}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z" />
          </svg>
        </button>
      </div>

      <div className={`relative z-10 flex flex-1 flex-col ${game.paused ? 'opacity-50' : ''}`}>
        {cardResources.length > 0 && (
          <div className="mt-3.5 space-y-3">
            {cardResources.map((res) => {
              const proj = projectEnergy(res, snaps.get(res.id), now, game);
              return (
                <EnergyRow
                  key={res.id}
                  res={res}
                  color={game.color}
                  proj={proj}
                  reserve={proj.reserve ?? snaps.get(res.id)?.reserve}
                  onCommit={(value, reserve) => setEnergy(res.id, value, reserve)}
                />
              );
            })}
          </div>
        )}

        {!game.paused && primaryEnergy && quickChips.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5" aria-label={`${game.name} quick energy adjustments`}>
            {quickChips.map((chip) => (
              <button
                key={chip.id}
                type="button"
                onClick={() => adjustEnergy(primaryEnergy.id, chip.delta)}
                className="min-h-11 rounded-xl bg-white/[0.055] px-3 py-2 text-xs font-semibold text-slate-300 ring-1 ring-white/10 transition hover:bg-white/10 hover:text-white sm:min-h-8 sm:py-1"
                title={`${chip.delta > 0 ? '+' : ''}${chip.delta} ${primaryEnergy.name}`}
              >
                {chip.label}{' '}
                <span className="tabular-nums text-slate-500">{chip.delta > 0 ? `+${chip.delta}` : chip.delta}</span>
              </button>
            ))}
          </div>
        )}

        {!game.paused && checklist.length > 0 && (
          <div className="mt-3 space-y-0.5">
            {checklist.map((item) =>
              item.mode === 'timer' ? (
                <TimerTaskRow
                  key={`${item.taskId}|${item.periodKey}`}
                  item={item}
                  color={game.color}
                  now={now}
                  onStart={() => startTaskTimer(item.taskId, item.periodKey)}
                  onRestart={() => restartTaskTimer(item.taskId, item.periodKey)}
                />
              ) : item.mode === 'count' ? (
                <CountTaskRow
                  key={`${item.taskId}|${item.periodKey}`}
                  item={item}
                  color={game.color}
                  onAdvance={() =>
                    setTaskCount(
                      item.taskId,
                      item.periodKey,
                      item.done ? 0 : Math.min(item.countTarget, item.countDone + 1),
                    )
                  }
                />
              ) : (
                <TaskRow
                  key={`${item.taskId}|${item.periodKey}`}
                  item={item}
                  color={game.color}
                  now={now}
                  onToggle={() => setTaskDone(item.taskId, item.periodKey, !item.done)}
                />
              ),
            )}
          </div>
        )}

        {!game.paused && !game.hideEventStrip && <EventStrip game={game} now={now} />}

        {!game.paused && !game.hideSleepChip && <StatusStrip game={game} now={now} />}
      </div>
    </div>
  );
}
