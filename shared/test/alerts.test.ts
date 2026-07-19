import { describe, expect, it } from 'vitest';
import { evaluateAlerts, inQuietHours } from '../src/alerts';
import { dailyPeriodKey } from '../src/periods';
import { DEFAULT_SETTINGS } from '../src/types';
import { makeEvent, makeGame, makeResource, makeSnapshot, makeState, makeTask, utc } from './helpers';

const MIN = 60_000;
const game = makeGame(); // UTC+1 server, 04:00 reset

describe('energy alerts', () => {
  const res = makeResource({ cap: 200, regenMinutes: 8 });

  it('fires when time-to-cap is inside the threshold (default 120 min)', () => {
    // 185/200 → 15 points → 120 min to full.
    const state = makeState({ games: [game], resources: [res], snapshots: [makeSnapshot({ value: 185, takenAt: 0 })] });
    const alerts = evaluateAlerts(state, 1);
    const energy = alerts.filter((a) => a.type === 'energy_cap');
    expect(energy).toHaveLength(1);
    expect(energy[0]!.dedupeKey).toBe('energy:r1:s1');
  });

  it('stays silent when the cap is far away', () => {
    const state = makeState({ games: [game], resources: [res], snapshots: [makeSnapshot({ value: 50, takenAt: 0 })] });
    expect(evaluateAlerts(state, 1).filter((a) => a.type === 'energy_cap')).toHaveLength(0);
  });

  it('fires a distinct FULL alert once capped', () => {
    const state = makeState({ games: [game], resources: [res], snapshots: [makeSnapshot({ value: 200, takenAt: 0 })] });
    const alerts = evaluateAlerts(state, 1).filter((a) => a.type === 'energy_cap');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.dedupeKey).toBe('energyfull:r1:s1');
    expect(alerts[0]!.title).toContain('FULL');
  });

  it('re-arms after a new snapshot (dedupe key contains snapshot id)', () => {
    const s1 = makeSnapshot({ id: 's1', value: 199, takenAt: 0 });
    const s2 = makeSnapshot({ id: 's2', value: 199, takenAt: 10 });
    const a1 = evaluateAlerts(makeState({ games: [game], resources: [res], snapshots: [s1] }), 20);
    const a2 = evaluateAlerts(makeState({ games: [game], resources: [res], snapshots: [s1, s2] }), 30);
    expect(a1[0]!.dedupeKey).not.toBe(a2[0]!.dedupeKey);
  });

  it('ignores paused games', () => {
    const state = makeState({
      games: [makeGame({ paused: true })],
      resources: [res],
      snapshots: [makeSnapshot({ value: 200, takenAt: 0 })],
    });
    expect(evaluateAlerts(state, 1)).toHaveLength(0);
  });
});

describe('daily undone alerts', () => {
  // Next reset at 03:00 UTC; default threshold 180 min.
  const task = makeTask({ cadence: 'daily' });

  it('fires within the pre-reset window when tasks are undone', () => {
    const now = utc('2026-07-02T01:00:00'); // 2h before reset
    const state = makeState({ games: [game], tasks: [task] });
    const alerts = evaluateAlerts(state, now).filter((a) => a.type === 'daily_undone');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.dedupeKey).toBe(`daily_undone:g1:${dailyPeriodKey(game, now)}`);
  });

  it('does not fire early in the day', () => {
    const now = utc('2026-07-02T10:00:00'); // 17h before reset
    const state = makeState({ games: [game], tasks: [task] });
    expect(evaluateAlerts(state, now).filter((a) => a.type === 'daily_undone')).toHaveLength(0);
  });

  it('does not fire when everything is done', () => {
    const now = utc('2026-07-02T01:00:00');
    const key = dailyPeriodKey(game, now);
    const state = makeState({
      games: [game],
      tasks: [task],
      completions: [{ id: `t1|${key}`, taskId: 't1', periodKey: key, done: true, updatedAt: 1 }],
    });
    expect(evaluateAlerts(state, now).filter((a) => a.type === 'daily_undone')).toHaveLength(0);
  });

  it('does not count a dailyTouch event as a daily task (events are not checklist items)', () => {
    const now = utc('2026-07-02T01:00:00');
    const ev = makeEvent({ dailyTouch: true, start: now - 86_400_000, end: now + 86_400_000, notify: false });
    const state = makeState({ games: [game], events: [ev] });
    expect(evaluateAlerts(state, now).filter((a) => a.type === 'daily_undone')).toHaveLength(0);
  });
});

describe('event ending alerts', () => {
  it('fires inside the 24h window with a stable key', () => {
    const now = 1_000_000;
    const ev = makeEvent({ start: 0, end: now + 3 * 60 * MIN, notify: true });
    const state = makeState({ games: [game], events: [ev] });
    const alerts = evaluateAlerts(state, now).filter((a) => a.type === 'event_end');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.dedupeKey).toBe('event:e1');
  });

  it('respects notify=false and already-ended events', () => {
    const now = 1_000_000;
    const state = makeState({
      games: [game],
      events: [
        makeEvent({ id: 'a', end: now + MIN, notify: false }),
        makeEvent({ id: 'b', end: now - 1, notify: true }),
      ],
    });
    expect(evaluateAlerts(state, now).filter((a) => a.type === 'event_end')).toHaveLength(0);
  });
});

describe('reminders', () => {
  it('fires once due', () => {
    const state = makeState({
      reminders: [{ id: 'm1', gameId: null, message: 'spend before maintenance', at: 100, updatedAt: 1 }],
    });
    const alerts = evaluateAlerts(state, 200);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.dedupeKey).toBe('rem:m1');
    expect(evaluateAlerts(state, 50)).toHaveLength(0);
  });
});

describe('quiet hours', () => {
  const settings = { ...DEFAULT_SETTINGS, quietStart: 60, quietEnd: 480, localTz: 'Etc/UTC' }; // 01:00–08:00 UTC

  it('detects inside/outside the window', () => {
    expect(inQuietHours(settings, utc('2026-07-02T03:00:00'))).toBe(true);
    expect(inQuietHours(settings, utc('2026-07-02T12:00:00'))).toBe(false);
    expect(inQuietHours(settings, utc('2026-07-02T00:59:00'))).toBe(false);
    expect(inQuietHours(settings, utc('2026-07-02T08:00:00'))).toBe(false);
  });

  it('handles windows wrapping past midnight', () => {
    const wrap = { ...settings, quietStart: 22 * 60, quietEnd: 6 * 60 }; // 22:00–06:00
    expect(inQuietHours(wrap, utc('2026-07-02T23:00:00'))).toBe(true);
    expect(inQuietHours(wrap, utc('2026-07-02T05:00:00'))).toBe(true);
    expect(inQuietHours(wrap, utc('2026-07-02T12:00:00'))).toBe(false);
  });

  it('is disabled when unset', () => {
    expect(inQuietHours({ ...settings, quietStart: null, quietEnd: null }, utc('2026-07-02T03:00:00'))).toBe(false);
  });
});
