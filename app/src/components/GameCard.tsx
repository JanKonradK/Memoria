import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import { EventTags } from './EventTags';
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode, type Ref } from 'react';
import type { AppState, ChecklistItem, EventProgress, Game, GameEvent, GameUrgency, Snapshot } from '@memoria/shared';
import {
  bankCounterOf,
  bankedCounterIds,
  effectiveResourceKind,
  EVENT_PROGRESS_LABEL,
  EVENT_STEPS,
  eventPartsDone,
  eventProgress,
  isTickableDaily,
  measuredSnapshot,
  nextEventProgress,
  projectEnergy,
  resolveGameLayout,
} from '@memoria/shared';
import { useDerived } from '../selectors';
import { useApp, type AppStore } from '../store';
import { useUI } from '../ui-store';
import { haptic, useMediaQuery, useReducedMotion } from '../hooks';
import { titleStyle } from '../fonts';
import { GameLogo } from './GameLogo';
import { PinMark } from './EventPeek';
import { gameInk, gameSupport, gameTitleInk } from '../game-color';
import { useGround } from '../theme';
import { endTone, fmtDur, localResetLabel } from '../util';
import { EnergyRow } from './EnergyRow';
import { AttentionIndicator } from './AttentionIndicator';
import { Pill, ProgressBar, Tick } from './primitives';
import { GameEvents } from './GameEvents';
import { Btn, ServerChip, Tooltip, TOUCH_BUTTON } from './ui';
import { useIdentityColors } from './roster';
import { gameServerLabel } from '../server-choice';
import { groupGameEvents } from '../event-category';
import { calendarSchedule } from '../event-schedule';
import { readingSource } from '../reading-source';
import { SwipeRow, type SwipeAction } from '../swipe-row';
import { Ago } from './Ago';
import { LaunchButton } from './GameLaunch';
import { useCatchUpUnread } from '../catch-up-status';
import { openGame } from '../workspace-navigation';
import { passSession, sessionNeed, sessionResource, useSession, type SessionNeed } from '../session-focus';
import { useConnectors } from '../connectors-state';
import { CheckInFailureNote, useCheckInClaim } from './CheckInClaim';

const CADENCE_ORDER = ['daily', 'custom', 'weekly', 'monthly'] as const;
/** A reading older than this shows when it was taken. */
const STALE_READING_MS = 12 * 60 * 60_000;
/** A session the PC never saw end stops leading the page after this long. */
const SESSION_MAX_MS = 8 * 60 * 60_000;
const MENU_ITEM =
  'flex min-h-11 cursor-pointer items-center rounded-ui-sm px-3 text-body text-fg-soft outline-none transition-colors data-[highlighted]:bg-fill-2 data-[highlighted]:text-fg fine:min-h-9';
const CADENCE_LABEL = { daily: 'Daily', custom: 'Cycle', weekly: 'Weekly', monthly: 'Monthly' } as const;

/** Undone tasks escalate as their reset approaches: amber < 2h, pulsing red < 20 min. */
const TASK_DANGER_MS = 20 * 60_000;
const TASK_WARN_MS = 120 * 60_000;

/** Shared geometry for every task row, so the three modes read as one list. */
const TASK_ROW =
  'game-task-row group flex min-h-11 w-full items-center gap-2 rounded-ui-md px-1.5 py-1 text-left transition duration-(--dur-fast) hover:bg-fill-2 fine:min-h-8';

type TaskTone = 'done' | 'waiting' | 'idle' | 'warn' | 'danger';

const TASK_TONE: Record<Exclude<TaskTone, 'idle'>, string> = {
  done: 'text-dim',
  // A dispatch is out and nothing can be done about it until it returns.
  // Neither owed nor finished, so neither bright nor struck through.
  waiting: 'text-dim',
  danger: 'font-bold text-danger-fg',
  warn: 'text-warn-fg',
};

/**
 * A task name.
 *
 * The truncating box and the text are two elements on purpose. The outer one is
 * the flex child and owns the ellipsis; the inner one shrink-wraps the words,
 * which is what lets the strike-through animate to exactly their width instead
 * of to the width of the row.
 *
 * State decides the tone before rank does: a done task is dim whether or not it
 * pays pull currency, and `core` only lifts a task that is still owed.
 */
function TaskName({ children, tone, core }: { children: string; tone: TaskTone; core: boolean }) {
  const ink =
    tone === 'idle'
      ? // Core tasks pay the game's premium currency, so they get the brightest
        // step and the heavier weight — a second tier inside Body rather than a
        // fourth type size (see the Three Voices Rule).
        core
        ? 'font-bold text-fg'
        : 'text-fg-soft'
      : TASK_TONE[tone];
  return (
    <span data-task-name className={`min-w-0 flex-1 text-body transition duration-(--dur-fast) md:truncate ${ink}`}>
      <span className="task-strike" data-done={tone === 'done'}>
        {children}
      </span>
    </span>
  );
}

/**
 * The rule that opens a band of the card: a name, a hairline, and whatever
 * summary that band has.
 *
 * The same shape the hub uses for Closing / Just arrived / Arriving, so the
 * card and the hub section themselves the same way. It exists here because the
 * alternative was a `WEEKLY` pill stamped onto the left of every single weekly
 * row: seven rows repeating one word said nothing seven times and pushed every
 * task name right by the width of the longest tag.
 */
function BandRule({ label, children }: { label: string; children?: ReactNode }) {
  return (
    <div className="look-rule mt-3 flex items-center gap-2 first:mt-0">
      <span className="look-rule-label shrink-0 text-meta font-semibold text-muted">{label}</span>
      <span aria-hidden className="look-rule-line h-px min-w-4 flex-1 bg-line-hairline" />
      {children}
    </div>
  );
}

/**
 * A cadence band's rule: its tally, and — for the fixed cadences, where every
 * task in the band shares one deadline — one countdown for all of them.
 *
 * That shared countdown had nowhere to live but the row before this, where it
 * read as that one task's own timer rather than as the reset it actually is.
 */
