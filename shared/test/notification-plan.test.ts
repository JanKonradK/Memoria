import { describe, expect, it } from 'vitest';
import {
  actBy,
  alertMinutes,
  buildNotificationPlan,
  completionId,
  formatLead,
  MAX_PLANNED_NOTIFICATIONS,
  nextQuietWindow,
  nextReminderAt,
  normalizeState,
  quietWindowAt,
  reminderTimes,
  taskPeriodKey,
} from '../src';
import type { AlertRule, AppState } from '../src/types';
import { makeEvent, makeGame, makeResource, makeSnapshot, makeState, makeTask, utc } from './helpers';

const HOUR = 3_600_000;
// Tuesday. Testland is on Etc/GMT-1 (UTC+1) with a 04:00 daily reset, which is
// 03:00 UTC: the Europe case the old planner could never warn about.
const now = utc('2026-10-06T12:00:00Z');
const quietOff = { quietStart: null, quietEnd: null, localTz: 'UTC', sleepHours: 8, updatedAt: 0 };
const nextDailyReset = utc('2026-10-07T03:00:00Z');

function dailyState(extra: Partial<AppState> = {}) {
  return makeState({
    games: [makeGame()],
    tasks: [makeTask(), makeTask({ id: 't2', name: 'Commissions', sort: 1 })],
    settings: quietOff,
    ...extra,
  });
}
const ofKind = (state: AppState, kind: string, at = now) =>
  buildNotificationPlan(state, at).filter((item) => item.kind === kind);
function tick(state: AppState, taskId: string, at = now) {
  const game = state.games[0]!;
  const task = state.tasks.find((item) => item.id === taskId)!;
  const periodKey = taskPeriodKey(game, task, at);
  state.completions.push({ id: completionId(taskId, periodKey), taskId, periodKey, done: true, updatedAt: at });
}
function rule(type: AlertRule['type'], over: Partial<AlertRule> = {}): AlertRule {
  return {
    id: `${type}-${over.gameId ?? 'all'}`,
    gameId: null,
    type,
    thresholdMinutes: 0,
    enabled: true,
    updatedAt: 1,
    ...over,
  };
}

describe('dailies', () => {
  it('warns one hour before every daily reset for a week, including a 03:00 Europe reset', () => {
    const daily = ofKind(dailyState(), 'daily');
    expect(daily).toHaveLength(7);
    expect(daily[0]).toMatchObject({ at: nextDailyReset - HOUR, gameId: 'g1' });
    expect(daily[0]?.title).toBe('Testland: dailies reset in 1 h');
    expect(daily[0]?.body).toBe('2 to do.');
    expect(daily[6]?.at).toBe(nextDailyReset + 6 * 24 * HOUR - HOUR);
  });

  it('counts what is left today, and says nothing for today once every daily is ticked', () => {
    const state = dailyState();
    tick(state, 't1');
    expect(ofKind(state, 'daily')[0]?.body).toBe('1 of 2 still to do.');
    tick(state, 't2');
    const daily = ofKind(state, 'daily');
    expect(daily).toHaveLength(6);
    expect(daily[0]?.at).toBe(nextDailyReset + 23 * HOUR);
  });

  it('uses the lead from a game rule over a global rule, and lets a rule switch reminders off', () => {
    const state = dailyState({ alertRules: [rule('daily_undone', { thresholdMinutes: 120 })] });
    expect(alertMinutes(state, 'g1', 'daily_undone')).toBe(120);
    state.alertRules.push(rule('daily_undone', { gameId: 'g1', thresholdMinutes: 30 }));
    expect(ofKind(state, 'daily')[0]?.at).toBe(nextDailyReset - 30 * 60_000);
    expect(ofKind(state, 'daily')[0]?.title).toContain('30 min');
    state.alertRules[1]!.enabled = false;
    expect(ofKind(state, 'daily')).toEqual([]);
  });
});

