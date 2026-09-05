import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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

const CADENCE_ORDER = ['daily', 'custom', 'weekly', 'monthly'] as const;
const CADENCE_LABEL = { daily: 'Daily', custom: 'Cycle', weekly: 'Weekly', monthly: 'Monthly' } as const;

/** Undone tasks escalate as their reset approaches: amber < 2h, pulsing red < 20 min. */
const TASK_DANGER_MS = 20 * 60_000;
const TASK_WARN_MS = 120 * 60_000;

/** Shared geometry for every task row, so the three modes read as one list. */
const TASK_ROW =
  'group flex min-h-11 w-full items-center gap-2 rounded-ui-md px-1.5 py-1 text-left transition duration-(--dur-fast) hover:bg-fill-2 sm:min-h-8';

type TaskTone = 'done' | 'waiting' | 'idle' | 'warn' | 'danger';

const TASK_TONE: Record<Exclude<TaskTone, 'idle'>, string> = {
  done: 'text-dim',
  // A dispatch is out and nothing can be done about it until it returns.
  // Neither owed nor finished, so neither bright nor struck through.
  waiting: 'text-dim',
  danger: 'warn-pulse font-bold text-danger-fg',
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
    <span className={`min-w-0 flex-1 truncate text-body transition duration-(--dur-fast) ${ink}`}>
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
    <div className="mt-3 flex items-center gap-2 first:mt-0">
      <span className="shrink-0 text-label font-semibold uppercase tracking-wider text-muted">{label}</span>
      <span aria-hidden className="h-px min-w-4 flex-1 bg-line-hairline" />
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
}: {
  cadence: ChecklistItem['cadence'];
  done: number;
  total: number;
  resetAt: number | null;
  now: number;
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
        <Tooltip
          content={`Everything ${CADENCE_LABEL[cadence].toLowerCase()} resets then · d = days, h = hours, m = minutes`}
        >
          <span className={`shrink-0 text-caption tabular-nums ${tone}`}>{fmtDur(left)}</span>
        </Tooltip>
      )}
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

/** Circular tick box at the right edge of a row: sweep plays, then the tick pops. */
function CompletionTick({ done, color }: { done: boolean; color: string }) {
  const { sweep, checkEnter, end } = useCompletionSweep(done);
  return <Tick checked={done} color={color} sweep={sweep} checkEnter={checkEnter} onSweepEnd={end} />;
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
    >
      <TaskName tone={tone} core={item.core}>
        {item.name}
      </TaskName>
      {waitingToCollect ? (
        <span className="shrink-0 text-meta font-bold text-ok-fg">Collect</span>
      ) : running ? (
        <Tooltip content="When this dispatch comes back. Nothing to do until then.">
          <span className="shrink-0 text-meta tabular-nums text-dim">back {fmtDur(left)}</span>
        </Tooltip>
      ) : null}
      {/* Done is a check like every other row on the card. A run still out is
          the one case that earns the arc instead: it is neither owed nor done,
          and the arc is the only shape that says so. */}
      {!item.done && running ? (
        <Tick fraction={fraction} color={color} />
      ) : (
        <CompletionTick done={item.done} color={color} />
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
      onClick={onToggle}
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
    <div>
      <BandRule label="Windows" />
      <div className="mt-0.5 space-y-0.5">
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
  const groups = groupChecklist(checklist);
  return (
    <div className="mt-3.5">
      {groups.map((group) => (
        <section key={group.cadence} aria-label={`${CADENCE_LABEL[group.cadence]} tasks for ${game.name}`}>
          <ChecklistGroupRule
            cadence={group.cadence}
            done={group.done}
            total={group.items.length}
            resetAt={group.resetAt}
            now={now}
          />
          <div className="mt-0.5 space-y-0.5">
            {group.items.map((item) =>
              item.mode === 'timer' ? (
                <TimerTaskRow
                  key={`${item.taskId}|${item.periodKey}`}
                  item={item}
                  color={tickColor}
                  now={now}
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
                  showDeadline={group.resetAt == null}
                  onToggle={() => actions.setTaskDone(item.taskId, item.periodKey, !item.done)}
                />
              ),
            )}
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
      {/* The title above is clickable and always was, which is a fine hit area
          and a terrible advertisement — nothing about a heading says "this
          opens an editor". This is the affordance; the heading is the shortcut. */}
      <Tooltip content={`Edit ${game.name} — resources, tasks, colours`}>
        <button
          type="button"
          onClick={onEdit}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-ui-md text-muted opacity-60 transition duration-(--dur-fast) hover:bg-fill-2 hover:text-fg-soft hover:opacity-100 focus-visible:opacity-100 group-hover:opacity-100 sm:h-8 sm:w-8"
          aria-label={`Edit ${game.name}`}
        >
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" className="icon h-4 w-4" aria-hidden>
            <path
              d="M13.3 3.7a1.7 1.7 0 0 1 2.4 2.4L7.4 14.4 4 15l.6-3.4z"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </Tooltip>
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
  // Cadence order and core-first ordering now both belong to groupChecklist —
  // this flat sort used to run AFTER checklistFor's core-first one and silently
  // undo it, so the card ignored the rule that pull-currency tasks lead.
  const checklist = derived.checklistByGame.get(game.id) ?? [];
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
      onEditGame={(gameId) => openSheet({ kind: 'game', gameId })}
      onOpenEvent={(eventId, gameId) => openSheet({ kind: 'event', eventId, gameId })}
    />
  );
}

export const GameCard = memo(function GameCard({
  entry,
  now,
  index = 0,
}: {
  entry: GameUrgency;
  now: number;
  /** Position in the grid, so the rail lays itself out rather than blinking in. */
  index?: number;
}) {
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
      custom={index}
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
