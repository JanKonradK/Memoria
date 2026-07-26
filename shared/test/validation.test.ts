import { describe, expect, it } from 'vitest';
import { CURRENT_SCHEMA_VERSION, MAX_GAME_IMAGE_LENGTH } from '../src/types';
import { safeParseAppState } from '../src/validation';
import { makeGame, makeState } from './helpers';

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

  it('never accepts legacy credential fields in synced settings', () => {
    const state = makeState() as unknown as Record<string, unknown>;
    state.settings = {
      ...(state.settings as object),
      discordWebhook: 'https://discord.com/api/webhooks/secret',
      telegramToken: '123:abc',
    };
    const result = safeParseAppState(state);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.settings).not.toHaveProperty('discordWebhook');
      expect(result.data.settings).not.toHaveProperty('telegramToken');
    }
  });
});