describe('quiet hours', () => {
  it('moves a reminder to the minute before quiet hours begin instead of dropping it', () => {
    const state = dailyState({ settings: { ...quietOff, quietStart: 60, quietEnd: 7 * 60, quietHoursChosen: true } });
    // 02:00 UTC falls inside 01:00–07:00 and moves to 00:59.
    expect(ofKind(state, 'daily')[0]?.at).toBe(utc('2026-10-07T00:59:00Z'));
  });

  it('works in the home timezone and across midnight', () => {
    // 02:00 UTC is 11:00 in Tokyo; quiet 10:00–12:00 Tokyo moves it to 09:59 Tokyo, 00:59 UTC.
    const state = dailyState({
      settings: { ...quietOff, quietStart: 10 * 60, quietEnd: 12 * 60, localTz: 'Asia/Tokyo', quietHoursChosen: true },
    });
    expect(ofKind(state, 'daily')[0]?.at).toBe(utc('2026-10-07T00:59:00Z'));
  });

  it('keeps the original time when the minute before quiet hours has already passed', () => {
    const state = dailyState({ settings: { ...quietOff, quietStart: 60, quietEnd: 7 * 60, quietHoursChosen: true } });
    const late = utc('2026-10-07T01:30:00Z');
    expect(ofKind(state, 'daily', late)[0]?.at).toBe(nextDailyReset - HOUR);
  });

  it('are off by default, and the hidden pre-4.1 default reads as off unless it was chosen', () => {
    expect(makeState().settings).toMatchObject({ quietStart: null, quietEnd: null });
    const legacy = normalizeState({ ...makeState(), settings: { ...quietOff, quietStart: 60, quietEnd: 480 } });
    expect(legacy.settings).toMatchObject({ quietStart: null, quietEnd: null });
    const chosen = normalizeState({
      ...makeState(),
      settings: { ...quietOff, quietStart: 60, quietEnd: 480, quietHoursChosen: true },
    });
    expect(chosen.settings).toMatchObject({ quietStart: 60, quietEnd: 480, quietHoursChosen: true });
    const other = normalizeState({ ...makeState(), settings: { ...quietOff, quietStart: 23 * 60, quietEnd: 6 * 60 } });
    expect(other.settings).toMatchObject({ quietStart: 23 * 60, quietEnd: 6 * 60 });
  });
});

describe('weeklies', () => {
  // Weekly reset: Monday 04:00 UTC+1 = Monday 03:00 UTC.
  const monday = utc('2026-10-12T03:00:00Z');
  function weeklyState(games: number) {
    const list = Array.from({ length: games }, (_, index) =>
      makeGame({ id: `g${index}`, short: `G${index}`, name: `Game ${index}`, sort: index }),
    );
    return makeState({
      games: list,
      tasks: list.map((game) => makeTask({ id: `w-${game.id}`, gameId: game.id, cadence: 'weekly', name: 'Boss' })),
      settings: quietOff,
    });
  }

  it('gives one hour of lead per game owing weeklies, in one notification', () => {
    const three = ofKind(weeklyState(3), 'weekly');
    expect(three).toHaveLength(1);
    expect(three[0]?.at).toBe(monday - 3 * HOUR);
    expect(three[0]?.title).toBe('Weeklies: 3 games, first reset in 3 h');
    expect(three[0]?.body).toBe('G0, G1, G2. 3 weeklies still to do.');
    expect(ofKind(weeklyState(5), 'weekly')[0]?.at).toBe(monday - 5 * HOUR);
  });

  it('never warns more than ten hours ahead', () => {
    expect(ofKind(weeklyState(12), 'weekly')[0]?.at).toBe(monday - 10 * HOUR);
  });

  it('shrinks the lead as games are finished, and stays a separate notification from dailies', () => {
    const state = weeklyState(3);
    state.tasks.push(makeTask({ id: 'd', gameId: 'g0' }));
    const game = state.games[1]!;
    const task = state.tasks[1]!;
    const periodKey = taskPeriodKey(game, task, now);
    state.completions.push({
      id: completionId(task.id, periodKey),
      taskId: task.id,
      periodKey,
      done: true,
      updatedAt: now,
    });
    const plan = buildNotificationPlan(state, now);
    const weekly = plan.filter((item) => item.kind === 'weekly');
    expect(weekly[0]?.at).toBe(monday - 2 * HOUR);
    expect(weekly[0]?.body).toBe('G0, G2. 2 weeklies still to do.');
    // Monday's dailies reminder still fires on its own an hour before the same reset.
    expect(plan.some((item) => item.kind === 'daily' && item.at === monday - HOUR)).toBe(true);
    // The id is keyed to the reset, so a device that already showed it does not show it again.
    expect(weekly[0]?.id).toBe(ofKind(weeklyState(3), 'weekly')[0]?.id);
  });
});

