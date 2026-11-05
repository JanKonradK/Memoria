import { emptyState, PRESETS } from '@memoria/shared';
import { describe, expect, it } from 'vitest';
import { makeGame } from '../../shared/test/helpers';
import { migrateLegacyIdentity } from '../src/store';

const zzz = PRESETS.find((preset) => preset.key === 'zzz')!;

describe('legacy game identity repair', () => {
  it('stamps the preset key and its title face on a game saved before keys existed', () => {
    const game = makeGame({ id: 'old', name: zzz.name, short: zzz.short, presetKey: undefined, titleFont: undefined });
    const { state, repaired } = migrateLegacyIdentity({ ...emptyState(), games: [game] });
    expect(repaired).toBe(true);
    expect(state.games[0]).toMatchObject({ presetKey: 'zzz', titleFont: zzz.titleFont });
    expect(state.games[0]!.updatedAt).toBeGreaterThan(game.updatedAt);
  });

  it('keeps a face the player chose, and leaves keyed and custom games alone', () => {
    const chosen = makeGame({
      id: 'a',
      name: zzz.name,
      short: zzz.short,
      presetKey: undefined,
      titleFont: "'Italiana', serif",
    });
    const keyed = makeGame({ id: 'b', name: zzz.name, short: zzz.short, presetKey: 'zzz', titleFont: undefined });
    const custom = makeGame({ id: 'c', name: 'My own game', short: 'Mine', presetKey: undefined });
    const { state } = migrateLegacyIdentity({ ...emptyState(), games: [chosen, keyed, custom] });
    expect(state.games[0]).toMatchObject({ presetKey: 'zzz', titleFont: "'Italiana', serif" });
    expect(state.games[1]).toBe(keyed);
    expect(state.games[2]).toBe(custom);
  });
});
