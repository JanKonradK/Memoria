import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AppState, ChecklistItem, Game, GameUrgency, Snapshot } from '@void/shared';
import { effectiveResourceKind, projectEnergy } from '@void/shared';
import { m } from 'motion/react';
import { useDerived } from '../selectors';
import { useApp, type AppStore } from '../store';
import { useUI } from '../ui-store';
import { useMediaQuery, useReducedMotion } from '../hooks';
import { cardEnter } from '../motion';

import { endTone, fmtDur, tint } from '../util';
import { EnergyRow } from './EnergyRow';
import { ProgressRing } from './ProgressRing';
import { Pill, Tick } from './primitives';
import { Tooltip } from './ui';

const CADENCE_RANK = { daily: 0, custom: 1, weekly: 2, monthly: 3 } as const;

/** Undone tasks escalate as their reset approaches: amber < 2h, pulsing red < 20 min. */
const TASK_DANGER_MS = 20 * 60_000;
const TASK_WARN_MS = 120 * 60_000;

/** Left-edge cadence tag — same shape the event strip uses, so rows share one language. */
function CadenceTag({ cadence }: { cadence: ChecklistItem['cadence'] }) {
  if (cadence === 'daily') return null;
  return <Pill>{cadence === 'custom' ? 'cycle' : cadence}</Pill>;
}

/** One green celebratory sweep when `done` flips true; skipped when reduced motion is preferred. */
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

/** Circular tick box at the right edge of a row: sweep plays, then the tick pops. */
function CompletionTick({ done, color }: { done: boolean; color: string }) {
  const { sweep, end } = useCompletionSweep(done);
  return <Tick checked={done} color={color} sweep={sweep} onSweepEnd={end} />;
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
      className="group flex min-h-11 w-full items-center gap-2 rounded-ui-md px-1.5 py-1 text-left transition hover:bg-white/5 sm:min-h-8"
      aria-label={`${item.name}: ${running ? 'restart timer' : ready ? 'timer ready — restart' : 'start timer'}`}
    >
      <CadenceTag cadence={item.cadence} />
      <span className={`min-w-0 flex-1 truncate text-body ${ready ? 'text-dim line-through' : 'text-fg-soft'}`}>
        {item.name}
      </span>
      {running && (
        <Tooltip content="d = days · h = hours · m = minutes">
          <span className="shrink-0 text-xs font-bold tabular-nums text-amber-200">{fmtDur(left)}</span>
        </Tooltip>
      )}
      {ready && <span className="shrink-0 text-xs font-bold text-emerald-300">Ready</span>}
      {running ? <Tick fraction={fraction} color={color} /> : <CompletionTick done={ready} color={color} />}
    </button>
  );
}

/**
 * A single circular tick box divided into `countTarget` pie sectors, spokes
 * from the center like a Mercedes badge (3) or BMW roundel (4). Each click
 * fills one sector clockwise from the top; a click on the full circle clears it.
 */
function CountTaskRow({ item, color, onAdvance }: { item: ChecklistItem; color: string; onAdvance: () => void }) {
  const { sweep, end } = useCompletionSweep(item.done);
  return (
    <button
      type="button"
      onClick={onAdvance}
      className="group flex min-h-11 w-full items-center gap-2 rounded-ui-md px-1.5 py-1 text-left transition hover:bg-white/5 sm:min-h-8"
      aria-label={`${item.name}: ${item.countDone} of ${item.countTarget} done${item.done ? ', complete — click to reset' : ', click to mark one more'}`}
    >
      <CadenceTag cadence={item.cadence} />
      <span
        className={`min-w-0 flex-1 truncate text-body transition ${item.done ? 'text-dim line-through' : 'text-fg-soft'}`}
      >
        {item.name}
      </span>
      {!item.done && item.countDone > 0 && (
        <span className="shrink-0 text-caption font-bold tabular-nums text-muted">
          {item.countDone}/{item.countTarget}
        </span>
      )}
      {/* No checkmark on the pie — fully filled sectors ARE the done state. */}
      <Tick
        checked={item.done}
        segments={{ current: item.countDone, total: item.countTarget }}
        color={color}
        sweep={sweep}
        onSweepEnd={end}
      />
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
      className="group flex min-h-11 w-full items-center gap-2 rounded-ui-md px-1.5 py-1 text-left transition hover:bg-white/5 sm:min-h-8"
    >
      <CadenceTag cadence={item.cadence} />
      <span
        className={`min-w-0 flex-1 truncate text-body transition ${
          item.done
            ? 'text-dim line-through'
            : danger
              ? 'warn-pulse font-bold text-rose-300'
              : warn
                ? 'text-amber-200'
                : 'text-fg-soft'
        }`}
      >
        {item.name}
      </span>
      {(danger || warn) && (
        <span className={`shrink-0 text-caption font-bold tabular-nums ${danger ? 'text-rose-300' : 'text-amber-300'}`}>
          {fmtDur(left)}
        </span>
      )}
      <CompletionTick done={item.done} color={color} />
    </button>
  );
}

