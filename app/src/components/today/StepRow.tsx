import { useEffect, useRef, useState } from 'react';
import {
  endsOvernight,
  morningOf,
  setEventProgress,
  type EnergyBank,
  type EnergyStep,
  type EventStep,
  type Game,
  type TaskStep,
  type TodayStep,
  type TodayStepGroup,
} from '@memoria/shared';
import { useApp } from '../../store';
import { haptic } from '../../hooks';
import { clamp, intOr } from '../../util';
import { passSession } from '../../session-focus';
import { openGame } from '../../workspace-navigation';
import { ValueStepper } from '../EnergyRow';
import { GameLogo } from '../GameLogo';
import { NightMark } from '../NightMark';
import { Tick } from '../primitives';
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
    <span className="today-step-bank" data-full={bank.full || undefined} title={`${bank.label} for ${owner}`}>
      <span aria-hidden className="today-step-bank-tube">
        <i style={{ transform: `scaleX(${fill})`, background: color }} />
      </span>
      <span aria-hidden className="today-step-bank-figure numeral">
        <b>{figure}</b>/{compactCount(bank.cap)}
      </span>
      <span className="sr-only">
        {bank.label}: {bank.value == null ? 'not read yet' : `${bank.value} of ${bank.cap}`}
      </span>
    </span>
  );
}

/**
 * The bar's value, as the card enters it: type it, or step it by one. The ±1
 * buttons show on hover and focus. Entry follows EnergyRow: Enter commits even
 * an unchanged value (a fresh reading), a blur commits only a real edit, Escape
 * throws the draft away, and A/S/D/F step it.
 */
function EnergyControl({ step, game, ink, bankInk }: { step: EnergyStep; game: Game; ink: string; bankInk: string }) {
  const setEnergy = useApp((store) => store.setEnergy);
  const [draft, setDraft] = useState<string | null>(null);
  const edit = useRef({ dirty: false, cancelled: false });
  const live = useRef(step.value);
  useEffect(() => {
    live.current = step.value;
  }, [step.value]);
  const shown = draft ?? String(step.value);
  // Without a reserve figure the store carries the projected reserve over, so it is kept.
  const commit = (value: number) => {
    setEnergy(step.resourceId, clamp(Math.round(value), 0, step.cap));
    passSession(game.id, 'energy');
    setDraft(null);
    edit.current.dirty = false;
  };
  return (
    <span className="today-step-energy">
      <ValueStepper
        value={shown}
        cap={step.cap}
        color={ink}
        label={step.name}
        ariaLabel={`${step.name} current value`}
        valueClassName="text-body font-bold leading-none"
        onStep={(delta) => commit((draft != null && draft !== '' ? intOr(draft, live.current) : live.current) + delta)}
        onBeginEdit={() => {
          edit.current = { dirty: false, cancelled: false };
          setDraft(String(live.current));
        }}
        onDraft={(text) => {
          edit.current.dirty = true;
          setDraft(text);
        }}
        onCommit={() => commit(intOr(shown, live.current))}
        onCancel={() => {
          edit.current.cancelled = true;
          setDraft(null);
        }}
        onEndEdit={() => {
          const { cancelled, dirty } = edit.current;
          if (!cancelled && dirty && draft != null && draft !== '' && intOr(draft, -1) !== live.current) {
            commit(intOr(draft, live.current));
          } else setDraft(null);
          edit.current = { dirty: false, cancelled: false };
        }}
      />
      {step.bank && <BankMeter bank={step.bank} color={bankInk} owner={step.name} />}
    </span>
  );
}

function TaskControl({ step, ink, what, now }: { step: TaskStep; ink: string; what: string; now: number }) {
  const setTaskDone = useApp((store) => store.setTaskDone);
  const setTaskCount = useApp((store) => store.setTaskCount);
  const restartTaskTimer = useApp((store) => store.restartTaskTimer);
  const advanceTaskTimer = useApp((store) => store.advanceTaskTimer);
  const { item } = step;
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
            setTaskCount(item.taskId, item.periodKey, item.done ? 0 : Math.min(item.countTarget, item.countDone + 1));
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
          else restartTaskTimer(item.taskId, item.periodKey);
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
  const upsertEvent = useApp((store) => store.upsertEvent);
  const done = step.event.done === true;
  return (
    <button
      type="button"
      className="today-step-tick"
      aria-label={`Mark ${step.event.name} done`}
      aria-pressed={done}
      onClick={() => {
        haptic();
        upsertEvent({ id: step.event.id, gameId: step.event.gameId, ...setEventProgress(done ? 'none' : 'done') });
      }}
    >
      <Tick checked={done} color={ink} className="today-tick-face" />
    </button>
  );
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
  return (
    <li className="today-step" data-step={step.key} data-kind={step.kind} data-done={step.done || undefined}>
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
            {why && <> · {why}</>}
          </span>
        </span>
      </button>
      <span className="today-step-ctl">
        {step.kind === 'energy' ? (
          <EnergyControl step={step} game={game.game} ink={game.text} bankInk={game.support} />
        ) : step.kind === 'task' ? (
          <TaskControl step={step} ink={game.ink} what={what} now={now} />
        ) : (
          <EventControl step={step} ink={game.ink} />
        )}
      </span>
      <span id={whenId} className="today-step-when numeral" data-tone={stepTone(step, group, settings, now)}>
        <b>{step.done ? 'Done' : countdown(left)}</b>
        <span>
          {step.kind === 'event' && !step.done && endsOvernight(step.at, zone, morningOf(settings)) && (
            <NightMark at={step.at} tz={zone} />
          )}
          {hhmm(step.at, zone)}
        </span>
      </span>
    </li>
  );
}
