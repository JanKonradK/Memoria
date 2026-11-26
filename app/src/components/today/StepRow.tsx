import { useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  endsOvernight,
  EVENT_STEPS,
  eventPartsDone,
  morningOf,
  type EnergyBank,
  type EnergyStep,
  type EventStep,
  type Game,
  type TaskStep,
  type TodayStep,
  type TodayStepGroup,
} from '@memoria/shared';
import { useApp } from '../../store';
import { useUI } from '../../ui-store';
import { haptic } from '../../hooks';
import { useScrub } from '../../scrub';
import { SwipeRow, type SwipeAction } from '../../swipe-row';
import { clamp, intOr } from '../../util';
import { passSession } from '../../session-focus';
import { openGame } from '../../workspace-navigation';
import { ValueStepper } from '../EnergyRow';
import { EventTick } from '../GameCard';
import { GameLogo } from '../GameLogo';
import { NightMark } from '../NightMark';
import { Pill, Tick } from '../primitives';
import { Tooltip } from '../ui';
import { useCheckInClaim } from '../CheckInClaim';
import { cadenceNoun, countdown, hhmm, stepTone } from './step-format';

export interface StepGame {
  game: Game;
  /** The game's identity colours applied, for its logo. */
  logo: Game;
  ink: string;
  /** The ink lifted to body-text contrast, for names and figures. */
  text: string;
  /** The game's second colour, for what banks its bar. */
  support: string;
  /** Which account this is, where the roster holds the game more than once; else empty. */
  account: string;
}

/** The game's name with its account, for a screen reader or a tooltip: "Genshin Impact (EU)". */
export function gameWithAccount(game: StepGame, short = false): string {
  const name = short ? game.game.short : game.game.name;
  return game.account ? `${name} (${game.account})` : name;
}

/**
 * Enter in a reading moves to the next reading in the list (Shift: the one
 * before), the way a form moves through its fields. At either end it stays put
 * and selects the figure again, ready for a correction.
 */
export function focusNextReading(from: HTMLElement | null, reverse: boolean): void {
  const list = from?.closest('.today-steps');
  if (!from || !list) return;
  const inputs = [...list.querySelectorAll<HTMLInputElement>('.energy-value-input')];
  const at = inputs.indexOf(from as HTMLInputElement);
  const next = inputs[at + (reverse ? -1 : 1)] ?? (from as HTMLInputElement);
  if (next !== from) next.focus();
  next.select();
}

/** 1,240 → 1.2k: a reserve's figure has to fit under the pill. */
export function compactCount(value: number): string {
  if (value < 1000) return String(value);
  const k = value / 1000;
  return `${k >= 10 ? Math.round(k) : Math.floor(k * 10) / 10}k`;
}

/**
 * The bar's second row, under its pill: what banks its overflow. A reserve
 * fills while the bar is capped; a crafted stock (Condensed Resin) waits to be
 * made. Read-only here; the game's page enters it.
 */
export function BankMeter({ bank, color, owner }: { bank: EnergyBank; color: string; owner: string }) {
  const fill = bank.value == null || bank.cap <= 0 ? 0 : Math.min(1, bank.value / bank.cap);
  const figure = bank.value == null ? '—' : compactCount(bank.value);
  return (
    <Tooltip content={`${bank.label} for ${owner}`}>
      <span className="today-step-bank" data-full={bank.full || undefined}>
        <span aria-hidden className="today-step-bank-tube meter" style={{ '--meter-ink': color } as CSSProperties}>
          <i style={{ transform: `scaleX(${fill})`, background: color }} />
        </span>
        <span aria-hidden className="today-step-bank-figure numeral">
          <b>{figure}</b>/{compactCount(bank.cap)}
        </span>
        <span className="sr-only">
          {bank.label}: {bank.value == null ? 'not read yet' : `${bank.value} of ${bank.cap}`}
        </span>
      </span>
    </Tooltip>
  );
}

/** A press on the tray must not take focus from the field it changes: the keyboard stays up. */
const keepFocus = (event: { preventDefault: () => void }) => event.preventDefault();
const TRAY_STEPS = [-10, -1, 1, 10] as const;

