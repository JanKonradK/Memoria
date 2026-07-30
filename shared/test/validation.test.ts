import { describe, expect, it } from 'vitest';
import { CURRENT_SCHEMA_VERSION, MAX_GAME_IMAGE_LENGTH } from '../src/types';
import { FUTURE_CLOCK_SKEW_TOLERANCE_MS, safeParseAppState } from '../src/validation';
import { makeEvent, makeGame, makeSnapshot, makeState, makeTask } from './helpers';

describe('safeParseAppState', () => {
  it('accepts a minimal valid document', () => {
    const result = safeParseAppState(makeState({ games: [makeGame()] }));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
      expect(result.data.games).toHaveLength(1);
    }
  });

  it('rejects malformed collections and oversized strings', () => {
    expect(safeParseAppState({ games: 'not-an-array' }).success).toBe(false);
    expect(safeParseAppState({ games: [makeGame({ name: 'x'.repeat(501) })] }).success).toBe(false);
    expect(
      safeParseAppState(makeState({ games: [makeGame({ image: 'x'.repeat(MAX_GAME_IMAGE_LENGTH + 1) })] })).success,
    ).toBe(false);
  });

  it('rejects documents that exceed collection limits', () => {
    const tooManyGames = Array.from({ length: 101 }, (_, index) => makeGame({ id: `g${index}` }));
    expect(safeParseAppState(makeState({ games: tooManyGames })).success).toBe(false);
  });

  it('rejects invalid settings ranges', () => {
    const state = makeState();
    state.settings.sleepHours = 0;
    expect(safeParseAppState(state).success).toBe(false);
  });

  it('bounds observation clocks without rejecting legitimately scheduled times', () => {
    const future = Date.now() + FUTURE_CLOCK_SKEW_TOLERANCE_MS + 60_000;

    // Reset rather than refused: rejecting every locally stamped row would make
    // a fast-clock device unable to sync until its OS clock was repaired.
    const games = safeParseAppState(makeState({ games: [makeGame({ updatedAt: future })] }));
    expect(games.success).toBe(true);
    if (games.success) expect(games.data.games[0]!.updatedAt).toBe(0);

    const beforeSnapshotParse = Date.now();
    const snapshots = safeParseAppState(makeState({ snapshots: [makeSnapshot({ takenAt: future })] }));
    expect(snapshots.success).toBe(true);
    if (snapshots.success) {
      expect(snapshots.data.snapshots[0]!.takenAt).toBeGreaterThanOrEqual(beforeSnapshotParse);
      expect(snapshots.data.snapshots[0]!.takenAt).toBeLessThanOrEqual(Date.now());
    }

    const scheduled = makeState({
      tasks: [makeTask({ timerEndsAt: future })],
      events: [makeEvent({ start: future, end: future + 60_000 })],
      reminders: [{ id: 'reminder', gameId: null, message: 'Later', at: future, updatedAt: Date.now() }],
    });
    expect(safeParseAppState(scheduled).success).toBe(true);
  });

  it('never accepts legacy credential fields in synced settings', () => {
    const state = makeState() as unknown as Record<string, unknown>;
    state.settings = {
      ...(state.settings as object),
      discordWebhook: 'https://discord.com/api/webhooks/secret',
      telegramToken: '123:abc',
      telegramChatId: '123456789',
    };
    const result = safeParseAppState(state);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.settings).not.toHaveProperty('discordWebhook');
      expect(result.data.settings).not.toHaveProperty('telegramToken');
      expect(result.data.settings).not.toHaveProperty('telegramChatId');
    }
  });
});