/**
 * The game's running events with real deadlines, soonest first — the ONLY
 * place events appear on the card (never as checkboxes). Daily-touch events
 * always show while active; other notify-flagged events fill up to 3 extra
 * rows. Quiet version-long filler stays on the Timeline.
 */
export function EventStrip({
  game,
  events: allEvents,
  now,
  onOpenEvent,
}: {
  game: Game;
  events: AppState['events'];
  now: number;
  onOpenEvent: (eventId: string, gameId: string) => void;
}) {
  const active = allEvents
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
          onClick={() => onOpenEvent(ev.id, game.id)}
          className="flex min-h-11 w-full items-center gap-2 rounded-ui-md px-1.5 py-0.5 text-left text-label transition hover:bg-white/5 sm:min-h-8"
        >
          <Pill>{ev.type === 'cycle' ? 'cycle' : ev.type === 'banner' ? 'banner' : 'event'}</Pill>
          {ev.dailyTouch && <Pill variant="warn">daily</Pill>}
          <span className="truncate text-slate-300">{ev.name}</span>
          <Tooltip content="d = days · h = hours · m = minutes">
            <span className="ml-auto shrink-0 font-bold tabular-nums" style={{ color: endTone(ev.end - now) }}>
              {fmtDur(ev.end - now)}
            </span>
          </Tooltip>
        </button>
      ))}
    </div>
  );
}

// Cards used to end in a full-width "sleep safe" / "caps 03:40" banner after
// 20:00. It only existed for part of the day, so every card silently changed
// height in the evening — mid-session, and inside the Nexus card that animates
// its own height. The same verdict is on the hub as one line across all games,
// which is where a once-a-night check belongs.

export type GameControlActions = Pick<
  AppStore,
  'setTaskDone' | 'startTaskTimer' | 'restartTaskTimer' | 'setTaskCount' | 'setEnergy' | 'adjustEnergy'
>;

function EnergyControlRow({
  game,
  res,
  snap,
  now,
  setEnergy,
}: {
  game: Game;
  res: AppState['resources'][number];
  snap: Snapshot | undefined;
  now: number;
  setEnergy: GameControlActions['setEnergy'];
}) {
  const projection = useMemo(() => projectEnergy(res, snap, now, game), [game, now, res, snap]);
  const commit = useCallback(
    (value: number, reserve?: number) => setEnergy(res.id, value, reserve),
    [res.id, setEnergy],
  );
  return (
    <EnergyRow
      res={res}
      color={game.color}
      reserveColor={game.color2}
      proj={projection}
      reserve={projection.reserve ?? snap?.reserve}
      now={now}
      onCommit={commit}
    />
  );
}

function ResourceControls({
  game,
  state,
  snaps,
  now,
  actions,
}: {
  game: Game;
  state: AppState;
  snaps: Map<string, Snapshot>;
  now: number;
  actions: GameControlActions;
}) {
  const resources = state.resources.filter((r) => r.gameId === game.id && !r.deleted).sort((a, b) => a.sort - b.sort);
  const cardResources = resources.filter((res) => effectiveResourceKind(res) === 'regen');
  const primaryEnergy = cardResources[0];
  const quickChips = state.chips
    .filter((chip) => chip.gameId === game.id && !chip.deleted)
    .sort((a, b) => a.sort - b.sort);

  return (
    <>
      {cardResources.length > 0 && (
        <div className="mt-3.5 space-y-3">
          {cardResources.map((res) => {
            return (
              <EnergyControlRow
                key={res.id}
                game={game}
                res={res}
                snap={snaps.get(res.id)}
                now={now}
                setEnergy={actions.setEnergy}
              />
            );
          })}
        </div>
      )}
      {!game.paused && primaryEnergy && quickChips.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5" aria-label={`${game.name} quick energy adjustments`}>
          {quickChips.map((chip) => (
            <Tooltip key={chip.id} content={`${chip.delta > 0 ? '+' : ''}${chip.delta} ${primaryEnergy.name}`}>
              <button
                type="button"
                onClick={() => actions.adjustEnergy(primaryEnergy.id, chip.delta)}
                className="min-h-11 rounded-ui-lg bg-white/[0.055] px-3 py-2 text-xs font-semibold text-slate-300 ring-1 ring-white/10 transition hover:bg-white/10 hover:text-white sm:min-h-8 sm:py-1"
              >
                {chip.label}{' '}
                <span className="tabular-nums text-dim">{chip.delta > 0 ? `+${chip.delta}` : chip.delta}</span>
              </button>
            </Tooltip>
          ))}
        </div>
      )}
    </>
  );
}

