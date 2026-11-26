import { useMemo, useRef, useState, type ReactNode } from 'react';
import { DateTime } from 'luxon';
import type { TodayPlan, TodayStep, TodayStepGroup } from '@memoria/shared';
import type { Derived } from '../../selectors';
import { useMediaQuery } from '../../hooks';
import { gameInk, gameSupport, legible } from '../../game-color';
import { useGround, useInset } from '../../theme';
import { gameAccountTag, useIdentityColors } from '../roster';
import { DayStrip } from './DayStrip';
import { gameWithAccount, StepRow, stepWhat, type StepGame } from './StepRow';
import { TodaySide } from './TodaySide';
import { cadenceNoun, groupTone, hhmm, listNames, weekWhen } from './step-format';
import './today-steps.css';

/** A group longer than this folds after its first few rows. */
const FOLD_OVER = 5;
const FOLD_SHOWN = 4;
/** Finished rows have no reset of their own to name. */
const DONE_GROUP: TodayStepGroup = { key: 'done', kind: 'reset', at: 0, steps: [], gameIds: [] };
/** Other bars are not due within the day: the calm group, with no reset to name. */
const OTHER_GROUP: TodayStepGroup = { key: 'other-bars', kind: 'later', at: 0, steps: [], gameIds: [] };

interface Layout {
  groups: Array<{ group: TodayStepGroup; steps: TodayStep[] }>;
  done: TodayStep[];
}

function layoutOf(plan: TodayPlan): Layout {
  return { groups: plan.groups.map((group) => ({ group, steps: group.steps })), done: plan.done };
}

/**
 * The rows keep the places they had when the player reached into the list.
 * Typing a new value moves its cap and ticking a daily finishes it; neither may
 * pull a row out from under the pointer or the keyboard. Values stay live; only
 * the order waits until the player leaves the list.
 */
function heldLayout(plan: TodayPlan, held: Layout | null): Layout {
  if (!held) return layoutOf(plan);
  const live = new Map<string, TodayStep>();
  for (const group of plan.groups) for (const step of group.steps) live.set(step.key, step);
  for (const step of plan.done) live.set(step.key, step);
  const placed = new Set<string>();
  const pick = (steps: TodayStep[]) =>
    steps.flatMap((step) => {
      const current = live.get(step.key);
      if (!current) return [];
      placed.add(step.key);
      return [current];
    });
  const groups = held.groups.map(({ group, steps }) => ({
    group: plan.groups.find((item) => item.key === group.key) ?? group,
    steps: pick(steps),
  }));
  const done = pick(held.done);
  // Anything new joins the end of its own group, or a new group at the end.
  for (const group of plan.groups) {
    const fresh = group.steps.filter((step) => !placed.has(step.key));
    if (!fresh.length) continue;
    const home = groups.find((item) => item.group.key === group.key);
    if (home) home.steps.push(...fresh);
    else groups.push({ group, steps: fresh });
  }
  return { groups: groups.filter((item) => item.steps.length > 0), done };
}

/** The rows' order and membership, to tell whether a held list has fallen behind the live one. */
function layoutOrder(layout: Layout): string {
  return [
    ...layout.groups.map(({ group, steps }) => `${group.key}:${steps.map((step) => step.key).join(',')}`),
    `done:${layout.done.map((step) => step.key).join(',')}`,
  ].join('|');
}

function groupTitle(group: TodayStepGroup, plan: TodayPlan, games: Map<string, StepGame>, zone: string, now: number) {
  if (group.kind === 'hour') return { title: 'Within the hour', sub: `by ${hhmm(now + 3_600_000, zone)}` };
  if (group.kind === 'evening') {
    return { title: 'This evening', sub: `by ${hhmm(plan.quiet!.start, zone)}` };
  }
  if (group.kind === 'later') {
    const last = group.steps.at(-1)!.at;
    const sameDay = DateTime.fromMillis(last, { zone }).hasSame(DateTime.fromMillis(now, { zone }), 'day');
    return sameDay ? { title: 'Later today', sub: '' } : { title: 'Later', sub: `by ${weekWhen(last, now, zone)}` };
  }
  const tasks = group.steps.flatMap((step) => (step.kind === 'task' ? [step.item.cadence] : []));
  const cadence = tasks.every((item) => item === tasks[0]) ? tasks[0] : undefined;
  const names = group.gameIds.map((id) => {
    const game = games.get(id);
    return game ? gameWithAccount(game, true) : '';
  });
  return {
    title: `Reset ${hhmm(group.at, zone)}`,
    sub: `${listNames(names)}${cadence ? ` ${cadenceNoun(cadence, 2)}` : ''}`,
  };
}

