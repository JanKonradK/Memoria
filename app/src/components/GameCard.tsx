import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import type { ChecklistItem, Game, GameUrgency } from '@technogg/shared';
import { checklistFor, dailyStreak, latestSnapshots, projectEnergy, sleepCheck } from '@technogg/shared';
import { useApp } from '../store';
import { useUI } from '../ui-store';
import { fmtClock, fmtDur, tint } from '../util';
import { EnergyRow } from './EnergyRow';
import { ProgressRing } from './ProgressRing';
import { ConfettiBurst } from './Confetti';

const CADENCE_RANK = { daily: 0, custom: 1, weekly: 2, monthly: 3 } as const;

/** Undone tasks escalate as their reset approaches: amber < 2h, pulsing red < 20 min. */
const TASK_DANGER_MS = 20 * 60_000;
const TASK_WARN_MS = 120 * 60_000;

function TaskRow({ item, color, now, onToggle }: { item: ChecklistItem; color: string; now: number; onToggle: () => void }) {
  const left = item.resetAt - now;
  const danger = !item.done && left < TASK_DANGER_MS;
  const warn = !item.done && !danger && left < TASK_WARN_MS;
  return (
    <button
      type="button"
      onClick={onToggle}
      className="group flex w-full items-center gap-2.5 rounded-lg px-1.5 py-1 text-left transition hover:bg-white/5"
    >
      <motion.span
        whileTap={{ scale: 0.75 }}
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md"
        style={{
          background: item.done ? color : 'transparent',
          boxShadow: `inset 0 0 0 1.5px ${item.done ? color : 'rgba(255,255,255,0.25)'}`,
        }}
      >
        <AnimatePresence>
          {item.done && (
            <motion.svg
              initial={{ scale: 0, rotate: -30 }}
              animate={{ scale: 1, rotate: 0 }}
              exit={{ scale: 0 }}
              transition={{ type: 'spring', stiffness: 500, damping: 22 }}
              width="11"
              height="11"
              viewBox="0 0 12 12"
              fill="none"
            >
              <path d="M2 6.5L4.8 9.2 10 3" stroke="#0b0f1a" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
            </motion.svg>
          )}
        </AnimatePresence>
      </motion.span>
      <span
        className={`flex-1 truncate text-sm transition ${
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
      {item.fromEvent && (
        <span className="rounded bg-white/5 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-slate-500" title="From an event">
          event
        </span>
      )}
      {item.cadence !== 'daily' && (
        <span className="rounded bg-white/5 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-slate-500">
          {item.cadence === 'custom' ? 'cycle' : item.cadence}
        </span>
      )}
    </button>
  );
}

function Chip({ icon, text, warn, glow, title }: { icon?: string; text: string; warn?: boolean; glow?: boolean; title?: string }) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ring-1 ${
        warn
          ? 'bg-amber-400/10 text-amber-200 ring-amber-300/25'
          : glow
            ? 'bg-emerald-400/10 text-emerald-200 ring-emerald-300/25'
            : 'bg-white/[0.05] text-slate-300 ring-white/10'
      }`}
    >
      {icon && <span className="text-[11px] leading-none">{icon}</span>}
      {text}
    </span>
  );
}

/**
 * Passive advance-notice strip: streak, safe-to-sleep (evenings), live
 * HoYoLAB "yet to do" chips, and the current focus goal. Informational only —
 * no schedules, no nagging.
 */