/**
 * The bar's value, as the card enters it: type it, or step it by one. The ±1
 * buttons show on hover and focus. Entry follows EnergyRow: Enter commits even
 * an unchanged value (a fresh reading), a blur commits only a real edit, Escape
 * throws the draft away, and A/S/D/F step it.
 *
 * On a phone the ± buttons never squeeze in beside the pill, which shifted the
 * row sideways as it took focus. While the field has focus a tray opens under
 * the whole row instead: ±10 and ±1, then Spent all and Full, set apart.
 */
function EnergyControl({
  step,
  game,
  ink,
  bankInk,
  tray,
}: {
  step: EnergyStep;
  game: Game;
  ink: string;
  bankInk: string;
  /** Narrow rows: steps and quick values in a tray under the row while the field has focus. */
  tray: boolean;
}) {
  const setEnergy = useApp((store) => store.setEnergy);
  const [draft, setDraft] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const trayRef = useRef<HTMLDivElement>(null);
  const edit = useRef({ dirty: false, cancelled: false });
  const live = useRef(step.value);
  useEffect(() => {
    live.current = step.value;
  }, [step.value]);
  const shown = draft ?? (step.unmeasured ? '' : String(step.value));
  const field = useRef<HTMLSpanElement>(null);
  // Without a reserve figure the store carries the projected reserve over, so it is kept.
  const commit = (value: number) => {
    setEnergy(step.resourceId, clamp(Math.round(value), 0, step.cap));
    passSession(game.id, 'energy');
    setDraft(null);
    edit.current.dirty = false;
  };
  // Dragging sideways across the reading moves it: the row's width is the whole bar.
  const scrub = useScrub({
    cap: step.cap,
    value: step.value,
    mode: 'relative',
    measure: (zone) => zone.closest<HTMLElement>('.today-step'),
    onDraft: (value) => setDraft(String(value)),
    onCommit: (value) => commit(value),
    onCancel: () => setDraft(null),
  });
  const stepBy = (delta: number) =>
    commit((draft != null && draft !== '' ? intOr(draft, live.current) : live.current) + delta);
  // Focus leaving for the tray keeps it open; leaving both closes it.
  const stillHere = (next: EventTarget | null) =>
    next instanceof Node && (Boolean(trayRef.current?.contains(next)) || Boolean(field.current?.contains(next)));
  return (
    <>
      <span className="today-step-ctl">
        <span ref={field} className="today-step-energy" {...scrub}>
          <ValueStepper
            value={shown}
            placeholder={step.unmeasured ? '—' : undefined}
            cap={step.cap}
            color={ink}
            label={step.name}
            ariaLabel={`${step.name} current value`}
            valueClassName="text-body font-bold leading-none"
            onStep={stepBy}
            onBeginEdit={() => {
              setEditing(true);
              edit.current = { dirty: false, cancelled: false };
              setDraft(step.unmeasured ? '' : String(live.current));
            }}
            onDraft={(text) => {
              edit.current.dirty = true;
              setDraft(text);
            }}
            onCommit={() => {
              // An empty field on a bar never read has nothing to save.
              if (step.unmeasured && shown === '') setDraft(null);
              else commit(intOr(shown, live.current));
            }}
            onCommitNext={(reverse) =>
              focusNextReading(field.current?.querySelector<HTMLElement>('.energy-value-input') ?? null, reverse)
            }
            onCancel={() => {
              edit.current.cancelled = true;
              setDraft(null);
            }}
            onEndEdit={(event) => {
              const { cancelled, dirty } = edit.current;
              if (!cancelled && dirty && draft != null && draft !== '' && intOr(draft, -1) !== live.current) {
                commit(intOr(draft, live.current));
              } else setDraft(null);
              edit.current = { dirty: false, cancelled: false };
              if (!stillHere(event?.relatedTarget ?? null)) setEditing(false);
            }}
          />
          {step.bank && <BankMeter bank={step.bank} color={bankInk} owner={step.name} />}
        </span>
      </span>
      {tray && editing && (
        <div
          ref={trayRef}
          className="today-step-tray"
          role="group"
          aria-label={`${step.name} quick changes`}
          onBlur={(event) => {
            if (!stillHere(event.relatedTarget)) setEditing(false);
          }}
        >
          {TRAY_STEPS.map((delta) => (
            <button
              key={delta}
              type="button"
              className="today-step-chip numeral"
              aria-label={`${delta > 0 ? 'Increase' : 'Decrease'} ${step.name} by ${Math.abs(delta)}`}
              onPointerDown={keepFocus}
              onMouseDown={keepFocus}
              onClick={() => stepBy(delta)}
            >
              {delta > 0 ? `+${delta}` : `−${-delta}`}
            </button>
          ))}
          <span aria-hidden className="today-step-tray-rule" />
          <button
            type="button"
            className="today-step-chip"
            data-quick-set
            aria-label={`Spent all ${step.name}`}
            onPointerDown={keepFocus}
            onMouseDown={keepFocus}
            onClick={() => runWithUndo(`${step.name} set to 0`, () => commit(0))}
          >
            Spent all
          </button>
          <button
            type="button"
            className="today-step-chip"
            data-quick-set
            aria-label={`${step.name} full`}
            onPointerDown={keepFocus}
            onMouseDown={keepFocus}
            onClick={() => runWithUndo(`${step.name} set to full`, () => commit(step.cap))}
          >
            Full
          </button>
        </div>
      )}
    </>
  );
}

