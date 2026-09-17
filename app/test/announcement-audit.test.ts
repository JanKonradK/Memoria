import { emptyState } from '@memoria/shared';
import { describe, expect, it } from 'vitest';
import { makeGame, makeEvent } from '../../shared/test/helpers';
import { eventFingerprint, planSeedImport, SEED_UPDATED } from '../src/data/seed-events';

describe('September announcement corrections', () => {
  it.each(['UTC+1', 'UTC+8', 'UTC-5'])('keeps HSR local opening and global closing distinct for %s', (tz) => {
    const game = makeGame({ presetKey: 'hsr', tz });
    const plan = planSeedImport({ ...emptyState(), games: [game] }, Date.parse('2026-09-17T00:00:00Z'));
    const event = plan.find((entry) => entry.seed?.sourceKey === 'hsr:1392')!;
    const offset = { 'UTC+1': 1, 'UTC+8': 8, 'UTC-5': -5 }[tz]!;
    expect(event.start).toBe(Date.parse('2026-09-19T04:00:00Z') - offset * 3_600_000);
    expect(event.end).toBe(Date.parse('2026-09-27T19:59:00Z'));
  });

  it('withdraws the unsupported Endfield weapon deadline on the same day, preserving owner edits', () => {
    const game = makeGame({ presetKey: 'endfield' });
    const event = makeEvent({
      gameId: game.id,
      sourceKey: 'seed:endfield:1.5-deep-cold-issue',
      start: Date.parse('2026-09-02T04:00:00Z'),
      end: Date.parse('2026-09-29T22:59:00Z'),
    });
    event.seedHash = eventFingerprint(event);
    const state = {
      ...emptyState(),
      games: [game],
      events: [event],
      settings: { ...emptyState().settings, seedImportedVersion: SEED_UPDATED },
    };
    expect(planSeedImport(state).some((entry) => entry.kind === 'remove' && entry.eventId === event.id)).toBe(true);
    expect(
      planSeedImport({ ...state, events: [{ ...event, notes: 'Keep for my records' }] }).some(
        (entry) => entry.kind === 'remove',
      ),
    ).toBe(false);
  });
});