describe('events', () => {
  it("warns three hours before an unfinished event ends, grouping a game's events that end together", () => {
    const state = makeState({
      games: [makeGame()],
      settings: quietOff,
      events: [
        makeEvent({ id: 'a', name: 'Severian', type: 'event', start: now - HOUR, end: now + 10 * HOUR }),
        makeEvent({ id: 'b', name: 'Abyss', type: 'cycle', start: now - HOUR, end: now + 10.5 * HOUR }),
        makeEvent({ id: 'c', name: 'Later', type: 'event', start: now - HOUR, end: now + 30 * HOUR }),
      ],
    });
    const events = ofKind(state, 'event');
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ at: now + 7 * HOUR, body: 'Severian, Abyss' });
    expect(events[0]?.title).toBe('Testland: 2 events end in 3 h');
    expect(events[1]?.title).toBe('Testland: event ends in 3 h');
  });

  it('skips done, unofficial, maintenance and unpinned banner rows', () => {
    const end = now + 10 * HOUR;
    const base = { start: now - HOUR, end };
    const state = makeState({
      games: [makeGame()],
      settings: quietOff,
      events: [
        makeEvent({ ...base, id: 'done', type: 'event', done: true }),
        makeEvent({ ...base, id: 'guess', type: 'event', notify: false }),
        makeEvent({ ...base, id: 'maint', type: 'maintenance' }),
        makeEvent({ ...base, id: 'banner', type: 'banner' }),
      ],
    });
    expect(ofKind(state, 'event')).toEqual([]);
    state.events[3]!.pinned = true;
    expect(ofKind(state, 'event')).toHaveLength(1);
  });
});

describe('caps and custom reminders', () => {
  function energyState() {
    return makeState({
      games: [makeGame()],
      resources: [makeResource({ cap: 100, regenMinutes: 6 })],
      snapshots: [makeSnapshot({ value: 60, takenAt: now })],
      settings: quietOff,
    });
  }

  it('warns two hours before a freshly read bar caps', () => {
    const plan = ofKind(energyState(), 'energy');
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({ at: now + 2 * HOUR, gameId: 'g1', title: 'Testland: Resin caps in 2 h' });
  });

  it('does not alert from stale readings, synthetic estimates, future readings or full meters', () => {
    const state = energyState();
    state.snapshots[0] = makeSnapshot({ value: 60, takenAt: now - 25 * HOUR });
    expect(ofKind(state, 'energy')).toEqual([]);
    state.snapshots[0] = makeSnapshot({
      value: 60,
      takenAt: now,
      provenance: { kind: 'estimate', observedAt: now, importedAt: now },
    });
    expect(ofKind(state, 'energy')).toEqual([]);
    state.snapshots[0] = makeSnapshot({ value: 60, takenAt: now + 1 });
    expect(ofKind(state, 'energy')).toEqual([]);
    state.snapshots[0] = makeSnapshot({ value: 100, takenAt: now });
    expect(ofKind(state, 'energy')).toEqual([]);
  });

  it('skips paused and deleted games and their reminders, but keeps global reminders', () => {
    const state = dailyState({
      reminders: [
        { id: 'local', gameId: 'g1', message: 'Local', at: now + 60_000, updatedAt: now },
        { id: 'global', gameId: null, message: 'Global', at: now + 60_000, updatedAt: now },
      ],
    });
    state.games[0]!.paused = true;
    expect(buildNotificationPlan(state, now).map((item) => item.body)).toEqual(['Global']);
    state.games[0]!.paused = false;
    state.games[0]!.deleted = true;
    expect(buildNotificationPlan(state, now).map((item) => item.body)).toEqual(['Global']);
  });

  it('keeps IDs stable and limits the plan to seven days and a fixed number of entries', () => {
    const state = makeState({
      settings: quietOff,
      reminders: Array.from({ length: 150 }, (_, index) => ({
        id: `r${index}`,
        gameId: null,
        message: `Reminder ${index}`,
        at: now + (index + 1) * 60_000,
        updatedAt: now,
      })),
    });
    const plan = buildNotificationPlan(state, now);
    expect(plan).toHaveLength(MAX_PLANNED_NOTIFICATIONS);
    expect(new Set(plan.map((item) => item.id)).size).toBe(MAX_PLANNED_NOTIFICATIONS);
    expect(buildNotificationPlan(state, now + 100).map((item) => item.id)).toEqual(plan.map((item) => item.id));
    state.reminders = [{ id: 'late', gameId: null, message: 'Later', at: now + 7 * 24 * HOUR + 1, updatedAt: now }];
    expect(buildNotificationPlan(state, now)).toEqual([]);
  });
});