function ChecklistControls({
  game,
  checklist,
  now,
  actions,
}: {
  game: Game;
  checklist: ChecklistItem[];
  now: number;
  actions: GameControlActions;
}) {
  if (game.paused || checklist.length === 0) return null;
  return (
    <div className="mt-3 space-y-0.5">
      {checklist.map((item) =>
        item.mode === 'timer' ? (
          <TimerTaskRow
            key={`${item.taskId}|${item.periodKey}`}
            item={item}
            color={game.color}
            now={now}
            onStart={() => actions.startTaskTimer(item.taskId, item.periodKey)}
            onRestart={() => actions.restartTaskTimer(item.taskId, item.periodKey)}
          />
        ) : item.mode === 'count' ? (
          <CountTaskRow
            key={`${item.taskId}|${item.periodKey}`}
            item={item}
            color={game.color}
            onAdvance={() =>
              actions.setTaskCount(
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
            onToggle={() => actions.setTaskDone(item.taskId, item.periodKey, !item.done)}
          />
        ),
      )}
    </div>
  );
}

function GameControlsHeader({
  game,
  dailies,
  onEdit,
  layout = 'card',
  trailing,
}: {
  game: Game;
  dailies: ChecklistItem[];
  onEdit: () => void;
  layout?: 'card' | 'focus';
  /** Owner-supplied control for the header's right edge (the Nexus collapse). */
  trailing?: ReactNode;
}) {
  const completed = dailies.filter((daily) => daily.done).length;
  return (
    <div className="relative z-10 flex items-center gap-3">
      <button
        type="button"
        onClick={onEdit}
        className="group/title -ml-1 min-w-0 flex-1 cursor-pointer rounded-ui-md px-1 py-0.5 text-left transition hover:bg-white/[0.045]"
        aria-label={`Edit ${game.name}`}
      >
        <div className="flex items-center gap-2.5">
          <h2
            className={`truncate ${layout === 'focus' ? 'text-4xl min-[1500px]:text-5xl' : 'text-2xl'} font-black tracking-tight text-fg transition group-hover/title:text-white`}
            style={{
              fontFamily: game.titleFont,
              textShadow: `0 0 24px ${tint(game.color, 0.55)}, 0 1px 0 rgba(0,0,0,0.4)`,
            }}
          >
            {game.name}
          </h2>
          {game.paused && (
            <Pill variant="paused" size="md">
              paused
            </Pill>
          )}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-label text-dim">
          <span className="h-[3px] w-8 rounded-ui-full" style={{ background: game.color }} />
          reset {String(game.dailyResetHour).padStart(2, '0')}:00 server
        </div>
      </button>
      {!game.paused && !game.hideProgressRing && dailies.length > 0 && (
        <ProgressRing fraction={completed / dailies.length} color={game.color}>
          {completed}/{dailies.length}
        </ProgressRing>
      )}
      {trailing}
    </div>
  );
}

/** Pure control surface shared by the regular card and the desktop focus bay. */
export function GameControlsView({
  entry,
  state,
  actions,
  now,
  layout = 'card',
  columns = 1,
  headerTrailing,
  onEditGame,
  onOpenEvent,
}: {
  entry: GameUrgency;
  state: AppState;
  actions: GameControlActions;
  now: number;
  layout?: 'card' | 'focus';
  columns?: 1 | 2;
  headerTrailing?: ReactNode;
  onEditGame: (gameId: string) => void;
  onOpenEvent: (eventId: string, gameId: string) => void;
}) {
  const { game } = entry;
  const derived = useDerived(now);
  const checklist = [...(derived.checklistByGame.get(game.id) ?? [])].sort(
    (a, b) => CADENCE_RANK[a.cadence] - CADENCE_RANK[b.cadence] || a.sort - b.sort,
  );
  const dailies = checklist.filter((item) => item.cadence === 'daily');
  const resources = <ResourceControls game={game} state={state} snaps={derived.snaps} now={now} actions={actions} />;
  const tasks = <ChecklistControls game={game} checklist={checklist} now={now} actions={actions} />;
  const events = !game.paused && !game.hideEventStrip && (
    <EventStrip game={game} events={state.events} now={now} onOpenEvent={onOpenEvent} />
  );

  return (
    <>
      <GameControlsHeader
        game={game}
        dailies={dailies}
        onEdit={() => onEditGame(game.id)}
        layout={layout}
        trailing={headerTrailing}
      />
      <div className={`relative z-10 flex flex-1 flex-col ${game.paused ? 'opacity-50' : ''}`}>
        {layout === 'focus' ? (
          <div className="focus-bay-grid grid gap-x-6 gap-y-1" data-cols={columns}>
            <div className="min-w-0">{resources}</div>
            <div className="min-w-0">
              {tasks}
              {events}
            </div>
          </div>
        ) : (
          <>
            {resources}
            {tasks}
            {events}
          </>
        )}
      </div>
    </>
  );
}

/** Store-connected adapter used by ordinary cards. */
export function GameControls({
  entry,
  now,
  layout = 'card',
}: {
  entry: GameUrgency;
  now: number;
  layout?: 'card' | 'focus';
}) {
  const state = useApp((s) => s.state);
  const setTaskDone = useApp((s) => s.setTaskDone);
  const startTaskTimer = useApp((s) => s.startTaskTimer);
  const restartTaskTimer = useApp((s) => s.restartTaskTimer);
  const setTaskCount = useApp((s) => s.setTaskCount);
  const setEnergy = useApp((s) => s.setEnergy);
  const adjustEnergy = useApp((s) => s.adjustEnergy);
  const actions = useMemo(
    () => ({ setTaskDone, startTaskTimer, restartTaskTimer, setTaskCount, setEnergy, adjustEnergy }),
    [adjustEnergy, restartTaskTimer, setEnergy, setTaskCount, setTaskDone, startTaskTimer],
  );
  const openSheet = useUI((store) => store.openSheet);
  const focusColumns = useUI((store) => store.focusColumns);
  const wideEnough = useMediaQuery('(min-width: 1500px)');
  const columns = focusColumns === 'auto' ? (wideEnough ? 2 : 1) : focusColumns === 'two' ? 2 : 1;
  return (
    <GameControlsView
      entry={entry}
      state={state}
      actions={actions}
      now={now}
      layout={layout}
      columns={columns}
      onEditGame={(gameId) => openSheet({ kind: 'game', gameId })}
      onOpenEvent={(eventId, gameId) => openSheet({ kind: 'event', eventId, gameId })}
    />
  );
}

export const GameCard = memo(function GameCard({ entry, now }: { entry: GameUrgency; now: number }) {
  const { game, next } = entry;
  const reduced = useReducedMotion();
  const urgent = !game.paused && next != null && next.at - now < 60 * 60_000;
  const pulseUrgent = urgent && !reduced;
  const cardShadows = [
    !pulseUrgent && `inset 0 0 0 1px ${tint(game.color, 0.3)}`,
    'inset 0 1px 0 rgba(255,255,255,0.07)',
    `0 0 56px -22px ${tint(game.color, 0.55)}`,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <m.div
      data-game-card={game.id}
      // No h-full: in the narrow grid the cell already stretches the card, and in
      // the Cards columns it made a lone card grow to the height of the tallest
      // column — the empty-card problem in a new place.
      className="group relative flex flex-col overflow-hidden rounded-ui-card p-4"
      variants={cardEnter}
      initial="hidden"
      animate="visible"
      style={{
        background: `linear-gradient(155deg, ${tint(game.color, 0.2)} 0%, transparent 46%), linear-gradient(335deg, ${tint(game.color2 ?? game.color, 0.13)} 0%, transparent 42%), #07060c`,
        boxShadow: cardShadows,
      }}
    >
      <div
        className="absolute inset-x-4 top-0 h-[3px] rounded-ui-full"
        style={{
          background: `linear-gradient(90deg, transparent, ${game.color}, ${game.color2 ?? game.color}, transparent)`,
        }}
      />
      {game.image && (
        <div className="pointer-events-none absolute inset-y-0 right-0 w-2/3 overflow-hidden rounded-r-ui-card">
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
      {pulseUrgent && (
        <div
          className="pulse-fade pointer-events-none absolute inset-0 rounded-ui-card"
          style={{ boxShadow: `inset 0 0 0 1px ${tint(game.color, 0.8)}, inset 0 0 24px ${tint(game.color, 0.12)}` }}
        />
      )}
      <GameControls entry={entry} now={now} />
    </m.div>
  );
});
