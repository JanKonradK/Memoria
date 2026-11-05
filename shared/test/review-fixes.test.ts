import { describe, expect, it } from 'vitest';
import {
  emptyState,
  GameSavingsSchema,
  LATEST_DEADLINE,
  mergeState,
  normalizeState,
  parseServerDateTime,
  safeParseAppState,
  type AppState,
} from '../src';
import { makeGame } from './helpers';

describe('data a peer or backup can send', () => {
  it('repairs a timezone luxon cannot load instead of breaking every reset', () => {
    const state = normalizeState({
      games: [makeGame({ id: 'g', tz: 'bad/zone' })],
      settings: { ...emptyState().settings, localTz: 'Not/AZone' },
    });
    expect(state.games[0]!.tz).toBe('UTC');
    expect(state.settings.localTz).not.toBe('Not/AZone');
    expect(safeParseAppState(state).success).toBe(true);
  });

  it('treats catch-up keys like "constructor" and "__proto__" as plain data when merging', () => {
    const seen = JSON.parse('{"constructor":["digest@1"],"__proto__":["x@1"],"zzz":["zzz-3.3@1"]}');
    const theirs: AppState = { ...emptyState(), settings: { ...emptyState().settings, catchUpSeen: seen } };
    const merged = mergeState(emptyState(), theirs).settings.catchUpSeen!;
    expect(merged.constructor).toEqual(['digest@1']);
    expect(merged.zzz).toEqual(['zzz-3.3@1']);
    expect(Object.getPrototypeOf(merged)).toBe(Object.prototype);
    expect(Object.keys(merged).sort()).toEqual(['constructor', 'zzz']);
  });

  it('refuses a savings goal past 2100', () => {
    const plan = { currency: 0, tickets: 0, takenAt: 1, goals: [{ id: 'a', label: 'x', targetPulls: 1, deadline: 0 }] };
    plan.goals[0]!.deadline = 8_000_000_000_000_000;
    expect(GameSavingsSchema.safeParse(plan).success).toBe(false);
    plan.goals[0]!.deadline = LATEST_DEADLINE;
    expect(GameSavingsSchema.safeParse(plan).success).toBe(true);
  });
});

describe('feed times', () => {
  it('reads a server time with or without seconds', () => {
    expect(parseServerDateTime('2026-11-10 10:00', 'UTC')).toBe(Date.UTC(2026, 10, 10, 10));
    expect(parseServerDateTime('2026-11-10 10:00:30', 'UTC')).toBe(Date.UTC(2026, 10, 10, 10, 0, 30));
    expect(parseServerDateTime('2026-11-10 10:00:3', 'UTC')).toBeNull();
  });
});