describe('formatLead', () => {
  it('reads naturally', () => {
    expect([formatLead(60), formatLead(180), formatLead(45), formatLead(150)]).toEqual([
      '1 h',
      '3 h',
      '45 min',
      '2 h 30 min',
    ]);
  });
});

describe('evening digest', () => {
  it('is off by default', () => {
    expect(ofKind(dailyState(), 'digest')).toEqual([]);
  });

  it('lists the dailies still open once a day at the chosen time, and skips a day with nothing open', () => {
    const state = dailyState({ settings: { ...quietOff, digestAt: 20 * 60 } });
    const digest = ofKind(state, 'digest');
    expect(digest[0]).toMatchObject({
      at: utc('2026-10-06T20:00:00Z'),
      title: 'Still open: Testland',
      body: `${state.games[0]!.short} 2 dailies left.`,
    });
    expect(digest).toHaveLength(7);
    tick(state, 't1');
    tick(state, 't2');
    expect(ofKind(state, 'digest')[0]?.at).toBe(utc('2026-10-07T20:00:00Z'));
  });
});

describe('quiet hours helpers', () => {
  const quiet = { quietStart: 23 * 60, quietEnd: 7 * 60, localTz: 'UTC' };
  it('find the window around a time and the next one to begin', () => {
    expect(quietWindowAt(quiet, utc('2026-10-07T03:00:00Z'))).toEqual({
      start: utc('2026-10-06T23:00:00Z'),
      end: utc('2026-10-07T07:00:00Z'),
    });
    expect(quietWindowAt(quiet, utc('2026-10-07T12:00:00Z'))).toBeNull();
    expect(nextQuietWindow(quiet, now)?.start).toBe(utc('2026-10-06T23:00:00Z'));
    expect(nextQuietWindow({ ...quiet, quietStart: null }, now)).toBeNull();
  });

  it('bring a deadline inside quiet hours forward to when they begin, unless they already have', () => {
    const reset = utc('2026-10-07T03:00:00Z');
    expect(actBy(quiet, reset, now)).toBe(utc('2026-10-06T23:00:00Z'));
    expect(actBy(quiet, reset, utc('2026-10-07T01:00:00Z'))).toBe(reset);
    expect(actBy(quiet, utc('2026-10-07T12:00:00Z'), now)).toBe(utc('2026-10-07T12:00:00Z'));
    expect(actBy({ ...quiet, quietEnd: null }, reset, now)).toBe(reset);
  });
});

describe('repeating reminders', () => {
  const base = { id: 'r1', gameId: null, message: 'Claim the monthly pass', updatedAt: 1 };
  it('fire once by default, and on every repeat inside the week when repeating', () => {
    const once = { ...base, at: now + HOUR };
    expect(reminderTimes(once, now, now + 7 * 24 * HOUR, 'UTC')).toEqual([now + HOUR]);
    const daily = { ...base, at: now - 10 * 24 * HOUR + HOUR, repeatDays: 1 };
    const times = reminderTimes(daily, now, now + 7 * 24 * HOUR, 'UTC');
    expect(times[0]).toBe(now + HOUR);
    expect(times).toHaveLength(7);
    const state = dailyState({ reminders: [daily] });
    const planned = ofKind(state, 'reminder');
    expect(planned).toHaveLength(7);
    expect(new Set(planned.map((item) => item.id)).size).toBe(7);
  });

  it('keep their home-time clock across a daylight-saving change', () => {
    // 09:00 London on the Saturday before the clocks go back.
    const weekly = { ...base, at: utc('2026-10-24T08:00:00Z'), repeatDays: 7 };
    expect(nextReminderAt(weekly, utc('2026-10-25T00:00:00Z'), 'Europe/London')).toBe(utc('2026-10-31T09:00:00Z'));
    expect(nextReminderAt({ ...base, at: now - HOUR }, now, 'UTC')).toBeNull();
  });
});