/**
 * Records a reversible task reset or timer restart under an Undo toast,
 * matching the card's batch-action Undo affordance.
 */
function runWithUndo(label: string, run: () => void): void {
  const before = useApp.getState?.()?.history?.journal?.at(-1)?.id;
  run();
  const actionId = useApp.getState?.()?.history?.journal?.at(-1)?.id;
  if (actionId && actionId !== before) {
    useUI.getState().showUndo(label, () => useApp.getState().undoActivity(actionId));
  }
}

function TaskControl({ step, ink, what, now }: { step: TaskStep; ink: string; what: string; now: number }) {
  const setTaskDone = useApp((store) => store.setTaskDone);
  const setTaskCount = useApp((store) => store.setTaskCount);
  const restartTaskTimer = useApp((store) => store.restartTaskTimer);
  const advanceTaskTimer = useApp((store) => store.advanceTaskTimer);
  const { item } = step;
  const checkIn = useCheckInClaim(item, setTaskDone);
  if (item.mode === 'count') {
    return (
      <span className="today-step-count">
        <span className="numeral text-meta font-semibold text-fg-soft" aria-hidden>
          {item.countDone}/{item.countTarget}
        </span>
        <button
          type="button"
          className="today-step-tick"
          aria-label={`${what}: ${item.countDone} of ${item.countTarget} done${item.done ? ', complete — press to reset' : ', press to mark one more'}`}
          onClick={() => {
            haptic();
            if (item.done) {
              runWithUndo(`${what} reset`, () => setTaskCount(item.taskId, item.periodKey, 0));
            } else {
              setTaskCount(item.taskId, item.periodKey, Math.min(item.countTarget, item.countDone + 1));
            }
          }}
        >
          <Tick
            checked={item.done}
            segments={{ current: item.countDone, total: item.countTarget }}
            color={ink}
            className="today-tick-face"
          />
        </button>
      </span>
    );
  }
  if (item.mode === 'timer') {
    const stepped = item.timerRunning && item.timerStepMinutes != null;
    const left = item.timerEndsAt != null ? item.timerEndsAt - now : 0;
    const total = item.timerDurationMinutes * 60_000;
    return (
      <button
        type="button"
        className="today-step-tick"
        aria-label={`${what}: ${stepped ? 'take time off the timer' : item.timerReady && !item.done ? 'collect and resend' : item.done ? 'collected — resend again now' : 'mark collected and resent'}`}
        aria-pressed={item.done}
        onClick={() => {
          haptic();
          if (stepped) advanceTaskTimer(item.taskId, item.periodKey, item.timerStepMinutes ?? 0);
          else {
            runWithUndo(item.done ? `${what} restarted` : `${what} timer started`, () =>
              restartTaskTimer(item.taskId, item.periodKey),
            );
          }
        }}
      >
        <Tick
          checked={item.done}
          fraction={!item.done && item.timerRunning && total > 0 ? clamp(1 - left / total, 0, 1) : undefined}
          color={ink}
          className="today-tick-face"
        />
      </button>
    );
  }
  if (item.link && checkIn.available) {
    // A linked HoYoLAB check-in: the tick claims it; a failure says why and offers the page.
    return (
      <span className="today-step-count">
        {checkIn.failure && (
          <>
            <Pill variant={checkIn.failure.tone}>{checkIn.failure.label}</Pill>
            <span role="status" className="sr-only">
              {checkIn.failure.message}
            </span>
            <a
              href={item.link}
              target="_blank"
              rel="noreferrer"
              aria-label={`Open ${what}`}
              className="min-h-11 content-center px-1 text-meta font-semibold text-accent-fg underline underline-offset-4 fine:min-h-8"
            >
              Open ↗
            </a>
          </>
        )}
        <button
          type="button"
          className="today-step-tick"
          aria-label={checkIn.busy ? `Claiming ${what}` : `Claim ${what}`}
          aria-busy={checkIn.busy}
          disabled={checkIn.busy}
          onClick={() => {
            haptic();
            checkIn.claim();
          }}
        >
          <Tick checked={false} color={ink} className="today-tick-face" />
        </button>
      </span>
    );
  }
  return (
    <button
      type="button"
      className="today-step-tick"
      aria-label={`Mark ${what} done`}
      aria-pressed={item.done}
      onClick={() => {
        haptic();
        setTaskDone(item.taskId, item.periodKey, !item.done);
      }}
    >
      <Tick checked={item.done} color={ink} className="today-tick-face" />
    </button>
  );
}

