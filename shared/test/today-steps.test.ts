import { describe, expect, it } from 'vitest';
import { completionId } from '../src/checklist';
import { taskPeriodKey } from '../src/periods';
import { todaySteps } from '../src/today-steps';
import type { AppState } from '../src/types';
import { makeEvent, makeGame, makeResource, makeSnapshot, makeState, makeTask, utc } from './helpers';

const NOW = utc('2026-11-18T14:00:00Z');
const MIN = 60_000;

const genshin = makeGame({ id: 'genshin', name: 'Genshin Impact', tz: 'UTC', dailyResetHour: 3, sort: 0 });
const crumble = makeGame({ id: 'crumble', name: 'CookieRun: Crumble', tz: 'UTC', dailyResetHour: 15, sort: 1 });
const nikke = makeGame({ id: 'nikke', name: 'NIKKE', tz: 'UTC', dailyResetHour: 3, sort: 2 });

/** A regen bar that reads `value` now and fills one point every 8 minutes. */
function bar(id: string, gameId: string, value: number, cap = 200) {
  return {
    resource: makeResource({ id, gameId, name: `${id} energy`, cap, regenMinutes: 8 }),
    snapshot: makeSnapshot({ id: `snap-${id}`, resourceId: id, value, takenAt: NOW }),
  };
}

function state(over: Partial<AppState> = {}, quiet = true): AppState {
  const base = makeState({ games: [genshin, crumble, nikke], ...over });
  base.settings = {
    ...base.settings,
    localTz: 'UTC',
    quietStart: quiet ? 23 * 60 : null,
    quietEnd: quiet ? 7 * 60 : null,
    quietHoursChosen: quiet,
  };
  return base;
}

