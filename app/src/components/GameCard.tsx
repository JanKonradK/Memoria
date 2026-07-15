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
  return (
    <div className="flex min-h-11 flex-wrap items-center gap-2 rounded-lg px-1.5 py-1 sm:min-h-8">
      <span className="min-w-0 flex-1 truncate text-sm text-slate-200">{item.name}</span>
      {item.timerRunning && <span className="text-xs font-bold tabular-nums text-amber-200">{fmtDur(left)}</span>}
      {item.timerReady && !item.timerRunning && <span className="text-xs font-bold text-emerald-300">Ready</span>}
      <button
        type="button"
        onClick={item.timerRunning ? onRestart : onStart}
        className="min-h-9 rounded-lg px-3 py-1 text-xs font-bold ring-1 ring-white/15 transition hover:bg-white/10"
        style={{ color }}
      >
        {item.timerRunning ? 'Restart' : item.timerReady ? 'Restart' : 'Start'}
      </button>
    </div>
  );
}

function CountTaskRow({
  item,
  color,
  onToggleBox,
}: {
  item: ChecklistItem;
  color: string;
  onToggleBox: (index: number) => void;
}) {
  return (
    <div className="flex min-h-11 items-center gap-2 rounded-lg px-1.5 py-1 sm:min-h-8">
      <span className="min-w-0 flex-1 truncate text-sm text-slate-200">{item.name}</span>
      <div className="flex shrink-0 items-center gap-1">
        {Array.from({ length: item.countTarget }, (_, index) => {
          const checked = index < item.countDone;
          return (
            <button
              key={index}
              type="button"
              onClick={() => onToggleBox(index)}
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md transition hover:bg-white/5"
              style={{
                background: checked ? color : 'transparent',
                boxShadow: `inset 0 0 0 1.5px ${checked ? color : 'rgba(255,255,255,0.25)'}`,
              }}
              aria-label={`${item.name} run ${index + 1}${checked ? ', done' : ''}`}
              aria-pressed={checked}
            />
          );
        })}
      </div>
      <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-slate-500">weekly</span>
    </div>
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
      className="group flex min-h-11 w-full items-center gap-2.5 rounded-lg px-1.5 py-1 text-left transition hover:bg-white/5 sm:min-h-8"
    >
      <span
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md transition group-active:scale-75"
        style={{
          background: item.done ? color : 'transparent',
          boxShadow: `inset 0 0 0 1.5px ${item.done ? color : 'rgba(255,255,255,0.25)'}`,
        }}
      >
        {item.done && (
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
      </span>
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
        <span
          className="rounded bg-white/5 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-slate-500"
          title="From an event"
        >
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

/**
 * The game's running events/cycles with real deadlines, soonest first — the
 * "what do I still need to play" line on the card. Banners and quiet
 * version-long filler stay on the Timeline.
 */
function EventStrip({ game, now }: { game: Game; now: number }) {
  const state = useApp((s) => s.state);
  const openSheet = useUI((s) => s.openSheet);
  const events = state.events
    .filter(
      (e) =>
        !e.deleted &&
        !e.done &&
        e.gameId === game.id &&
        (e.type === 'event' || e.type === 'custom' || e.type === 'cycle') &&
        (e.notify || e.dailyTouch) &&
        e.start <= now &&
        e.end > now,
    )
    .sort((a, b) => a.end - b.end)
    .slice(0, 3);
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
            {ev.type === 'cycle' ? 'cycle' : 'event'}
          </span>
          <span className="truncate text-slate-300">{ev.name}</span>
          <span className="ml-auto shrink-0 font-bold tabular-nums" style={{ color: endTone(ev.end - now) }}>
            {fmtDur(ev.end - now)}
          </span>
        </button>
      ))}
    </div>
  );
}

function Chip({ text, warn, glow, title }: { text: string; warn?: boolean; glow?: boolean; title?: string }) {
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
      {text}
    </span>
  );
}

/** Passive advance-notice strip: the evening safe-to-sleep chip. */
function StatusStrip({ game, now }: { game: Game; now: number }) {
  const state = useApp((s) => s.state);
  const hour = new Date(now).getHours();
  const night = hour >= 20 || hour < 5;
  const sleep = night ? sleepCheck(state, game, state.settings.sleepHours, now) : null;
  if (!sleep) return null;

  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5">
      {sleep.caps ? (
        <Chip
          text={`caps ${fmtClock(sleep.fullAt!)}`}
          warn
          title="Energy will cap while you sleep — spend before bed"
        />
      ) : (
        <Chip text="sleep safe" glow title={`Nothing caps in the next ${state.settings.sleepHours}h`} />
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
      className="card-enter group relative overflow-hidden rounded-3xl p-4"
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
          className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/5 text-slate-400 ring-1 ring-white/10 transition hover:bg-white/10 hover:text-slate-200 sm:h-9 sm:w-9"
          aria-label={`Edit ${game.name}`}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z" />
          </svg>
        </button>
      </div>

      <div className={`relative z-10 ${game.paused ? 'opacity-50' : ''}`}>
        {cardResources.length > 0 && (
          <div className="mt-3.5 space-y-3">
            {cardResources.map((res) => (
              <EnergyRow
                key={res.id}
                res={res}
                color={game.color}
                proj={projectEnergy(res, snaps.get(res.id), now, game)}
                reserve={snaps.get(res.id)?.reserve}
                onCommit={(value, reserve) => setEnergy(res.id, value, reserve)}
              />
            ))}
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
                  onToggleBox={(index) => {
                    const checked = index < item.countDone;
                    setTaskCount(item.taskId, item.periodKey, checked ? index : index + 1);
                  }}
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

        {!game.paused && <EventStrip game={game} now={now} />}

        {!game.paused && <StatusStrip game={game} now={now} />}
      </div>
    </div>
  );
}
