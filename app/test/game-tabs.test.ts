import { describe, expect, it } from 'vitest';
import { emptyState, PRESETS } from '@memoria/shared';
import { makeEvent, makeGame } from '../../shared/test/helpers';
import history from '../src/data/feed/history.json';
import { gameTabAvailable, VERSION_HISTORY_GAMES } from '../src/components/game-tabs/availability';

const NOW = Date.UTC(2026, 10, 18, 12);
const genshin = PRESETS.find((preset) => preset.key === 'genshin')!;

describe('game tabs', () => {
  it('keeps the version history list in step with the history file', () => {
    const covered = [...new Set(history.versions.map((version) => version.game))].sort();
    expect([...VERSION_HISTORY_GAMES].sort()).toEqual(covered);
  });

  it('always offers Track and Events, and the rest only where there is something to show', () => {
    const state = emptyState();
    const own = makeGame({ id: 'own', name: 'My own game', presetKey: undefined });
    for (const tab of ['track', 'events'] as const) expect(gameTabAvailable(own, tab, { state, now: NOW })).toBe(true);
    for (const tab of ['pulls', 'quests', 'news'] as const)
      expect(gameTabAvailable(own, tab, { state, now: NOW })).toBe(false);

    const preset = makeGame({ id: 'gi', name: genshin.name, presetKey: genshin.key });
    for (const tab of ['pulls', 'quests', 'news'] as const)
      expect(gameTabAvailable(preset, tab, { state, now: NOW })).toBe(true);
  });

  it('offers News for a game with a livestream on its calendar and no version notes', () => {
    const own = makeGame({ id: 'own', name: 'My own game', presetKey: undefined });
    const stream = makeEvent({ gameId: own.id, type: 'livestream', start: NOW + 3_600_000, end: NOW + 7_200_000 });
    expect(gameTabAvailable(own, 'news', { state: { events: [stream] }, now: NOW })).toBe(true);
    expect(gameTabAvailable(own, 'news', { state: { events: [{ ...stream, deleted: true }] }, now: NOW })).toBe(false);
  });
});
