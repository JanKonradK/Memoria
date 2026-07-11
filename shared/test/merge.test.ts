import { describe, expect, it } from 'vitest';
import { mergeState, normalizeState } from '../src/merge';
import { makeGame, makeSnapshot, makeState } from './helpers';

describe('mergeState', () => {
  it('keeps the newer row per id (LWW)', () => {
    const a = makeState({ games: [makeGame({ name: 'Old', updatedAt: 1 })] });
    const b = makeState({ games: [makeGame({ name: 'New', updatedAt: 2 })] });
    expect(mergeState(a, b).games[0]!.name).toBe('New');
    expect(mergeState(b, a).games[0]!.name).toBe('New'); // commutative
  });

  it('propagates newer tombstones over older edits', () => {
    const edited = makeState({ games: [makeGame({ name: 'Edited', updatedAt: 5 })] });
    const deleted = makeState({ games: [makeGame({ deleted: true, updatedAt: 9 })] });
    expect(mergeState(edited, deleted).games[0]!.deleted).toBe(true);
  });

  it('unions snapshots and trims to the most recent 200 per resource', () => {
    const a = makeState({
      snapshots: Array.from({ length: 150 }, (_, i) => makeSnapshot({ id: `a${i}`, takenAt: i })),
    });
    const b = makeState({
      snapshots: Array.from({ length: 150 }, (_, i) => makeSnapshot({ id: `b${i}`, takenAt: 1000 + i })),
    });
    const merged = mergeState(a, b);
    expect(merged.snapshots).toHaveLength(200);
    // All the newer "b" snapshots survive.
    expect(merged.snapshots.filter((s) => s.id.startsWith('b'))).toHaveLength(150);
  });

  it('merges the newer collections (focus, teams, statuses) and normalizes them in', () => {
    const team = { id: 'tm1', gameId: 'g1', name: 'Team 1', members: [{ name: 'Miyabi', needsWork: true }], sort: 0, updatedAt: 5 };
    const a = makeState({ teams: [team] });
    const b = makeState({ teams: [{ ...team, name: 'Renamed', updatedAt: 9 }] });
    expect(mergeState(a, b).teams[0]!.name).toBe('Renamed');
    // legacy saved state without the new collections → empty arrays, not undefined
    const legacy = normalizeState({ games: [] });
    expect(legacy.teams).toEqual([]);
    expect(legacy.focus).toEqual([]);
    expect(legacy.statuses).toEqual([]);
  });

  it('takes the newer settings object wholesale', () => {
    const a = makeState();
    a.settings = { ...a.settings, discordWebhook: 'https://a', updatedAt: 10 };
    const b = makeState();
    b.settings = { ...b.settings, discordWebhook: 'https://b', updatedAt: 3 };
    expect(mergeState(a, b).settings.discordWebhook).toBe('https://a');
  });

  it('is idempotent', () => {
    const a = makeState({ games: [makeGame()] });
    const once = mergeState(a, a);
    expect(once.games).toHaveLength(1);
  });
});

describe('normalizeState', () => {
  it('fills missing collections and settings defaults', () => {
    const s = normalizeState({ games: [makeGame()] });
    expect(s.games).toHaveLength(1);
    expect(s.tasks).toEqual([]);
    expect(s.settings.localTz).toBeTruthy();
  });
  it('tolerates garbage', () => {
    expect(normalizeState(null).games).toEqual([]);
    expect(normalizeState('x').events).toEqual([]);
  });
});