function EventControl({ step, ink }: { step: EventStep; ink: string }) {
  const toggleEventDone = useApp((store) => store.toggleEventDone);
  const done = step.event.done === true;
  return (
    <button
      type="button"
      className="today-step-tick"
      aria-label={`Mark ${step.event.name} done`}
      aria-pressed={done}
      onClick={() => {
        haptic();
        toggleEventDone(step.event.id);
      }}
    >
      {/* Partly done shows as a part-filled ring; a tap still means done, or not done. */}
      <EventTick ticked={eventPartsDone(step.event)} total={EVENT_STEPS} color={ink} className="today-tick-face" />
    </button>
  );
}

/** The swipes a step answers: right completes, left takes back. Energy has neither; it scrubs. */
function useStepSwipes(step: TodayStep): { right: SwipeAction | null; left: SwipeAction | null } {
  const setTaskDone = useApp((store) => store.setTaskDone);
  const setTaskCount = useApp((store) => store.setTaskCount);
  const restartTaskTimer = useApp((store) => store.restartTaskTimer);
  const advanceTaskTimer = useApp((store) => store.advanceTaskTimer);
  const setEventProgress = useApp((store) => store.setEventProgress);
  if (step.kind === 'energy') return { right: null, left: null };
  if (step.kind === 'event') {
    const { event } = step;
    const done = event.done === true;
    const set = (to: 'done' | 'none') => () => setEventProgress(event.id, to);
    return {
      right: done ? null : { label: 'Done', run: set('done') },
      left: done ? { label: 'Not done', run: set('none') } : null,
    };
  }
  const { item } = step;
  if (item.mode === 'count') {
    return {
      right: item.done
        ? null
        : {
            label: '+1',
            run: () => setTaskCount(item.taskId, item.periodKey, Math.min(item.countTarget, item.countDone + 1)),
          },
      left:
        item.countDone > 0
          ? { label: '−1', run: () => setTaskCount(item.taskId, item.periodKey, Math.max(0, item.countDone - 1)) }
          : null,
    };
  }
  if (item.mode === 'timer') {
    const stepped = item.timerRunning && item.timerStepMinutes != null;
    return {
      right: stepped
        ? { label: 'Sooner', run: () => advanceTaskTimer(item.taskId, item.periodKey, item.timerStepMinutes ?? 0) }
        : {
            label: item.done ? 'Resend' : 'Collect',
            run: () =>
              runWithUndo(item.done ? `${item.name} restarted` : `${item.name} timer started`, () =>
                restartTaskTimer(item.taskId, item.periodKey),
              ),
          },
      left: null,
    };
  }
  return {
    right: item.done ? null : { label: 'Done', run: () => setTaskDone(item.taskId, item.periodKey, true) },
    left: item.done ? { label: 'Not done', run: () => setTaskDone(item.taskId, item.periodKey, false) } : null,
  };
}

