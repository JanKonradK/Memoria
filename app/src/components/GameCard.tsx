import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AppState, ChecklistItem, Game, GameUrgency, Snapshot } from '@memoria/shared';
import { effectiveResourceKind, projectEnergy } from '@memoria/shared';
import { m } from 'motion/react';
import { useDerived } from '../selectors';
import { useApp, type AppStore } from '../store';
import { useUI } from '../ui-store';
import { useMediaQuery, useReducedMotion } from '../hooks';
import { cardEnter } from '../motion';
import { gameAccent, gameInk, gameRim, gameSupport, gameTitleInk, mix, resolveGameIdentityColors } from '../game-color';
import { gameShellVars, useGround, useTheme } from '../theme';

import { endTone, fmtDur, localResetLabel, tint } from '../util';
import { EnergyRow } from './EnergyRow';
import { Pill, ProgressBar, Tick } from './primitives';
import { Tooltip } from './ui';
import { serverRegionLabel } from './NexusLayout';

const CADENCE_RANK = { daily: 0, custom: 1, weekly: 2, monthly: 3 } as const;

/** Undone tasks escalate as their reset approaches: amber < 2h, pulsing red < 20 min. */
const TASK_DANGER_MS = 20 * 60_000;
const TASK_WARN_MS = 120 * 60_000;

/** Left-edge cadence tag — same shape the event strip uses, so rows share one language. */
function CadenceTag({ cadence }: { cadence: ChecklistItem['cadence'] }) {
  if (cadence === 'daily') return null;
  return <Pill>{cadence === 'custom' ? 'cycle' : cadence}</Pill>;
}

/** Duration of the completion burst in index.css, plus headroom for the fallback. */
const SWEEP_TIMEOUT_MS = 1200;