function StatusStrip({ game, now }: { game: Game; now: number }) {
  const state = useApp((s) => s.state);
  const openSheet = useUI((s) => s.openSheet);

  const status = state.statuses.find((st) => st.gameId === game.id && !st.deleted);
  const fresh = status != null && now - status.fetchedAt < 24 * 3_600_000;
  const focus = state.focus
    .filter((f) => f.gameId === game.id && !f.deleted && !f.done)
    .sort((a, b) => a.sort - b.sort)[0];
  const streak = dailyStreak(state, game, now);
  const hour = new Date(now).getHours();
  const night = hour >= 20 || hour < 5;
  const sleep = night ? sleepCheck(state, game, state.settings.sleepHours, now) : null;

  const summary = fresh ? status!.summary : null;
  const daily = summary?.daily;
  const dailyUnclaimed = daily != null && daily.done >= daily.total && !daily.claimed;
  const buildList = [
    ...new Set(
      state.teams
        .filter((t) => t.gameId === game.id && !t.deleted)
        .flatMap((t) => t.members.filter((m) => m.needsWork).map((m) => m.name)),
    ),
  ];
  const expiring = state.purchases.filter(
    (p) => p.gameId === game.id && !p.deleted && p.expiresAt - now < 3 * 86_400_000,
  );

  const hasChips = streak >= 2 || sleep != null || summary != null || expiring.length > 0;
  if (!hasChips && !focus && buildList.length === 0) return null;

  return (
    <div className="mt-3 space-y-1.5">
      {hasChips && (
        <div className="flex flex-wrap items-center gap-1.5">
          {streak >= 2 && <Chip text={`${streak}d streak`} glow title={`${streak}-day full-clear streak`} />}
          {expiring.map((p) => (
            <Chip
              key={p.id}
              text={p.expiresAt <= now ? `${p.name} expired` : `${p.name} ${fmtDur(p.expiresAt - now)}`}
              warn
              title="Purchase running out — renew on the Stats tab"
            />
          ))}
          {sleep &&
            (sleep.caps ? (
              <Chip text={`caps ${fmtClock(sleep.fullAt!)}`} warn title="Energy will cap while you sleep — spend before bed" />
            ) : (
              <Chip text="sleep safe" glow title={`Nothing caps in the next ${state.settings.sleepHours}h`} />
            ))}
          {daily && (
            <Chip
              text={dailyUnclaimed ? `dailies ${daily.done}/${daily.total} — claim!` : `dailies ${daily.done}/${daily.total}`}
              warn={dailyUnclaimed}
              title={`Dailies (imported ${fmtClock(status!.fetchedAt)})`}
            />
          )}
          {summary?.stats.map((s) => (
            <Chip key={s.label} icon="·" text={`${s.label} ${s.value}`} warn={s.urgent} title={`Imported ${fmtClock(status!.fetchedAt)}`} />
          ))}
        </div>
      )}
      {focus && (
        <button
          type="button"
          onClick={() => openSheet({ kind: 'game', gameId: game.id })}
          className="flex w-full items-center gap-1.5 truncate text-left text-[11px] text-slate-400 transition hover:text-slate-200"
          title="Current focus — click to edit"
        >
          <span className="shrink-0 text-[9px] font-black uppercase tracking-wider text-slate-500">focus</span>
          <span className="truncate">
            <span className="font-semibold" style={{ color: game.color }}>
              {focus.name}
            </span>
            {focus.note && <span className="text-slate-500"> — {focus.note}</span>}
          </span>
        </button>
      )}
      {buildList.length > 0 && (
        <button
          type="button"
          onClick={() => openSheet({ kind: 'game', gameId: game.id })}
          className="flex w-full items-center gap-1.5 truncate text-left text-[11px] text-slate-400 transition hover:text-slate-200"
          title="Team members flagged as needing building — click to edit"
        >
          <span className="shrink-0 text-[9px] font-black uppercase tracking-wider text-slate-500">build</span>
          <span className="truncate">
            <span className="font-semibold text-amber-200">{buildList.join(' · ')}</span>
          </span>
        </button>
      )}
    </div>
  );
}