/** What the step is: the thing itself, never an instruction. Its figures say the rest. */
export function stepWhat(step: TodayStep): string {
  if (step.kind === 'energy') return step.name;
  if (step.kind === 'event') return step.event.name;
  return step.item.name;
}

/**
 * The few words after the game's name, only where the row's own figures do not
 * already say it: the time sits at the row's end, the reset in its group's title.
 */
function stepWhy(step: TodayStep, group: TodayStepGroup, compact: boolean): string {
  if (step.kind === 'energy') {
    if (step.unmeasured) return 'not read yet';
    if (!step.full) return '';
    const bank = step.bank;
    // A reserve still filling keeps what the bar cannot; once it is full too, nothing does.
    // A phone has no room for the reserve's name: its meter under the value shows it filling.
    return bank?.kind === 'reserve' && !bank.full && !compact ? `full → ${bank.label}` : 'full';
  }
  if (step.kind === 'event') return step.more ? `ends · +${step.more}` : 'ends';
  return group.kind === 'reset' ? '' : cadenceNoun(step.item.cadence, 1);
}

export function StepRow({
  step,
  group,
  index,
  game,
  now,
  zone,
  settings,
  compact,
}: {
  step: TodayStep;
  group: TodayStepGroup;
  index: number;
  game: StepGame;
  now: number;
  zone: string;
  settings: Parameters<typeof stepTone>[2];
  compact: boolean;
}) {
  const what = stepWhat(step);
  const why = stepWhy(step, group, compact);
  const left = step.at - now;
  const whenId = `today-step-when-${step.key}`;
  const tone = stepTone(step, group, settings, now);
  const swipes = useStepSwipes(step);
  const unmeasured = step.kind === 'energy' && step.unmeasured === true;
  return (
    <SwipeRow
      as="li"
      right={swipes.right}
      left={swipes.left}
      ink={game.ink}
      className="today-step"
      data-step={step.key}
      data-kind={step.kind}
      data-done={step.done || undefined}
      data-tone={step.done ? undefined : tone}
      style={{ '--step-ink': game.ink } as CSSProperties}
    >
      <span className="today-step-idx numeral" aria-hidden>
        {index}
      </span>
      <button
        type="button"
        className="today-step-open"
        aria-describedby={whenId}
        onClick={() => openGame(game.game.id)}
      >
        <GameLogo game={game.logo} size={compact ? 36 : 40} />
        <span className="today-step-text">
          <span className="today-step-what">{what}</span>{' '}
          <span className="today-step-why">
            <b style={{ color: game.text }}>{compact ? game.game.short : game.game.name}</b>
            {game.account && (
              <>
                {' · '}
                <span className="today-step-account">{game.account}</span>
              </>
            )}
            {why && <> · {why}</>}
          </span>
        </span>
      </button>
      {step.kind === 'energy' ? (
        // Its own control cell, and on a phone the tray under the row.
        <EnergyControl step={step} game={game.game} ink={game.text} bankInk={game.support} tray={compact} />
      ) : (
        <span className="today-step-ctl">
          {step.kind === 'task' ? (
            <TaskControl step={step} ink={game.ink} what={what} now={now} />
          ) : (
            <EventControl step={step} ink={game.ink} />
          )}
        </span>
      )}
      <span id={whenId} className="today-step-when numeral" data-tone={tone}>
        {unmeasured ? (
          // A bar never read has no cap to count down to; it asks for a reading.
          <b className="today-step-ask">Enter reading</b>
        ) : (
          <>
            <b>{step.done ? 'Done' : countdown(left)}</b>
            <span>
              {step.kind === 'event' && !step.done && endsOvernight(step.at, zone, morningOf(settings)) && (
                <NightMark at={step.at} tz={zone} />
              )}
              {hhmm(step.at, zone)}
            </span>
          </>
        )}
      </span>
    </SwipeRow>
  );
}