/** One completion burst when `done` flips true; skipped when reduced motion is preferred. */
function useCompletionSweep(done: boolean): {
  sweep: boolean;
  checkEnter: 'burst' | 'pop' | 'none';
  end: () => void;
} {
  const reduced = useReducedMotion();
  const [sweep, setSweep] = useState(false);
  // Whether the CURRENT completed state already celebrated. Without this the
  // check re-ran its entrance the moment the burst finished — the tick appeared
  // with the explosion, then animated in a second time straight after.
  const [burst, setBurst] = useState(false);
  const prev = useRef(done);
  useEffect(() => {
    if (done && !prev.current && !reduced) {
      setSweep(true);
      setBurst(true);
    }
    if (!done) {
      setSweep(false);
      setBurst(false);
    }
    prev.current = done;
  }, [done, reduced]);

  // The burst normally clears itself from `animationend`. That event never
  // arrives if the document is hidden when it mounts — CSS animations do not
  // advance in a background tab — so ticking something off and switching away
  // left the overlay frozen over the tick until the next toggle. Tick something
  // off, alt-tab, come back: it was still sitting there. Always arm a fallback.
  useEffect(() => {
    if (!sweep) return undefined;
    const timer = setTimeout(() => setSweep(false), SWEEP_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [sweep]);

  return {
    sweep,
    // Mid-burst it is the burst; after one it is already there; otherwise (a
    // reload, reduced motion, a row scrolling in already done) it just pops.
    checkEnter: sweep ? 'burst' : burst ? 'none' : 'pop',
    end: useCallback(() => setSweep(false), []),
  };
}

/** Circular tick box at the right edge of a row: sweep plays, then the tick pops. */
function CompletionTick({ done, color }: { done: boolean; color: string }) {
  const { sweep, checkEnter, end } = useCompletionSweep(done);
  return <Tick checked={done} color={color} sweep={sweep} checkEnter={checkEnter} onSweepEnd={end} />;
}

function TimerTaskRow({
  item,
  color,
  now,
  onStart,
  onRestart,
  onAdvance,
}: {
  item: ChecklistItem;
  color: string;
  now: number;
  onStart: () => void;
  onRestart: () => void;
  onAdvance: () => void;
}) {
  const left = item.timerEndsAt != null ? item.timerEndsAt - now : 0;
  const durationMs = item.timerDurationMinutes * 60_000;
  const running = item.timerRunning;
  const ready = item.timerReady && !running;
  const stepped = running && item.timerStepMinutes != null;
  const stepLabel =
    item.timerStepMinutes != null && item.timerStepMinutes % 60 === 0
      ? `${item.timerStepMinutes / 60} hours`
      : `${item.timerStepMinutes} minutes`;
  const fraction = running && durationMs > 0 ? Math.min(1, Math.max(0, 1 - left / durationMs)) : 0;
  return (
    <button
      type="button"
      onClick={stepped ? onAdvance : running || ready ? onRestart : onStart}
      className="group flex min-h-11 w-full items-center gap-2 rounded-ui-md px-1.5 py-1 text-left transition hover:bg-fill-2 sm:min-h-8"
      aria-label={`${item.name}: ${stepped ? `subtract ${stepLabel} from timer` : running ? 'restart timer' : ready ? 'timer ready — restart' : 'start timer'}`}
    >
      <CadenceTag cadence={item.cadence} />
      <span className={`min-w-0 flex-1 truncate text-body ${ready ? 'text-dim line-through' : 'text-fg-soft'}`}>
        {item.name}
      </span>
      {running && (
        <Tooltip content="d = days · h = hours · m = minutes">
          <span className="shrink-0 text-meta font-bold tabular-nums text-warn-fg">{fmtDur(left)}</span>
        </Tooltip>
      )}
      {ready && <span className="shrink-0 text-meta font-bold text-ok-fg">Ready</span>}
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
  const { sweep, checkEnter, end } = useCompletionSweep(item.done);
  return (
    <button
      type="button"
      onClick={onAdvance}
      className="group flex min-h-11 w-full items-center gap-2 rounded-ui-md px-1.5 py-1 text-left transition hover:bg-fill-2 sm:min-h-8"
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
      {/* Filling the last sector of a multi-step task earns the same burst and
          the same tick as a single one — it is the bigger achievement of the
          two, and it used to be the only one that got nothing. */}
      <Tick
        checked={item.done}
        segments={{ current: item.countDone, total: item.countTarget }}
        color={color}
        sweep={sweep}
        checkEnter={checkEnter}
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
      // A check task is a toggle, unlike its restart/advance siblings, so state
      // rides on aria-pressed. Deliberately no aria-label: it would override the
      // content and take the urgency countdown out of the accessible name.
      aria-pressed={item.done}
      className="group flex min-h-11 w-full items-center gap-2 rounded-ui-md px-1.5 py-1 text-left transition hover:bg-fill-2 sm:min-h-8"
    >
      <CadenceTag cadence={item.cadence} />
      <span
        className={`min-w-0 flex-1 truncate text-body transition ${
          item.done
            ? 'text-dim line-through'
            : danger
              ? 'warn-pulse font-bold text-danger-fg'
              : warn
                ? 'text-warn-fg'
                : // Core tasks pay the game's premium currency, so they get the
                  // brightest step and the heavier weight — a second tier inside
                  // Body rather than a fourth type size (see the Three Voices
                  // Rule). Everything else recedes to the soft step.
                  item.core
                  ? 'font-bold text-fg'
                  : 'text-fg-soft'
        }`}
      >
        {item.name}
      </span>
      {(danger || warn) && (
        <span className={`shrink-0 text-caption font-bold tabular-nums ${danger ? 'text-danger-fg' : 'text-warn-fg'}`}>
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
  const mine = allEvents.filter((e) => !e.deleted && !e.done && e.gameId === game.id);
  // `notify` used to gate this list, which meant an event omitted from next
  // actions vanished from its own card — a ZZZ card could sit there showing
  // nothing while two of its events were live. Card visibility is independent.
  const active = mine.filter((e) => e.start <= now && e.end > now).sort((a, b) => a.end - b.end);
  // Banners count: which banner is running is exactly the kind of thing you open
  // the card to check.
  const shown = [...active.filter((e) => e.dailyTouch), ...active.filter((e) => !e.dailyTouch).slice(0, 4)].sort(
    (a, b) => a.end - b.end,
  );
  // The next thing to start (a patch, usually) is worth a row of its own.
  const next = mine
    .filter((e) => e.start > now)
    .sort((a, b) => a.start - b.start)
    .slice(0, 1);
  const events = [...shown, ...next];
  if (events.length === 0) return null;
  return (
    <div className="mt-4 space-y-1">
      {events.map((ev) => (
        <button
          key={ev.id}
          type="button"
          onClick={() => onOpenEvent(ev.id, game.id)}
          className="flex min-h-11 w-full items-center gap-2 rounded-ui-md px-1.5 py-0.5 text-left text-body transition hover:bg-fill-2 sm:min-h-8"
        >
          <Pill>{ev.type === 'cycle' || ev.type === 'banner' || ev.type === 'livestream' ? ev.type : 'event'}</Pill>
          {ev.dailyTouch && <Pill variant="warn">daily</Pill>}
          <span className="truncate text-fg-soft">{ev.name}</span>
          <Tooltip content="d = days · h = hours · m = minutes">
            {ev.start > now ? (
              <span className="ml-auto shrink-0 font-bold tabular-nums text-muted">in {fmtDur(ev.start - now)}</span>
            ) : (
              <span className="ml-auto shrink-0 font-bold tabular-nums" style={{ color: endTone(ev.end - now) }}>
                {fmtDur(ev.end - now)}
              </span>
            )}
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
  | 'setTaskDone'
  | 'startTaskTimer'
  | 'restartTaskTimer'
  | 'advanceTaskTimer'
  | 'setTaskCount'
  | 'setEnergy'
  | 'adjustEnergy'
>;

function EnergyControlRow({
  game,
  res,
  snap,
  now,
  localTz,
  setEnergy,
}: {
  game: Game;
  res: AppState['resources'][number];
  snap: Snapshot | undefined;
  now: number;
  localTz: string;
  setEnergy: GameControlActions['setEnergy'];
}) {
  const ground = useGround();
  const projection = useMemo(() => projectEnergy(res, snap, now, game), [game, now, res, snap]);
  const commit = useCallback(
    (value: number, reserve?: number) => setEnergy(res.id, value, reserve),
    [res.id, setEnergy],
  );
  return (
    <EnergyRow
      res={res}
      color={gameInk(game, ground)}
      reserveColor={gameSupport(game, ground)}
      proj={projection}
      reserve={projection.reserve ?? snap?.reserve}
      now={now}
      localTz={localTz}
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
                localTz={state.settings.localTz}
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
                className="min-h-11 rounded-ui-lg bg-fill-2 px-3 py-2 text-meta font-semibold text-fg-soft ring-1 ring-line-hairline transition hover:bg-fill-3 hover:text-fg sm:min-h-8 sm:py-1"
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
  const ground = useGround();
  const tickColor = gameInk(game, ground);
  if (game.paused || checklist.length === 0) return null;
  return (
    <div className="mt-3 space-y-0.5">
      {checklist.map((item) =>
        item.mode === 'timer' ? (
          <TimerTaskRow
            key={`${item.taskId}|${item.periodKey}`}
            item={item}
            color={tickColor}
            now={now}
            onStart={() => actions.startTaskTimer(item.taskId, item.periodKey)}
            onRestart={() => actions.restartTaskTimer(item.taskId, item.periodKey)}
            onAdvance={() => actions.advanceTaskTimer(item.taskId, item.periodKey, item.timerStepMinutes ?? 0)}
          />
        ) : item.mode === 'count' ? (
          <CountTaskRow
            key={`${item.taskId}|${item.periodKey}`}
            item={item}
            color={tickColor}
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
            color={tickColor}
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
  now,
  localTz,
  onEdit,
  layout = 'card',
}: {
  game: Game;
  dailies: ChecklistItem[];
  now: number;
  localTz: string;
  onEdit: () => void;
  layout?: 'card' | 'focus';
}) {
  const ground = useGround();
  const completed = dailies.filter((daily) => daily.done).length;
  const accountLabel = game.accountLabel?.trim();
  const resetLabel = localResetLabel(game, localTz, now);
  const regionLabel = serverRegionLabel(game.tz, now);
  return (
    <div className="relative z-10 flex items-center gap-3">
      <button
        type="button"
        onClick={onEdit}
        className="group/title -ml-1 min-w-0 flex-1 cursor-pointer rounded-ui-md px-1 py-0.5 text-left transition hover:bg-fill-2"
        aria-label={`Edit ${game.name}${accountLabel ? `, ${accountLabel}` : ''}`}
      >
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={`max-w-20 shrink-0 truncate rounded-ui-sm border border-line-edge bg-inset px-1.5 py-0.5 text-caption font-semibold text-fg-soft ${regionLabel.startsWith('UTC') && regionLabel !== 'UTC' ? 'numeral' : ''}`}
          >
            {regionLabel}
          </span>
          <h2
            className={`min-w-0 flex-1 truncate ${layout === 'focus' ? 'text-display min-[1500px]:text-hero' : 'text-heading'} font-black tracking-tight text-fg transition group-hover/title:text-fg`}
            style={{
              fontFamily: game.titleFont,
              color: gameTitleInk(game, ground),
              // A 1px offset for legibility over the card's own gradient — not
              // the coloured halo that used to sit behind it.
              textShadow: 'var(--title-shadow)',
            }}
          >
            {game.name}
          </h2>
          {accountLabel && (
            <>
              <span aria-hidden className="h-3 w-px shrink-0 bg-line-edge" />
              <span className="min-w-0 max-w-[40%] shrink-0 truncate text-body font-semibold text-fg-soft">
                {accountLabel}
              </span>
            </>
          )}
          {game.paused && (
            <Pill variant="paused" size="md">
              paused
            </Pill>
          )}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-label text-dim">
          <span className="h-[3px] w-8 rounded-ui-full" style={{ background: gameRim(game, ground) }} />
          reset {resetLabel}
        </div>
      </button>
      {!game.paused && dailies.length > 0 && (
        <ProgressBar variant="ring" value={completed / dailies.length} color={gameInk(game, ground)}>
          {completed}/{dailies.length}
        </ProgressBar>
      )}
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
  onEditGame,
  onOpenEvent,
}: {
  entry: GameUrgency;
  state: AppState;
  actions: GameControlActions;
  now: number;
  layout?: 'card' | 'focus';
  columns?: 1 | 2;
  onEditGame: (gameId: string) => void;
  onOpenEvent: (eventId: string, gameId: string) => void;
}) {
  const { game } = entry;
  const derived = useDerived(now);
  const identityColors = resolveGameIdentityColors(state.games.filter((candidate) => !candidate.deleted));
  const visualGame = { ...game, ...(identityColors[game.id] ?? {}) };
  const checklist = [...(derived.checklistByGame.get(game.id) ?? [])].sort(
    (a, b) => CADENCE_RANK[a.cadence] - CADENCE_RANK[b.cadence] || a.sort - b.sort,
  );
  const dailies = checklist.filter((item) => item.cadence === 'daily');
  const resources = (
    <ResourceControls game={visualGame} state={state} snaps={derived.snaps} now={now} actions={actions} />
  );
  const tasks = <ChecklistControls game={visualGame} checklist={checklist} now={now} actions={actions} />;
  const events = !game.paused && (
    <EventStrip game={visualGame} events={state.events} now={now} onOpenEvent={onOpenEvent} />
  );

  return (
    <>
      <GameControlsHeader
        game={visualGame}
        dailies={dailies}
        now={now}
        localTz={state.settings.localTz}
        onEdit={() => onEditGame(game.id)}
        layout={layout}
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
  const advanceTaskTimer = useApp((s) => s.advanceTaskTimer);
  const setTaskCount = useApp((s) => s.setTaskCount);
  const setEnergy = useApp((s) => s.setEnergy);
  const adjustEnergy = useApp((s) => s.adjustEnergy);
  const actions = useMemo(
    () => ({ setTaskDone, startTaskTimer, restartTaskTimer, advanceTaskTimer, setTaskCount, setEnergy, adjustEnergy }),
    [adjustEnergy, advanceTaskTimer, restartTaskTimer, setEnergy, setTaskCount, setTaskDone, startTaskTimer],
  );
  const openSheet = useUI((store) => store.openSheet);
  // Derived from the width the card actually has, rather than from a setting.
  // The manual override existed to correct a layout that could not measure
  // itself; it can, so the knob was answering a question nobody asked.
  const wideEnough = useMediaQuery('(min-width: 1500px)');
  const columns = wideEnough ? 2 : 1;
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
  const games = useApp((store) => store.state.games);
  const ground = useGround();
  const theme = useTheme();
  const reduced = useReducedMotion();
  const urgent = !game.paused && next != null && next.at - now < 60 * 60_000;
  const pulseUrgent = urgent && !reduced;
  // Depth is the game's own inset ring plus the top-edge highlight — nothing
  // outside the box. See the Shadows Float Only Rule in DESIGN.md: a card does
  // not overlay the page, so it casts nothing.
  const identityColors = resolveGameIdentityColors(games.filter((candidate) => !candidate.deleted));
  const visualColors = identityColors[game.id] ?? game;
  const rim = gameRim(visualColors, ground);
  const accent = gameAccent(visualColors, ground);
  const cardShadows = [!pulseUrgent && `inset 0 0 0 1px ${tint(rim, 0.3)}`, 'inset 0 1px 0 var(--color-line-hairline)']
    .filter(Boolean)
    .join(', ');

  return (
    <m.div
      data-game-card={game.id}
      // No h-full: in the narrow grid the cell already stretches the card, and in
      // the Cards columns it made a lone card grow to the height of the tallest
      // column — the empty-card problem in a new place.
      className="card-shell group relative flex flex-col overflow-hidden rounded-ui-card px-4 pb-6 pt-4"
      variants={cardEnter}
      initial="hidden"
      animate="visible"
      style={{
        ...gameShellVars(game, theme, visualColors),
        boxShadow: cardShadows,
      }}
    >
      <div
        className="absolute inset-x-4 top-0 h-[3px] rounded-ui-full"
        style={{
          background: `linear-gradient(90deg, transparent, ${rim}, ${accent}, transparent)`,
        }}
      />
      {game.image && (
        <div className="pointer-events-none absolute inset-y-0 right-0 w-2/3 overflow-hidden rounded-r-ui-card">
          <img
            src={game.image}
            alt=""
            className="absolute right-0 top-1/2 h-[135%] max-w-none -translate-y-1/2 object-cover opacity-40 saturate-125 transition duration-(--dur-slow) group-hover:opacity-55"
            style={{
              WebkitMaskImage: 'linear-gradient(90deg, transparent, rgba(0,0,0,0.55) 55%, #000 100%)',
              maskImage: 'linear-gradient(90deg, transparent, rgba(0,0,0,0.55) 55%, #000 100%)',
            }}
          />
          <div
            className="absolute inset-0 rounded-r-ui-card"
            style={{
              background: `linear-gradient(90deg, ${mix(ground, rim, 0.05)} 6%, transparent 60%), linear-gradient(0deg, ${tint(rim, 0.14)}, transparent 70%)`,
            }}
          />
        </div>
      )}
      {pulseUrgent && (
        <div
          className="pulse-fade pointer-events-none absolute inset-0 rounded-ui-card"
          style={{ boxShadow: `inset 0 0 0 1px ${tint(rim, 0.8)}, inset 0 0 24px ${tint(rim, 0.12)}` }}
        />
      )}
      <GameControls entry={entry} now={now} />
    </m.div>
  );
});