export function TodaySteps({ derived, empty }: { derived: Derived; empty: ReactNode }) {
  const { state, now } = derived;
  const plan = derived.todaySteps();
  const zone = state.settings.localTz;
  const ground = useGround();
  const inset = useInset();
  const colors = useIdentityColors(state.games);
  const compact = useMediaQuery('(max-width: 767px)');
  const games = useMemo(() => {
    const map = new Map<string, StepGame>();
    for (const game of state.games) {
      if (game.deleted || game.paused) continue;
      const logo = { ...game, ...colors[game.id] };
      const ink = gameInk(logo, ground);
      // Checked on the inset well the energy figure sits in, the darker of the two grounds in light mode.
      map.set(game.id, {
        game,
        logo,
        ink,
        text: legible(ink, inset, 4.5),
        support: legible(gameSupport(logo, ground), inset, 3),
        account: gameAccountTag(game, state.games),
      });
    }
    return map;
  }, [colors, ground, inset, state.games]);

  // Held while focus or the pointer is in the list; released when both leave.
  const [held, setHeld] = useState<Layout | null>(null);
  const inside = useRef({ focus: false, pointer: false });
  const hold = () => setHeld((current) => current ?? layoutOf(plan));
  const release = () => {
    if (!inside.current.focus && !inside.current.pointer) setHeld(null);
  };
  const layout = heldLayout(plan, held);
  // The live order moved on while the list was held: say so, and offer it.
  const orderPending = held !== null && layoutOrder(layout) !== layoutOrder(layoutOf(plan));
  const otherBars = plan.otherBars.filter((step) => games.has(step.gameId));

  const [unfolded, setUnfolded] = useState<ReadonlySet<string>>(new Set());
  const [doneOpen, setDoneOpen] = useState(false);
  const week = plan.week.filter((item) => games.has(item.gameId));
  // Each group's first number: the count runs on across groups, folded rows included.
  const starts = layout.groups.reduce<number[]>(
    (acc, _, at) => [...acc, at === 0 ? 1 : acc[at - 1]! + layout.groups[at - 1]!.steps.length],
    [],
  );

  return (
    <>
      <DayStrip plan={plan} now={now} settings={state.settings} games={games} />
      <div className="today-steps-body">
        <div
          className="today-steps"
          onFocus={() => {
            inside.current.focus = true;
            hold();
          }}
          onBlur={(event) => {
            if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
            inside.current.focus = false;
            release();
          }}
          onPointerEnter={(event) => {
            if (event.pointerType !== 'mouse') return;
            inside.current.pointer = true;
            hold();
          }}
          onPointerLeave={() => {
            inside.current.pointer = false;
            release();
          }}
        >
          {orderPending && (
            <div className="today-steps-paused" role="status" aria-live="polite">
              <button type="button" onClick={() => setHeld(null)}>
                Order paused · <span>Re-sort now</span>
              </button>
            </div>
          )}
          {layout.groups.length === 0 && empty}
          {layout.groups.map(({ group, steps }, at) => {
            const { title, sub } = groupTitle(group, plan, games, zone, now);
            const foldable = group.kind === 'reset' && steps.length > FOLD_OVER && !unfolded.has(group.key);
            const shown = foldable ? steps.slice(0, FOLD_SHOWN) : steps;
            const hidden = steps.slice(shown.length);
            const start = starts[at]!;
            const rows = shown.map((step, offset) => {
              const game = games.get(step.gameId);
              return game ? (
                <StepRow
                  key={step.key}
                  step={step}
                  group={group}
                  index={start + offset}
                  game={game}
                  now={now}
                  zone={zone}
                  settings={state.settings}
                  compact={compact}
                />
              ) : null;
            });
            const headingId = `today-group-${group.key}`;
            const allDaily = hidden.every((step) => step.kind === 'task' && step.item.cadence === 'daily');
            return (
              <section key={group.key} className="today-steps-group" aria-labelledby={headingId}>
                <div className="today-steps-rule">
                  <h2 id={headingId} data-tone={groupTone(group)}>
                    {title}
                  </h2>
                  {sub && <span>{sub}</span>}
                </div>
                <ol start={start} className="today-steps-list">
                  {rows}
                </ol>
                {foldable && (
                  <button
                    type="button"
                    className="today-steps-more"
                    onClick={() => setUnfolded((current) => new Set(current).add(group.key))}
                  >
                    Show {hidden.length} more {allDaily ? cadenceNoun('daily', hidden.length) : 'steps'}
                  </button>
                )}
              </section>
            );
          })}

          {otherBars.length > 0 && (
            <section className="today-steps-group today-steps-other" aria-labelledby="today-group-other-bars">
              <div className="today-steps-rule">
                <h2 id="today-group-other-bars" data-tone="calm">
                  Other bars
                </h2>
              </div>
              <ul className="today-steps-list">
                {otherBars.map((step) => {
                  const game = games.get(step.gameId)!;
                  return (
                    <StepRow
                      key={step.key}
                      step={step}
                      group={OTHER_GROUP}
                      index={0}
                      game={game}
                      now={now}
                      zone={zone}
                      settings={state.settings}
                      compact={compact}
                    />
                  );
                })}
              </ul>
            </section>
          )}

          {layout.done.length > 0 && (
            <section className="today-steps-done" aria-label="Done today">
              <button
                type="button"
                className="today-steps-done-toggle"
                aria-expanded={doneOpen}
                aria-controls="today-done-list"
                onClick={() => setDoneOpen(!doneOpen)}
              >
                <svg viewBox="0 0 20 20" aria-hidden className="icon h-4 w-4" fill="none" stroke="currentColor">
                  <path d="m7 5 5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span className="text-fg-soft">
                  Done today · <span className="numeral">{layout.done.length}</span>
                </span>
                {!doneOpen && (
                  <span className="truncate text-muted">
                    {' '}
                    ·{' '}
                    {listNames([
                      ...layout.done.slice(0, 2).map((step) => {
                        const game = games.get(step.gameId);
                        return `${game ? gameWithAccount(game, true) : ''} ${stepWhat(step)}`;
                      }),
                      ...(layout.done.length > 2 ? [`${layout.done.length - 2} more`] : []),
                    ])}
                  </span>
                )}
              </button>
              {doneOpen && (
                <ul id="today-done-list" className="today-steps-list">
                  {layout.done.map((step) => {
                    const game = games.get(step.gameId);
                    return game ? (
                      <StepRow
                        key={step.key}
                        step={step}
                        group={DONE_GROUP}
                        index={0}
                        game={game}
                        now={now}
                        zone={zone}
                        settings={state.settings}
                        compact={compact}
                      />
                    ) : null;
                  })}
                </ul>
              )}
            </section>
          )}
        </div>
        <TodaySide state={state} now={now} games={games} week={week} />
      </div>
    </>
  );
}
