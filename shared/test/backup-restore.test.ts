import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CURRENT_SCHEMA_VERSION, normalizeState, safeParseAppState, mergeState } from '../src';
import { makeEvent, makeGame, makeResource, makeSnapshot, makeState, makeTask } from './helpers';

describe('backup restore boundary', () => {
  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-09T12:00:00Z'));
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  it.each([1, 3, 6, 8, CURRENT_SCHEMA_VERSION])(
    'restores schema %s through validation, migration and merge',
    (schemaVersion) => {
      const backup = makeState({
        schemaVersion,
        games: [makeGame()],
        resources: [makeResource()],
        snapshots: [makeSnapshot({ takenAt: 100 })],
        tasks: [makeTask()],
        events: [makeEvent({ name: 'My edited event', notes: 'Keep this', end: 1000 })],
      });
      const raw: unknown = JSON.parse(JSON.stringify(backup));
      expect(safeParseAppState(raw).success).toBe(true);
      const restored = mergeState(makeState(), normalizeState(raw));
      expect(restored.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
      expect(restored.games[0]!.id).toBe('g1');
      expect(restored.tasks[0]!.gameId).toBe('g1');
      expect(restored.resources[0]!.gameId).toBe('g1');
      expect(restored.snapshots[0]!.resourceId).toBe('r1');
      expect(restored.events[0]).toMatchObject({ name: 'My edited event', notes: 'Keep this' });
      expect(mergeState(restored, normalizeState(raw))).toEqual(restored);
    },
  );
  it('refuses future and malformed backups without changing the current document', () => {
    const current = makeState({ games: [makeGame()] });
    const before = JSON.stringify(current);
    expect(safeParseAppState({ ...current, schemaVersion: CURRENT_SCHEMA_VERSION + 1 }).success).toBe(false);
    expect(safeParseAppState({ ...current, events: [{ name: 'broken' }] }).success).toBe(false);
    expect(JSON.stringify(current)).toBe(before);
  });
});