export function GameCard({ entry, now }: { entry: GameUrgency; now: number }) {
  const { game, next } = entry;
  const reduced = useReducedMotion();
  const state = useApp((s) => s.state);
  const setTaskDone = useApp((s) => s.setTaskDone);
  const setEnergy = useApp((s) => s.setEnergy);
  const upsertResource = useApp((s) => s.upsertResource);
  const openSheet = useUI((s) => s.openSheet);

  const resources = state.resources
    .filter((r) => r.gameId === game.id && !r.deleted)
    .sort((a, b) => a.sort - b.sort);
  const snaps = latestSnapshots(state.snapshots);
  const checklist = [...checklistFor(state, game, now)].sort(
    (a, b) => CADENCE_RANK[a.cadence] - CADENCE_RANK[b.cadence] || a.sort - b.sort,
  );
  const dailies = checklist.filter((c) => c.cadence === 'daily');
  const allDailiesDone = dailies.length > 0 && dailies.every((d) => d.done);

  const [burst, setBurst] = useState(0);
  const prevDone = useRef(allDailiesDone);
  useEffect(() => {
    if (allDailiesDone && !prevDone.current) setBurst((k) => k + 1);
    prevDone.current = allDailiesDone;
  }, [allDailiesDone]);

  const urgent = !game.paused && next != null && next.at - now < 60 * 60_000;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 18, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.15, ease: 'easeIn' } }}
      transition={{ type: 'spring', stiffness: 320, damping: 32, mass: 0.85 }}
      className="group relative overflow-hidden rounded-3xl p-4"
      style={{
        // Each card carries its game's color: tinted corners over a near-black
        // core, hairline ring and a soft outer glow in the same hue (OLED-safe).
        background: `linear-gradient(155deg, ${tint(game.color, 0.2)} 0%, transparent 46%), linear-gradient(335deg, ${tint(game.color2 ?? game.color, 0.13)} 0%, transparent 42%), #07060c`,
        boxShadow: `inset 0 0 0 1px ${tint(game.color, 0.3)}, inset 0 1px 0 rgba(255,255,255,0.07), 0 0 56px -22px ${tint(game.color, 0.55)}`,
      }}
    >
      <div
        className="absolute inset-x-0 top-0 h-[3px]"
        style={{ background: `linear-gradient(90deg, transparent, ${game.color}, ${game.color2 ?? game.color}, transparent)` }}
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
            style={{ background: `linear-gradient(90deg, rgba(5,4,10,0.95) 6%, transparent 60%), linear-gradient(0deg, ${tint(game.color, 0.14)}, transparent 70%)` }}
          />
        </div>
      )}
      {urgent && !reduced && (
        <div
          className="pulse-fade pointer-events-none absolute inset-0 rounded-3xl"
          style={{ boxShadow: `inset 0 0 0 1.5px ${tint(game.color, 0.8)}, inset 0 0 24px ${tint(game.color, 0.12)}` }}
        />
      )}
      <ConfettiBurst burstKey={burst} color={game.color} />

      <div className="relative z-10 flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2.5">
            <h2
              className="truncate text-2xl font-black tracking-tight text-slate-50"
              style={{ textShadow: `0 0 24px ${tint(game.color, 0.55)}, 0 1px 0 rgba(0,0,0,0.4)` }}
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
        {!game.paused && dailies.length > 0 && (
          <ProgressRing fraction={dailies.filter((d) => d.done).length / dailies.length} color={game.color}>
            {dailies.filter((d) => d.done).length}/{dailies.length}
          </ProgressRing>
        )}
        <button
          type="button"
          onClick={() => openSheet({ kind: 'game', gameId: game.id })}
          className="rounded-xl bg-white/5 p-2 text-slate-400 ring-1 ring-white/10 transition hover:bg-white/10 hover:text-slate-200"
          aria-label={`Edit ${game.name}`}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z" />
          </svg>
        </button>
      </div>

      <div className={`relative z-10 ${game.paused ? 'opacity-50' : ''}`}>
        {resources.length > 0 && (
          <div className="mt-3.5 space-y-3">
            {resources.map((res) => (
              <EnergyRow
                key={res.id}
                res={res}
                color={game.color}
                proj={projectEnergy(res, snaps.get(res.id), now)}
                reserve={snaps.get(res.id)?.reserve}
                onCommit={(v) => setEnergy(res.id, v)}
                onCapCommit={(cap) => upsertResource({ id: res.id, gameId: game.id, cap })}
              />
            ))}
          </div>
        )}

        {!game.paused && checklist.length > 0 && (
          <div className="mt-3 space-y-0.5">
            {checklist.map((item) => (
              <TaskRow
                key={`${item.taskId}|${item.periodKey}`}
                item={item}
                color={game.color}
                now={now}
                onToggle={() => setTaskDone(item.taskId, item.periodKey, !item.done)}
              />
            ))}
          </div>
        )}

        {!game.paused && <StatusStrip game={game} now={now} />}

        {!game.paused && next && (
          <div className="mt-3 flex items-center gap-1.5 rounded-xl bg-white/[0.04] px-3 py-2 text-xs ring-1 ring-white/5">
            <span className="truncate text-slate-300">{next.label}</span>
            <span className="ml-auto shrink-0 font-bold tabular-nums" style={{ color: urgent ? '#fda4af' : game.color }}>
              {next.at <= now ? 'now' : fmtDur(next.at - now)}
            </span>
            {next.at > now && <span className="shrink-0 tabular-nums text-slate-500">· {fmtClock(next.at)}</span>}
          </div>
        )}
      </div>
    </motion.div>
  );
}