function ChecklistGroupRule({
  cadence,
  done,
  total,
  resetAt,
  now,
  action,
}: {
  cadence: ChecklistItem['cadence'];
  done: number;
  total: number;
  resetAt: number | null;
  now: number;
  /** A small control at the end of the rule, such as ticking every daily at once. */
  action?: ReactNode;
}) {
  const left = resetAt == null ? null : resetAt - now;
  const complete = done >= total;
  const tone =
    complete || left == null
      ? 'text-dim'
      : left < TASK_DANGER_MS
        ? 'font-bold text-danger-fg'
        : left < TASK_WARN_MS
          ? 'text-warn-fg'
          : 'text-dim';
  return (
    <BandRule label={CADENCE_LABEL[cadence]}>
      <span className={`shrink-0 text-caption font-bold tabular-nums ${complete ? 'text-ok-fg' : 'text-dim'}`}>
        {done}/{total}
      </span>
      {left != null && (
        <Tooltip content={`${CADENCE_LABEL[cadence]} reset`}>
          <span className={`shrink-0 text-caption tabular-nums ${tone}`}>{fmtDur(left)}</span>
        </Tooltip>
      )}
      {action}
    </BandRule>
  );
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

/** An event's tick: a plain circle for one part, a ring of sectors that fill as its parts are ticked. */
export function EventTick({
  ticked,
  total,
  color,
  className,
}: {
  ticked: number;
  total: number;
  color: string;
  className?: string;
}) {
  const done = ticked >= total;
  const { sweep, checkEnter, end } = useCompletionSweep(done);
  return (
    <Tick
      checked={done}
      // Segments only once started, so a fresh event reads as an empty ring.
      segments={total > 1 && ticked > 0 && ticked < total ? { current: ticked, total } : undefined}
      color={color}
      sweep={sweep}
      checkEnter={checkEnter}
      onSweepEnd={end}
      className={className}
    />
  );
}

/** Circular tick box at the right edge of a row: sweep plays, then the tick pops. */
function CompletionTick({ done, color, danger = false }: { done: boolean; color: string; danger?: boolean }) {
  const { sweep, checkEnter, end } = useCompletionSweep(done);
  return <Tick checked={done} color={color} danger={danger} sweep={sweep} checkEnter={checkEnter} onSweepEnd={end} />;
}

/**
 * A dispatch task — expeditions, assignments, the Crystalfly trap. Two facts
 * live on this row and they are NOT the same fact, which is what the old one
 * got wrong:
 *
 *   - the tick answers "have I collected and resent this period?"
 *   - the meta text answers "when does the current run come back?"
 *
 * The old row fused them and inverted both. A returned dispatch — the one
 * moment there is genuinely something to go and do — rendered struck through
 * with a filled tick, i.e. as finished. A running one rendered as an unfinished
 * partial ring with an amber countdown, i.e. as urgent, when in fact there is
 * nothing to do but wait. So the task was never seen complete, and the number
 * beside it read as a lockout ("nothing until this hits zero") rather than as
 * the return time it actually is.
 */
function TimerTaskRow({
  item,
  color,
  now,
  onRestart,
  onAdvance,
}: {
  item: ChecklistItem;
  color: string;
  now: number;
  onRestart: () => void;
  onAdvance: () => void;
}) {
  const left = item.timerEndsAt != null ? item.timerEndsAt - now : 0;
  const durationMs = item.timerDurationMinutes * 60_000;
  const running = item.timerRunning;
  // Back, and not yet dealt with this period: the only state that is asking
  // for anything.
  const waitingToCollect = item.timerReady && !item.done;
  const stepped = running && item.timerStepMinutes != null;
  const stepLabel =
    item.timerStepMinutes != null && item.timerStepMinutes % 60 === 0
      ? `${item.timerStepMinutes / 60} hours`
      : `${item.timerStepMinutes} minutes`;
  const fraction = running && durationMs > 0 ? Math.min(1, Math.max(0, 1 - left / durationMs)) : 0;
  const tone = item.done ? 'done' : running ? 'waiting' : 'idle';
  const action = stepped
    ? `subtract ${stepLabel} from the timer`
    : waitingToCollect
      ? 'collect and resend'
      : item.done
        ? 'collected — resend again now'
        : 'mark collected and resent';
  return (
    <button
      type="button"
      onClick={stepped ? onAdvance : onRestart}
      className={TASK_ROW}
      aria-label={`${item.name}: ${action}`}
      aria-pressed={item.done}
    >
      <TaskName tone={tone} core={item.core}>
        {item.name}
      </TaskName>
      {waitingToCollect ? (
        <span className={`shrink-0 text-meta font-bold ${item.cadence === 'custom' ? 'text-danger-fg' : 'text-ok-fg'}`}>
          {item.cadence === 'custom' ? 'Ready' : 'Collect'}
        </span>
      ) : running ? (
        <Tooltip content="When this dispatch returns">
          <span className="shrink-0 text-meta tabular-nums text-dim">back {fmtDur(left)}</span>
        </Tooltip>
      ) : null}
      {/* Done is a check like every other row on the card. A run still out is
          the one case that earns the arc instead: it is neither owed nor done,
          and the arc is the only shape that says so. */}
      {!item.done && running ? (
        <Tick fraction={fraction} color={color} />
      ) : (
        <CompletionTick done={item.done} color={color} danger={waitingToCollect && item.cadence === 'custom'} />
      )}
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
      className={TASK_ROW}
      aria-label={`${item.name}: ${item.countDone} of ${item.countTarget} done${item.done ? ', complete — click to reset' : ', click to mark one more'}`}
    >
      <TaskName tone={item.done ? 'done' : 'idle'} core={item.core}>
        {item.name}
      </TaskName>
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
  showDeadline,
  onToggle,
}: {
  item: ChecklistItem;
  color: string;
  now: number;
  /**
   * Cycle rows carry their own countdown because each one closes with its own
   * Timeline window. Daily, weekly and monthly rows do not: the group rule above
   * them already states the one deadline they all share, and repeating it per
   * row is what made a shared reset look like a per-task lockout.
   */
  showDeadline: boolean;
  onToggle: () => void;
}) {
  const left = item.resetAt - now;
  const danger = !item.done && left < TASK_DANGER_MS;
  const warn = !item.done && !danger && left < TASK_WARN_MS;
  return (
    <button
      type="button"
      onClick={() => {
        haptic();
        onToggle();
      }}
      // A check task is a toggle, unlike its restart/advance siblings, so state
      // rides on aria-pressed. Deliberately no aria-label: it would override the
      // content and take the urgency countdown out of the accessible name.
      aria-pressed={item.done}
      className={TASK_ROW}
    >
      <TaskName tone={item.done ? 'done' : danger ? 'danger' : warn ? 'warn' : 'idle'} core={item.core}>
        {item.name}
      </TaskName>
      {showDeadline && !item.done && (
        <span
          className={`shrink-0 text-caption tabular-nums ${
            danger ? 'font-bold text-danger-fg' : warn ? 'text-warn-fg' : 'text-dim'
          }`}
        >
          {fmtDur(left)}
        </span>
      )}
      <CompletionTick done={item.done} color={color} />
    </button>
  );
}

/**
 * Active Genshin windows are grouped by world, then banners. Other games keep
 * their compact summary. Each section includes its next upcoming window.
 *
 * With `onSetProgress` this is the game page's event list rather than a card's
 * summary: every active window is listed, each with a tick, and a finished one
 * stays in place, struck through, so the tick can be taken back. The tick steps
 * through not started, partly done (half a ring) and done.
 */
export function EventStrip({
  game,
  events: allEvents,
  now,
  onOpenEvent,
  onSetProgress,
  emptyLabel,
}: {
  game: Game;
  events: AppState['events'];
  now: number;
  onOpenEvent: (eventId: string, gameId: string) => void;
  /** Called with the event's new state when its tick is tapped. */
  onSetProgress?: (event: GameEvent, progress: EventProgress) => void;
  /** Said in place of the list when the game has nothing running or coming. */
  emptyLabel?: string;
}) {
  const ground = useGround();
  const mine = allEvents.filter((e) => !e.deleted && (onSetProgress || !e.done) && e.gameId === game.id);
  // `notify` used to gate this list, which meant an event omitted from next
  // actions vanished from its own card — a ZZZ card could sit there showing
  // nothing while two of its events were live. Card visibility is independent.
  const sections = groupGameEvents(game, mine)
    .map((section) => {
      const active = section.events
        .filter((event) => event.start <= now && event.end > now)
        .sort((a, b) => a.end - b.end);
      const shown = onSetProgress
        ? // Pinned first, then unfinished, so what you mean to do leads each section.
          [...active].sort(
            (a, b) =>
              Number(Boolean(b.pinned && !b.done)) - Number(Boolean(a.pinned && !a.done)) ||
              Number(Boolean(a.done)) - Number(Boolean(b.done)) ||
              a.end - b.end,
          )
        : section.key === 'events'
          ? [
              ...active.filter((event) => event.dailyTouch),
              ...active.filter((event) => !event.dailyTouch).slice(0, 4),
            ].sort((a, b) => a.end - b.end)
          : active;
      const next = section.events
        .filter((event) => event.start > now)
        .sort((a, b) => a.start - b.start)
        .slice(0, 1);
      return { ...section, events: [...shown, ...next] };
    })
    .filter((section) => section.events.length > 0);
  if (sections.length === 0) return emptyLabel ? <p className="aside py-2 text-meta text-muted">{emptyLabel}</p> : null;
  return (
    <div className="event-strip">
      {sections.map((section) => (
        <section
          key={section.key}
          className="mt-3 first:mt-0"
          aria-label={section.label === 'Events' ? `${game.name} events` : `${section.label} events for ${game.name}`}
        >
          <BandRule label={section.label} />
          <div className="mt-0.5 space-y-0.5">
            {section.events.map((ev) => {
              const calendar = calendarSchedule(ev);
              const open = (
                <button
                  key={ev.id}
                  type="button"
                  onClick={() => onOpenEvent(ev.id, game.id)}
                  className={`flex min-h-11 w-full min-w-0 items-start gap-2 rounded-ui-md px-1.5 py-2 text-left text-body transition hover:bg-fill-2 fine:min-h-8 fine:items-center fine:py-0.5`}
                >
                  <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 md:flex-nowrap">
                    <EventTags game={game} event={ev} />
                    {ev.dailyTouch && <Pill variant="warn">daily</Pill>}
                    {ev.pinned && <PinMark className="h-3.5 w-3.5" />}
                    <span
                      className={`w-full break-words md:w-auto md:truncate ${ev.done ? 'text-muted line-through' : 'text-fg-soft'}`}
                    >
                      {ev.name}
                    </span>
                  </span>
                  <Tooltip content={calendar?.description ?? 'Time left'}>
                    {calendar ? (
                      <span className="ml-auto shrink-0 font-bold tabular-nums text-muted">{calendar.label}</span>
                    ) : ev.start > now ? (
                      <span className="ml-auto shrink-0 font-bold tabular-nums text-muted">
                        in {fmtDur(ev.start - now)}
                      </span>
                    ) : (
                      <span
                        className="ml-auto shrink-0 font-bold tabular-nums"
                        style={{ color: endTone(ev.end - now) }}
                      >
                        {fmtDur(ev.end - now)}
                      </span>
                    )}
                  </Tooltip>
                </button>
              );
              if (!onSetProgress) return open;
              const progress = eventProgress(ev);
              return (
                <SwipeRow
                  key={ev.id}
                  className="look-row"
                  ink={gameInk(game, ground)}
                  right={progress === 'done' ? null : { label: 'Done', run: () => onSetProgress(ev, 'done') }}
                  left={progress === 'none' ? null : { label: 'Not done', run: () => onSetProgress(ev, 'none') }}
                >
                  <div className="flex items-center gap-1">
                    {open}
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={progress === 'done' ? true : progress === 'partial' ? 'mixed' : false}
                      aria-label={`${ev.name}: done`}
                      title={`${EVENT_PROGRESS_LABEL[progress]}. Tap for ${EVENT_PROGRESS_LABEL[nextEventProgress(ev)].toLowerCase()}.`}
                      onClick={() => onSetProgress(ev, nextEventProgress(ev))}
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-ui-md transition hover:bg-fill-2 fine:h-8 fine:w-8"
                    >
                      <EventTick ticked={eventPartsDone(ev)} total={EVENT_STEPS} color={gameInk(game, ground)} />
                    </button>
                  </div>
                </SwipeRow>
              );
            })}
          </div>
        </section>
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
  'setTaskDone' | 'restartTaskTimer' | 'advanceTaskTimer' | 'setTaskCount' | 'setEnergy' | 'adjustEnergy'
>;

function EnergyControlRow({
  game,
  res,
  snap,
  now,
  localTz,
  setEnergy,
  note,
  need,
  pulse,
  counter,
  counterSnap,
}: {
  game: Game;
  res: AppState['resources'][number];
  snap: Snapshot | undefined;
  /** The counter crafted from this bar (Condensed Resin), shown as its second row. */
  counter?: AppState['resources'][number];
  counterSnap?: Snapshot;
  now: number;
  localTz: string;
  setEnergy: GameControlActions['setEnergy'];
  /** When the reading was entered, only when it needs a look. */
  note?: ReactNode;
  need?: 'value' | 'reserve';
  pulse?: boolean;
}) {
  const ground = useGround();
  const projection = useMemo(() => projectEnergy(res, measuredSnapshot(res, snap), now, game), [game, now, res, snap]);
  const commit = useCallback(
    (value: number, reserve?: number) => setEnergy(res.id, value, reserve),
    [res.id, setEnergy],
  );
  const touched = useCallback(
    (part: 'value' | 'reserve') => passSession(game.id, part === 'value' ? 'energy' : 'reserve'),
    [game.id],
  );
  const counted = useMemo(
    () => (counter ? projectEnergy(counter, measuredSnapshot(counter, counterSnap), now, game) : null),
    [counter, counterSnap, game, now],
  );
  const counterId = counter?.id;
  const commitCounter = useCallback(
    (value: number) => {
      if (counterId) setEnergy(counterId, value);
    },
    [counterId, setEnergy],
  );
  const bank = useMemo(
    () =>
      counter && counted
        ? { res: counter, value: counted.hasSnapshot ? counted.value : null, onCommit: commitCounter }
        : undefined,
    [commitCounter, counted, counter],
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
      note={note}
      need={need}
      pulse={pulse}
      onTouched={touched}
      counter={bank}
    />
  );
}

function ResourceControls({
  game,
  state,
  hidden,
  snaps,
  now,
  actions,
  reading,
  session,
}: {
  game: Game;
  state: AppState;
  /** Layout ids of rows the player hid: `resource:<id>` and `quick-spend`. */
  hidden: ReadonlySet<string>;
  snaps: Map<string, Snapshot>;
  now: number;
  actions: GameControlActions;
  reading?: { resourceId: string; label: ReactNode };
  /** A running game's next step, on the bar it starts with. */
  session?: { resourceId: string; need: SessionNeed; pulse: boolean };
}) {
  const resources = state.resources.filter((r) => r.gameId === game.id && !r.deleted).sort((a, b) => a.sort - b.sort);
  // A counter crafted from a bar (Condensed Resin) is that bar's second row, not a row of its own.
  const banked = bankedCounterIds(resources);
  const cardResources = resources.filter(
    (res) =>
      ['regen', 'weekly', 'counter'].includes(effectiveResourceKind(res)) &&
      !hidden.has(`resource:${res.id}`) &&
      !banked.has(res.id),
  );

  return (
    <>
      {cardResources.length > 0 && (
        <div data-section="resources" className="mt-3.5 space-y-3">
          {cardResources.map((res) => {
            const counter = bankCounterOf(res, resources);
            const shown = counter && !hidden.has(`resource:${counter.id}`) ? counter : undefined;
            return (
              <EnergyControlRow
                key={res.id}
                game={game}
                res={res}
                snap={snaps.get(res.id)}
                counter={shown}
                counterSnap={shown ? snaps.get(shown.id) : undefined}
                now={now}
                localTz={state.settings.localTz}
                setEnergy={actions.setEnergy}
                note={reading?.resourceId === res.id ? reading.label : undefined}
                need={
                  session?.resourceId === res.id && session.need !== 'dailies'
                    ? session.need === 'energy'
                      ? 'value'
                      : 'reserve'
                    : undefined
                }
                pulse={session?.pulse}
              />
            );
          })}
        </div>
      )}
      {!hidden.has('quick-spend') && <QuickSpendControls game={game} state={state} actions={actions} />}
    </>
  );
}

function QuickSpendControls({ game, state, actions }: { game: Game; state: AppState; actions: GameControlActions }) {
  const resources = state.resources
    .filter((item) => item.gameId === game.id && !item.deleted)
    .sort((a, b) => a.sort - b.sort);
  const primaryEnergy = resources.find((res) => effectiveResourceKind(res) === 'regen');
  const quickChips = state.chips
    .filter((chip) => chip.gameId === game.id && !chip.deleted)
    .sort((a, b) => a.sort - b.sort);

  return (
    <>
      {!game.paused && primaryEnergy && quickChips.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5" aria-label={`${game.name} quick energy adjustments`}>
          {quickChips.map((chip) => (
            <Tooltip key={chip.id} content={`${chip.delta > 0 ? '+' : ''}${chip.delta} ${primaryEnergy.name}`}>
              <button
                type="button"
                onClick={() => actions.adjustEnergy(primaryEnergy.id, chip.delta)}
                className="min-h-11 rounded-ui-lg bg-fill-2 px-3 py-2 text-meta font-semibold text-fg-soft ring-1 ring-line-hairline transition hover:bg-fill-3 hover:text-fg fine:min-h-8 fine:py-1"
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

/**
 * The checklist split into its cadences, in the order a day is actually
 * worked: dailies, then the cycles that are open right now, then the weekly
 * and monthly backlog. Core tasks lead inside each group.
 */
function groupChecklist(checklist: ChecklistItem[]): Array<{
  cadence: ChecklistItem['cadence'];
  items: ChecklistItem[];
  done: number;
  /** The one deadline the whole group shares — null when its members differ. */
  resetAt: number | null;
}> {
  return CADENCE_ORDER.map((cadence) => {
    const items = checklist
      .filter((item) => item.cadence === cadence)
      .sort((a, b) => Number(b.core) - Number(a.core) || a.sort - b.sort || a.name.localeCompare(b.name));
    const shared = items.every((item) => item.resetAt === items[0]?.resetAt);
    return {
      cadence,
      items,
      done: items.filter((item) => item.done).length,
      // Cycle windows each close on their own schedule, so that group gets no
      // header countdown and its rows keep theirs.
      resetAt: shared && items[0] ? items[0].resetAt : null,
    };
  }).filter((group) => group.items.length > 0);
}

/** Records a reversible task reset or timer restart under an Undo toast. */
function runWithUndo(label: string, run: () => void): void {
  const before = useApp.getState?.()?.history?.journal?.at(-1)?.id;
  run();
  const actionId = useApp.getState?.()?.history?.journal?.at(-1)?.id;
  if (actionId && actionId !== before) {
    useUI.getState().showUndo(label, () => useApp.getState().undoActivity(actionId));
  }
}

function TaskControl({
  item,
  now,
  actions,
  color: tickColor,
  showDeadline = true,
}: {
  item: ChecklistItem;
  now: number;
  actions: GameControlActions;
  color: string;
  showDeadline?: boolean;
}) {
  // Swipe right completes, left takes back; the row's own tap stays as it was.
  const stepped = item.mode === 'timer' && item.timerRunning && item.timerStepMinutes != null;
  const right: SwipeAction | null =
    item.mode === 'timer'
      ? stepped
        ? {
            label: 'Sooner',
            run: () => actions.advanceTaskTimer(item.taskId, item.periodKey, item.timerStepMinutes ?? 0),
          }
        : {
            label: item.done ? 'Resend' : 'Collect',
            run: () =>
              runWithUndo(item.done ? `${item.name} restarted` : `${item.name} timer started`, () =>
                actions.restartTaskTimer(item.taskId, item.periodKey),
              ),
          }
      : item.done
        ? null
        : item.mode === 'count'
          ? {
              label: '+1',
              run: () =>
                actions.setTaskCount(item.taskId, item.periodKey, Math.min(item.countTarget, item.countDone + 1)),
            }
          : { label: 'Done', run: () => actions.setTaskDone(item.taskId, item.periodKey, true) };
  const left: SwipeAction | null =
    item.mode === 'timer'
      ? null
      : item.mode === 'count'
        ? item.countDone > 0
          ? {
              label: '−1',
              run: () => actions.setTaskCount(item.taskId, item.periodKey, Math.max(0, item.countDone - 1)),
            }
          : null
        : item.done
          ? { label: 'Not done', run: () => actions.setTaskDone(item.taskId, item.periodKey, false) }
          : null;
  return (
    <SwipeRow right={right} left={left} ink={tickColor} className="look-row game-task-swipe">
      <TaskRowFor item={item} now={now} actions={actions} color={tickColor} showDeadline={showDeadline} />
    </SwipeRow>
  );
}

function TaskRowFor({
  item,
  now,
  actions,
  color: tickColor,
  showDeadline,
}: {
  item: ChecklistItem;
  now: number;
  actions: GameControlActions;
  color: string;
  showDeadline: boolean;
}) {
  return item.mode === 'timer' ? (
    <TimerTaskRow
      item={item}
      color={tickColor}
      now={now}
      onRestart={() =>
        runWithUndo(item.done ? `${item.name} restarted` : `${item.name} timer started`, () =>
          actions.restartTaskTimer(item.taskId, item.periodKey),
        )
      }
      onAdvance={() => actions.advanceTaskTimer(item.taskId, item.periodKey, item.timerStepMinutes ?? 0)}
    />
  ) : item.mode === 'count' ? (
    <CountTaskRow
      item={item}
      color={tickColor}
      onAdvance={() => {
        if (item.done) {
          runWithUndo(`${item.name} reset`, () => actions.setTaskCount(item.taskId, item.periodKey, 0));
        } else {
          actions.setTaskCount(item.taskId, item.periodKey, Math.min(item.countTarget, item.countDone + 1));
        }
      }}
    />
  ) : item.link ? (
    <LinkedTaskRow item={item} color={tickColor} now={now} showDeadline={showDeadline} actions={actions} />
  ) : (
    <TaskRow
      item={item}
      color={tickColor}
      now={now}
      showDeadline={showDeadline}
      onToggle={() => actions.setTaskDone(item.taskId, item.periodKey, !item.done)}
    />
  );
}

/**
 * A task done on another site, like a HoYoLAB check-in: Open goes there, and
 * coming back offers Mark done, so the common answer is one tap. A HoYoLAB
 * check-in on a linked game is claimed right here instead; if that fails, the
 * reason shows and Open is back as the fallback.
 */
function LinkedTaskRow({
  item,
  color,
  now,
  showDeadline,
  actions,
}: {
  item: ChecklistItem;
  color: string;
  now: number;
  showDeadline: boolean;
  actions: GameControlActions;
}) {
  const [opened, setOpened] = useState(false);
  const checkIn = useCheckInClaim(item, actions.setTaskDone);
  const done = () => {
    actions.setTaskDone(item.taskId, item.periodKey, true);
    setOpened(false);
  };
  return (
    <div className="flex flex-wrap items-center gap-1">
      <div className="min-w-0 flex-1">
        <TaskRow
          item={item}
          color={color}
          now={now}
          showDeadline={showDeadline}
          onToggle={() => actions.setTaskDone(item.taskId, item.periodKey, !item.done)}
        />
      </div>
      {!item.done && checkIn.available && (
        <button
          type="button"
          className="min-h-11 shrink-0 rounded-ui-sm px-2 text-caption font-semibold text-accent-fg hover:bg-fill-2 disabled:opacity-60 fine:min-h-8"
          aria-label={checkIn.busy ? `Claiming ${item.name}` : `Claim ${item.name}`}
          aria-busy={checkIn.busy}
          disabled={checkIn.busy}
          onClick={checkIn.claim}
        >
          {checkIn.busy ? 'Claiming…' : checkIn.failure ? 'Retry' : 'Claim'}
        </button>
      )}
      {!item.done &&
        (!checkIn.available || checkIn.failure) &&
        (opened ? (
          <button
            type="button"
            className="min-h-11 shrink-0 rounded-ui-sm px-2 text-caption font-semibold text-fg hover:bg-fill-2 fine:min-h-8"
            onClick={done}
          >
            Mark done
          </button>
        ) : (
          <a
            href={item.link}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-ui-sm text-accent-fg hover:bg-fill-2 fine:min-h-8 fine:min-w-8"
            aria-label={`Open ${item.name}`}
            title={`Open ${item.name}`}
            onClick={() => setOpened(true)}
          >
            <svg viewBox="0 0 20 20" aria-hidden className="icon h-4 w-4" fill="none" stroke="currentColor">
              <path
                d="M11 4h5v5M16 4l-7 7M14 11.5V15a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h3.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </a>
        ))}
      {checkIn.failure && !item.done && <CheckInFailureNote failure={checkIn.failure} className="basis-full pl-1" />}
    </div>
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
  // Small text, so it needs body-text contrast, not the 3:1 a tick mark needs.
  const actionInk = gameTitleInk(game, ground, 4.5);
  const completeDailies = useApp((store) => store.completeDailies);
  const undoActivity = useApp((store) => store.undoActivity);
  const history = useApp((store) => store.history);
  const [completedAction, setCompletedAction] = useState<string>();
  const canComplete = checklist.some(isTickableDaily);
  const canUndo = completedAction && history.journal.some((entry) => entry.id === completedAction && !entry.undone);
  if (game.paused || checklist.length === 0) return null;
  const groups = groupChecklist(checklist);
  return (
    <div data-section="tasks" className="mt-3.5">
      {groups.map((group) => (
        <section
          key={group.cadence}
          data-cadence={group.cadence}
          aria-label={`${CADENCE_LABEL[group.cadence]} tasks for ${game.name}`}
        >
          <ChecklistGroupRule
            cadence={group.cadence}
            done={group.done}
            total={group.items.length}
            resetAt={group.resetAt}
            now={now}
            action={
              group.cadence !== 'daily' ? undefined : canUndo ? (
                <button
                  type="button"
                  className="-my-2.5 inline-flex min-h-11 shrink-0 items-center rounded-ui-sm px-2 py-1.5 text-caption font-semibold hover:bg-fill-2 focus-visible:bg-fill-2 fine:-my-1.5 fine:min-h-0"
                  style={{ color: actionInk }}
                  aria-label={`Undo completing dailies for ${game.name}`}
                  onClick={() => {
                    undoActivity(completedAction);
                    setCompletedAction(undefined);
                    useUI.getState().dismissUndo();
                  }}
                >
                  Undo
                </button>
              ) : canComplete ? (
                <button
                  type="button"
                  className="-my-2.5 inline-flex min-h-11 shrink-0 items-center gap-1 rounded-ui-sm px-2 py-1.5 text-caption font-semibold hover:bg-fill-2 focus-visible:bg-fill-2 fine:-my-1.5 fine:min-h-0"
                  style={{ color: actionInk }}
                  aria-label={`Tick all dailies for ${game.name}`}
                  title="Tick all dailies"
                  onClick={() => {
                    passSession(game.id, 'energy', 'reserve');
                    const actionId = completeDailies(game.id);
                    setCompletedAction(actionId);
                    if (actionId)
                      useUI.getState().showUndo(`${game.name} dailies ticked`, () => {
                        undoActivity(actionId);
                        setCompletedAction(undefined);
                      });
                  }}
                >
                  <svg viewBox="0 0 20 20" aria-hidden className="icon h-4 w-4" fill="none" stroke="currentColor">
                    <path d="m2.5 10.5 3 3 6.5-7M9.5 13l.5.5 6.5-7" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span aria-hidden>Tick all</span>
                </button>
              ) : undefined
            }
          />
          <div className="mt-0.5 space-y-0.5">
            {group.items.map((item) => (
              <TaskControl
                key={`${item.taskId}|${item.periodKey}`}
                item={item}
                now={now}
                actions={actions}
                color={tickColor}
                showDeadline={group.resetAt == null}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function GameControlsHeader({
  game,
  dailies,
  now,
  localTz,
  onEdit,
  onBack,
  editRef,
  urgent,
  layout = 'card',
  managingEvents,
  onToggleEvents,
  eventsPanelId,
  actions,
  actionsEnd,
}: {
  game: Game;
  dailies: ChecklistItem[];
  now: number;
  localTz: string;
  onEdit: () => void;
  onBack?: () => void;
  editRef?: Ref<HTMLButtonElement>;
  urgent: boolean;
  layout?: 'card' | 'focus';
  managingEvents: boolean;
  onToggleEvents: () => void;
  eventsPanelId: string;
  /** The game's own actions, before Edit. */
  actions?: ReactNode;
  /** Joins the end of the actions, after the game's own. */
  actionsEnd?: ReactNode;
}) {
  const TitleContainer = layout === 'focus' ? 'div' : 'button';
  const focusEvents = useRef(false);
  function toggleEvents() {
    focusEvents.current = !managingEvents;
    onToggleEvents();
  }
  const ground = useGround();
  // A game's own page has room for the logo to carry the whole name.
  const wide = useMediaQuery('(min-width: 900px)');
  const fullLogo = Boolean(onBack) && wide;
  const completed = dailies.filter((daily) => daily.done).length;
  const accountLabel = game.accountLabel?.trim();
  const resetLabel = localResetLabel(game, localTz, now);
  const regionLabel = gameServerLabel(game, now);
  return (
    <div className="game-card-heading relative z-10 flex items-center gap-3">
      {onBack && (
        <button
          type="button"
          data-workspace-back
          onClick={onBack}
          aria-label="Back to Today"
          aria-keyshortcuts="Alt+ArrowLeft"
          title="Back to Today (Alt+Left)"
          className="workspace-back shell-control shrink-0"
        >
          <svg viewBox="0 0 20 20" className="icon h-5 w-5" fill="none" stroke="currentColor" aria-hidden>
            <path d="m11 4-6 6 6 6M5 10h11" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
      {layout === 'focus' && <GameLogo game={game} size={fullLogo ? 136 : 72} flippable />}
      <TitleContainer
        type={layout === 'focus' ? undefined : 'button'}
        onClick={layout === 'focus' ? undefined : onEdit}
        className={`game-card-title group/title min-w-0 flex-1 py-0.5 text-left ${layout === 'focus' ? '' : '-ml-1 cursor-pointer rounded-ui-md px-1 transition hover:bg-fill-2'}`}
        aria-label={layout === 'focus' ? undefined : `Edit ${game.name}${accountLabel ? `, ${accountLabel}` : ''}`}
      >
        <div className="game-card-title-row flex min-w-0 items-center gap-2">
          <h2
            className={`min-w-0 ${layout === 'focus' ? 'text-title min-[1600px]:text-heading' : 'truncate text-heading'} text-fg transition group-hover/title:text-fg`}
            style={{ ...titleStyle(game.titleFont), color: `var(--game-ink, ${gameTitleInk(game, ground, 4.5)})` }}
          >
            {game.name}
          </h2>
          {/* Today's dailies sit on the title line, sized to it. */}
          {!game.paused && dailies.length > 0 && (
            <ProgressBar
              variant="ring"
              size={layout === 'focus' ? 40 : 32}
              stroke={3}
              value={completed / dailies.length}
              color={gameInk(game, ground)}
              className="game-daily-ring shrink-0"
              aria-label={`${completed} of ${dailies.length} dailies done`}
              role="img"
            >
              {completed}/{dailies.length}
            </ProgressBar>
          )}
          {accountLabel && layout !== 'focus' && (
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
        <div className="game-card-status mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-label text-muted">
          <ServerChip label={regionLabel} className="max-w-20 truncate" />
          {layout === 'focus' && accountLabel && <span className="[overflow-wrap:anywhere]">{accountLabel}</span>}
          <span>reset {resetLabel}</span>
          {urgent && <AttentionIndicator />}
        </div>
      </TitleContainer>
      {/* Everything the game can do sits in its heading, beside its name. */}
      <div className="game-card-actions flex shrink-0 items-center gap-2" aria-label={`${game.name} tracking controls`}>
        {actions}
        <CatchUpButton game={game} />
        <LiveRefreshButton game={game} />
        <SnipReadingButton game={game} />
        {/* One Edit control for the game's settings and its events. Compact cards keep their title shortcut. */}
        <DropdownMenuPrimitive.Root>
          <Tooltip content={`Edit ${game.name} settings or events`}>
            <DropdownMenuPrimitive.Trigger asChild>
              <Btn
                ref={editRef}
                type="button"
                className={`inline-flex shrink-0 items-center gap-2 ${TOUCH_BUTTON}`}
                aria-label={`Edit ${game.name}`}
              >
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" className="icon h-4 w-4" aria-hidden>
                  <path
                    d="M13.3 3.7a1.7 1.7 0 0 1 2.4 2.4L7.4 14.4 4 15l.6-3.4z"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </Btn>
            </DropdownMenuPrimitive.Trigger>
          </Tooltip>
          <DropdownMenuPrimitive.Portal>
            <DropdownMenuPrimitive.Content
              align="end"
              sideOffset={6}
              className="popover-motion z-50 min-w-44 rounded-ui-lg bg-popover p-1 shadow-float ring-1 ring-line-strong"
              onCloseAutoFocus={(event) => {
                // Opening the events panel moves focus into it, not back to Edit.
                if (!focusEvents.current) return;
                focusEvents.current = false;
                event.preventDefault();
                document.getElementById(eventsPanelId)?.querySelector<HTMLElement>('h2')?.focus();
              }}
            >
              <DropdownMenuPrimitive.Item onSelect={onEdit} className={MENU_ITEM}>
                Game settings
              </DropdownMenuPrimitive.Item>
              <DropdownMenuPrimitive.Item onSelect={toggleEvents} aria-controls={eventsPanelId} className={MENU_ITEM}>
                {managingEvents ? 'Close events' : 'Manage events'}
              </DropdownMenuPrimitive.Item>
            </DropdownMenuPrimitive.Content>
          </DropdownMenuPrimitive.Portal>
        </DropdownMenuPrimitive.Root>
        {actionsEnd}
      </div>
    </div>
  );
}

/**
 * Reads a linked game's live numbers through HoYoLAB or SKPORT. Only shows
 * once the connector says the game is linked.
 */
function LiveRefreshButton({ game }: { game: Game }) {
  const provider = useConnectors((store) =>
    store.status?.hoyolab.gameLinks[game.id] ? 'hoyolab' : store.status?.skport?.gameLinks[game.id] ? 'skport' : null,
  );
  const busy = useConnectors((store) => Boolean(store.busy[`refresh:${game.id}`]));
  const waiting = useConnectors((store) => {
    const until = store.status?.hoyolab.backoffUntilMs;
    return provider === 'hoyolab' && until != null && until > Date.now();
  });
  const [failure, setFailure] = useState('');
  if (!provider || game.paused) return null;
  const name = provider === 'skport' ? 'SKPORT' : 'HoYoLAB';
  const refresh = () => {
    setFailure('');
    // The connectors load on the first press, never with Today.
    void import('../connectors')
      .then(({ refreshHoyolab, refreshSkport }) =>
        provider === 'skport' ? refreshSkport(game.id) : refreshHoyolab(game.id),
      )
      .catch(() => undefined)
      .then((applied) => {
        if (applied === undefined) setFailure(useConnectors.getState().notice?.text ?? `${name} could not be read.`);
      });
  };
  return (
    <Tooltip content={failure || (waiting ? `${name} asked Memoria to wait` : `Read live numbers from ${name}`)}>
      <Btn
        type="button"
        className={`relative inline-flex shrink-0 items-center gap-2 ${TOUCH_BUTTON}`}
        aria-label={`Refresh live numbers for ${game.name}`}
        aria-busy={busy || undefined}
        disabled={busy || waiting}
        onClick={refresh}
      >
        <svg
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          className={`icon h-4 w-4 ${busy ? 'motion-safe:animate-spin' : ''}`}
          aria-hidden
        >
          <path d="M15.5 8a6 6 0 0 0-10.6-2.3M4.5 12a6 6 0 0 0 10.6 2.3" strokeLinecap="round" />
          <path d="M4.6 3v3h3M15.4 17v-3h-3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {failure && <span aria-hidden className="catch-up-dot" />}
        <span role="status" className="sr-only">
          {failure}
        </span>
      </Btn>
    </Tooltip>
  );
}

/** Drags a region of the screen to read in, in the Windows app. Every game can use it, whatever its numbers look like. */
function SnipReadingButton({ game }: { game: Game }) {
  const busy = useConnectors((store) => Boolean(store.busy.capture));
  if (game.paused || !window.memoriaDesktop?.connectors?.screenshot?.capture) return null;
  // A plain title, not a Tooltip: the shortcut hint should not show twice.
  return (
    <Btn
      type="button"
      className={`inline-flex shrink-0 items-center gap-2 ${TOUCH_BUTTON}`}
      aria-label="Snip screenshot reading"
      title="Snip screenshot reading (Shift+S)"
      aria-busy={busy || undefined}
      disabled={busy}
      onClick={() =>
        void import('../connectors').then(
          ({ captureScreenshot }) => captureScreenshot('snip'),
          () => undefined,
        )
      }
    >
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" className="icon h-4 w-4" aria-hidden>
        <path
          d="M3 7V4.5A1.5 1.5 0 0 1 4.5 3H7M13 3h2.5A1.5 1.5 0 0 1 17 4.5V7M17 13v2.5a1.5 1.5 0 0 1-1.5 1.5H13M7 17H4.5A1.5 1.5 0 0 1 3 15.5V13"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path d="M7.5 10h5M10 7.5v5" strokeLinecap="round" />
      </svg>
    </Btn>
  );
}

/** Opens the game's News tab, where it catches up; a dot marks unread versions. */
function CatchUpButton({ game }: { game: Game }) {
  const { total, unread } = useCatchUpUnread(game);
  const setGameTab = useUI((s) => s.setGameTab);
  if (total === 0) return null;
  return (
    <Tooltip
      content={unread > 0 ? `${unread} new ${unread === 1 ? 'version' : 'versions'} to catch up on` : 'Catch up'}
    >
      <Btn
        type="button"
        className={`relative inline-flex shrink-0 items-center gap-2 ${TOUCH_BUTTON}`}
        aria-label={`Catch up on ${game.name}${unread > 0 ? `, ${unread} new` : ''}`}
        onClick={() => {
          setGameTab('news');
          openGame(game.id);
        }}
      >
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" className="icon h-4 w-4" aria-hidden>
          <path d="M3 5.5h14v9H3zM7.5 17.5h5M8.5 7.8v4.4L12.3 10z" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {unread > 0 && <span aria-hidden className="catch-up-dot" />}
      </Btn>
    </Tooltip>
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
  onOpenEvent,
  onBack,
  actionsEnd,
  aside,
  heading = true,
  split = false,
}: {
  /** False where the page bar already names the game and holds its actions. */
  heading?: boolean;
  /** A game's own page: energy, tasks, and events with the aside each take a column. */
  split?: boolean;
  entry: GameUrgency;
  state: AppState;
  actions: GameControlActions;
  now: number;
  layout?: 'card' | 'focus';
  columns?: 1 | 2 | 3;
  onOpenEvent: (eventId: string, gameId: string) => void;
  onBack?: () => void;
  /** Joins the end of the heading's actions, after the game's own. */
  actionsEnd?: ReactNode;
  /** The full page's context column: the player's notes. Outside the editable layout. */
  aside?: ReactNode;
}) {
  const { game } = entry;
  const [managingEvents, setManagingEvents] = useState(false);
  const eventsPanelId = useId();
  const editRef = useRef<HTMLButtonElement>(null);
  const updateGame = useApp((store) => store.updateGame);
  const openSheet = useUI((store) => store.openSheet);
  const openSettings = () => openSheet({ kind: 'game', gameId: game.id });
  useEffect(() => {
    if (!onBack) return;
    const returnToToday = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.repeat) return;
      const back = event.key === 'ArrowLeft' && event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
      if (!back) return;
      event.preventDefault();
      // Let the top overlay keep its own dismissal and unsaved-change guard.
      if (
        useUI.getState().sheet ||
        document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]')
      ) {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        return;
      }
      // Match clicking Back: blur commits a typed energy value before unmount.
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      onBack();
    };
    document.addEventListener('keydown', returnToToday);
    return () => document.removeEventListener('keydown', returnToToday);
  }, [onBack]);
  const derived = useDerived(now);
  const identityColors = useIdentityColors(state.games);
  const visualGame = { ...game, ...(identityColors[game.id] ?? {}) };
  // Cadence order and core-first ordering now both belong to groupChecklist —
  // this flat sort used to run AFTER checklistFor's core-first one and silently
  // undo it, so the card ignored the rule that pull-currency tasks lead.
  // Rows a player hid in the retired layout editor, or from Game settings, stay hidden.
  const hidden = new Set(
    game.cardLayout
      ? resolveGameLayout(game, state.resources, state.tasks)
          .filter((item) => item.hidden)
          .map((item) => item.id)
      : [],
  );
  const allChecklist = derived.checklistByGame.get(game.id) ?? [];
  const checklist = allChecklist.filter((item) => !hidden.has(`task:${item.taskId}`));
  const dailies = allChecklist.filter((item) => item.cadence === 'daily');
  const { resource: mainResource } = derived.primaryEnergy(game.id);
  const mainSnap = mainResource ? derived.snaps.get(mainResource.id) : undefined;
  const source = readingSource(mainSnap, now);
  // When the reading was taken only shows when it is worth doubting, or when
  // it was read for the player (an account or a screenshot), so they can see where it came from.
  const stale =
    !mainSnap ||
    !source ||
    source.kind === 'estimate' ||
    now - (mainSnap.provenance?.observedAt ?? mainSnap.takenAt) > STALE_READING_MS;
  const readFor = source?.kind === 'account' || source?.kind === 'screenshot';
  const reading =
    mainResource && !game.paused && (stale || readFor)
      ? {
          resourceId: mainResource.id,
          label: !source ? (
            'No reading yet'
          ) : source.kind === 'estimate' ? (
            source.label
          ) : (
            <Ago
              at={mainSnap!.provenance?.observedAt ?? mainSnap!.takenAt}
              now={now}
              verb={
                source.kind === 'account'
                  ? `Read from ${source.provider ?? 'your account'}`
                  : source.kind === 'screenshot'
                    ? 'Read from a screenshot'
                    : 'Updated'
              }
            />
          ),
        }
      : undefined;
  const session = useSession((store) => store.session);
  const live =
    session && session.gameId === game.id && !game.paused && now - session.startedAt < SESSION_MAX_MS ? session : null;
  const need = live ? sessionNeed(state, game, live, now) : null;
  const sessionBar = live ? sessionResource(state, game.id) : undefined;
  // Doing a task means the player has moved past the reading.
  const sessionActions = useMemo<GameControlActions>(
    () =>
      live
        ? {
            ...actions,
            setTaskDone: (...args) => {
              passSession(game.id, 'energy', 'reserve');
              actions.setTaskDone(...args);
            },
            setTaskCount: (...args) => {
              passSession(game.id, 'energy', 'reserve');
              actions.setTaskCount(...args);
            },
          }
        : actions,
    [actions, game.id, live],
  );

  const resources = (
    <ResourceControls
      game={visualGame}
      state={state}
      hidden={hidden}
      snaps={derived.snaps}
      now={now}
      actions={actions}
      reading={reading}
      session={need && sessionBar ? { resourceId: sessionBar.id, need, pulse: live?.nudged ?? false } : undefined}
    />
  );
  const tasks = <ChecklistControls game={visualGame} checklist={checklist} now={now} actions={sessionActions} />;
  const focus = layout === 'focus';
  const setProgress = (event: GameEvent, progress: EventProgress) =>
    useApp.getState().setEventProgress(event.id, progress);
  const events = !game.paused && !hidden.has('events') && (
    <EventStrip
      game={visualGame}
      events={state.events}
      now={now}
      onOpenEvent={onOpenEvent}
      onSetProgress={focus ? setProgress : undefined}
    />
  );
  return (
    <>
      {/* A game's own page carries its identity and actions in the page bar. */}
      {heading && (
        <GameControlsHeader
          game={visualGame}
          dailies={dailies}
          now={now}
          localTz={state.settings.localTz}
          onEdit={openSettings}
          onBack={onBack}
          editRef={editRef}
          urgent={!game.paused && entry.next != null && entry.next.at - now < 2 * 60 * 60_000}
          layout={layout}
          managingEvents={managingEvents}
          onToggleEvents={() => setManagingEvents((value) => !value)}
          eventsPanelId={eventsPanelId}
          actions={<LaunchButton game={game} />}
          actionsEnd={actionsEnd}
        />
      )}
      {game.paused && (
        <div className="relative z-10 mt-2 flex flex-wrap items-center gap-2">
          <p className="mr-auto text-meta text-muted">Paused</p>
          <Btn className={TOUCH_BUTTON} onClick={() => updateGame(game.id, { paused: false })}>
            Resume tracking
          </Btn>
        </div>
      )}
      <div id={eventsPanelId} hidden={!managingEvents}>
        {managingEvents && (
          <GameEvents key={game.id} game={game} now={now} titled className="mt-4 border-y border-line-edge py-4" />
        )}
      </div>
      <div
        className={`relative z-10 flex flex-1 flex-col ${game.paused ? 'opacity-50' : ''}`}
        data-session-need={need ?? undefined}
        data-session-pulse={(need && live?.nudged) || undefined}
      >
        {layout === 'focus' && split ? (
          // Energy, then tasks, then what is running beside the notes. Narrower
          // pages fold the side column under energy and tasks.
          <div className="game-track-grid" data-cols={columns}>
            <div className="game-track-energy focus-track min-w-0">{resources}</div>
            <div className="game-track-tasks min-w-0">{tasks}</div>
            <div className="game-track-side min-w-0">
              <div className="focus-events min-w-0">{events}</div>
              {aside && <div className="focus-context min-w-0">{aside}</div>}
            </div>
          </div>
        ) : layout === 'focus' ? (
          // Context on the left, what you track in the middle, what is running on the right.
          <div className="focus-bay-grid grid gap-x-8 gap-y-6" data-cols={columns} data-aside={aside ? '' : undefined}>
            <div className="focus-track min-w-0">
              {resources}
              {tasks}
            </div>
            {/* One column (a phone) reads in this order: events come before
                the notes. Wider grids place them by area. */}
            <div className="focus-events min-w-0">{events}</div>
            {aside && <div className="focus-context min-w-0">{aside}</div>}
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
  actionsEnd,
}: {
  entry: GameUrgency;
  now: number;
  layout?: 'card' | 'focus';
  actionsEnd?: ReactNode;
}) {
  const state = useApp((s) => s.state);
  const setTaskDone = useApp((s) => s.setTaskDone);
  const restartTaskTimer = useApp((s) => s.restartTaskTimer);
  const advanceTaskTimer = useApp((s) => s.advanceTaskTimer);
  const setTaskCount = useApp((s) => s.setTaskCount);
  const setEnergy = useApp((s) => s.setEnergy);
  const adjustEnergy = useApp((s) => s.adjustEnergy);
  const actions = useMemo(
    () => ({ setTaskDone, restartTaskTimer, advanceTaskTimer, setTaskCount, setEnergy, adjustEnergy }),
    [adjustEnergy, advanceTaskTimer, restartTaskTimer, setEnergy, setTaskCount, setTaskDone],
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
      onOpenEvent={(eventId) => openSheet({ kind: 'eventPeek', eventId })}
      actionsEnd={actionsEnd}
    />
  );
}