describe('todaySteps', () => {
  it('orders steps by deadline into the hour, the evening before quiet hours, and each reset', () => {
    const resin = bar('resin', 'genshin', 200 - 51); // full at 20:48
    const night = bar('night', 'crumble', 200 - 82); // full at 00:56, inside quiet hours
    const plan = todaySteps(
      state({
        resources: [resin.resource, night.resource],
        snapshots: [resin.snapshot, night.snapshot],
        tasks: [
          makeTask({ id: 'commissions', gameId: 'genshin', name: 'Daily Commissions' }),
          makeTask({ id: 'blessing', gameId: 'crumble', name: 'Sweet Blessing' }),
        ],
      }),
      NOW,
    );
    expect(plan.groups.map((group) => group.kind)).toEqual(['hour', 'evening', 'reset']);
    expect(plan.groups[0]!.steps.map((step) => step.key)).toEqual(['task:blessing']);
    // A cap inside quiet hours is due when they begin, so it sorts as 23:00.
    expect(plan.groups[1]!.steps.map((step) => [step.key, step.actBy])).toEqual([
      ['energy:resin', NOW + 408 * MIN],
      ['energy:night', utc('2026-11-18T23:00:00Z')],
    ]);
    expect(plan.groups[1]!.at).toBe(utc('2026-11-18T23:00:00Z'));
    expect(plan.groups[2]).toMatchObject({ at: utc('2026-11-19T03:00:00Z'), gameIds: ['genshin'] });
    expect(plan.quiet).toEqual({ start: utc('2026-11-18T23:00:00Z'), end: utc('2026-11-19T07:00:00Z') });
    expect(plan).toMatchObject({ open: 4, total: 4 });
  });

  it('puts energy into a later group when no quiet hours are set', () => {
    const resin = bar('resin', 'genshin', 149);
    const plan = todaySteps(state({ resources: [resin.resource], snapshots: [resin.snapshot] }, false), NOW);
    expect(plan.quiet).toBeNull();
    expect(plan.groups.map((group) => group.kind)).toEqual(['later']);
  });

  it('places a group where its first step falls due', () => {
    // The evening opens with an event at 19:59, just before NIKKE's 20:00 reset.
    const plan = todaySteps(
      state({
        games: [makeGame({ ...nikke, dailyResetHour: 20 })],
        tasks: [makeTask({ id: 'missions', gameId: 'nikke' })],
        events: [
          makeEvent({ id: 'volt', gameId: 'nikke', type: 'event', start: NOW - MIN, end: utc('2026-11-18T19:59:00Z') }),
        ],
      }),
      NOW,
    );
    expect(plan.groups.map((group) => [group.kind, group.at])).toEqual([
      ['evening', utc('2026-11-18T23:00:00Z')],
      ['reset', utc('2026-11-18T20:00:00Z')],
    ]);
  });

  it('puts a full bar first, due now', () => {
    const full = bar('resin', 'genshin', 200);
    const plan = todaySteps(state({ resources: [full.resource], snapshots: [full.snapshot] }), NOW);
    expect(plan.groups[0]).toMatchObject({ kind: 'hour' });
    expect(plan.groups[0]!.steps[0]).toMatchObject({ kind: 'energy', full: true, at: NOW, actBy: NOW });
  });

  it('collapses finished steps and counts them toward the total', () => {
    const task = makeTask({ id: 'commissions', gameId: 'genshin' });
    const periodKey = taskPeriodKey(genshin, task, NOW);
    const plan = todaySteps(
      state({
        tasks: [task, makeTask({ id: 'other', gameId: 'genshin', name: 'Other' })],
        completions: [{ id: completionId(task.id, periodKey), taskId: task.id, periodKey, done: true, updatedAt: 1 }],
      }),
      NOW,
    );
    expect(plan.done.map((step) => step.key)).toEqual(['task:commissions']);
    expect(plan).toMatchObject({ open: 1, total: 2 });
  });

  it('makes many events of one game ending together one step, led by the pinned one', () => {
    const ends = utc('2026-11-18T19:59:00Z');
    const events = Array.from({ length: 9 }, (_, index) =>
      makeEvent({
        id: `nikke-${index}`,
        gameId: 'nikke',
        name: index === 4 ? 'VOLT TRIP' : `Event ${index}`,
        type: 'event',
        start: NOW - 86_400_000,
        end: ends + index * MIN,
        pinned: index === 4,
      }),
    );
    events.push(
      makeEvent({ id: 'banner', gameId: 'nikke', type: 'banner', start: NOW - MIN, end: ends }),
      makeEvent({
        id: 'next-week',
        gameId: 'nikke',
        name: 'Long run',
        type: 'event',
        start: NOW - MIN,
        end: NOW + 3 * 86_400_000,
      }),
      makeEvent({ id: 'finished', gameId: 'nikke', type: 'event', start: NOW - MIN, end: ends, done: true }),
    );
    const plan = todaySteps(state({ events }), NOW);
    const steps = plan.groups.flatMap((group) => group.steps);
    // The first to end leads; the banner and the finished one are not part of it.
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ kind: 'event', more: 8, key: 'event:nikke-0' });
    expect(plan.done.map((step) => step.key)).toEqual(['event:finished']);
    expect(plan.week).toEqual([expect.objectContaining({ kind: 'event', name: 'Long run' })]);
  });

  it('leads a merged event step with the pinned one when they end at the same moment', () => {
    const end = NOW + 5 * 3_600_000;
    const events = ['Alpha', 'VOLT TRIP', 'Zeta'].map((name, index) =>
      makeEvent({ id: `e${index}`, gameId: 'nikke', name, type: 'event', start: NOW - MIN, end, pinned: index === 1 }),
    );
    const step = todaySteps(state({ events }), NOW).groups[0]!.steps[0]!;
    expect(step).toMatchObject({ key: 'event:e1', more: 2 });
  });

  it('keeps weeklies due within the day as steps and lists the rest of the week', () => {
    // Monday 03:00 is the next weekly reset: four days away.
    const plan = todaySteps(
      state({
        games: [genshin, makeGame({ ...crumble, dailyResetHour: 3, weeklyResetDay: 4 })],
        tasks: [
          makeTask({ id: 'boss', gameId: 'genshin', name: 'Weekly bosses', cadence: 'weekly' }),
          makeTask({ id: 'domain', gameId: 'genshin', name: 'Domain', cadence: 'weekly' }),
          makeTask({ id: 'guild', gameId: 'crumble', name: 'Guild', cadence: 'weekly' }),
        ],
      }),
      NOW,
    );
    expect(plan.groups.flatMap((group) => group.steps).map((step) => step.key)).toEqual(['task:guild']);
    expect(plan.week).toEqual([expect.objectContaining({ kind: 'weekly', gameId: 'genshin', left: 2 })]);
  });

  it('lists a cap more than a day away for the week', () => {
    const slow = bar('slow', 'genshin', 0, 400); // 53h to fill
    const plan = todaySteps(state({ resources: [slow.resource], snapshots: [slow.snapshot] }), NOW);
    expect(plan.groups).toEqual([]);
    expect(plan.week).toEqual([expect.objectContaining({ kind: 'cap', name: 'slow energy' })]);
  });

  it('leaves out paused games and tasks hidden from the card', () => {
    const plan = todaySteps(
      state({
        games: [
          { ...genshin, cardLayout: [{ id: 'task:hidden', hidden: true }] },
          { ...crumble, paused: true },
        ],
        tasks: [
          makeTask({ id: 'hidden', gameId: 'genshin' }),
          makeTask({ id: 'shown', gameId: 'genshin' }),
          makeTask({ id: 'paused', gameId: 'crumble' }),
        ],
      }),
      NOW,
    );
    expect(plan.groups.flatMap((group) => group.steps).map((step) => step.key)).toEqual(['task:shown']);
  });

  it('marks the strip once per game and moment, sharing a marker between near deadlines', () => {
    const zzz = bar('battery', 'crumble', 200 - 82); // 00:56
    const wuwa = bar('plates', 'nikke', 200 - 79); // 00:32
    const plan = todaySteps(
      state({
        resources: [zzz.resource, wuwa.resource],
        snapshots: [zzz.snapshot, wuwa.snapshot],
        tasks: [makeTask({ id: 'a', gameId: 'genshin' }), makeTask({ id: 'b', gameId: 'genshin', name: 'B' })],
      }),
      NOW,
    );
    expect(plan.marks).toEqual([
      { at: NOW + 632 * MIN, gameIds: ['nikke', 'crumble'], kinds: ['cap'] },
      { at: utc('2026-11-19T03:00:00Z'), gameIds: ['genshin'], kinds: ['reset'] },
    ]);
  });

  it('lists every other bar of an active game, never counted as a step', () => {
    const resin = bar('resin', 'genshin', 149); // caps within the day: a step
    const slow = bar('slow', 'crumble', 10); // caps after a day
    const unread = makeResource({ id: 'unread', gameId: 'nikke', name: 'unread energy', cap: 200, regenMinutes: 8 });
    const paused = makeGame({ id: 'paused', name: 'Paused', tz: 'UTC', paused: true, sort: 3 });
    const pausedBar = makeResource({ id: 'pausedbar', gameId: 'paused', cap: 100, regenMinutes: 8 });
    const plan = todaySteps(
      state({
        games: [genshin, crumble, nikke, paused],
        resources: [resin.resource, slow.resource, unread, pausedBar],
        snapshots: [resin.snapshot, slow.snapshot],
      }),
      NOW,
    );
    expect(plan.otherBars.map((step) => [step.key, step.unmeasured === true, step.value])).toEqual([
      ['energy:slow', false, 10],
      ['energy:unread', true, 0],
    ]);
    expect(plan.otherBars[0]!.at).toBe(NOW + 190 * 8 * MIN);
    expect(plan.otherBars[1]!.at).toBeGreaterThan(NOW + 24 * 60 * MIN);
    expect(plan).toMatchObject({ open: 1, total: 1 });
    expect(plan.marks).toHaveLength(1);
  });

  it('leaves a bar hidden on the card out of the other bars', () => {
    const slow = bar('slow', 'crumble', 10);
    const plan = todaySteps(
      state({
        games: [{ ...crumble, cardLayout: [{ id: 'resource:slow', hidden: true }] } as typeof crumble],
        resources: [slow.resource],
        snapshots: [slow.snapshot],
      }),
      NOW,
    );
    expect(plan.otherBars).toEqual([]);
  });
});
