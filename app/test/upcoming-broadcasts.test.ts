import { emptyState, PRESETS, type Game, type GameEvent } from '@memoria/shared';
import { describe, expect, it } from 'vitest';
import { upcomingBroadcasts } from '../src/data/upcoming-broadcasts';

const now = Date.parse('2026-10-03T12:00:00Z');
const preset = PRESETS.find((game) => game.key === 'zzz')!;
const game: Game = { ...preset, id: 'zzz-1', presetKey: 'zzz', paused: false, sort: 0, updatedAt: 1 };
const event: GameEvent = {
  id: 'edited-stream',
  gameId: game.id,
  type: 'livestream',
  name: 'My broadcast reminder',
  start: now + 60_000,
  end: now + 120_000,
  dailyTouch: false,
  notify: true,
  notes: '',
  updatedAt: 1,
  sourceKey: 'seed:zzz:3.3-livestream',
};

describe('upcoming broadcasts', () => {
  it('shows bundled forecasts for games not tracked, with one global clock', () => {
    const row = upcomingBroadcasts(emptyState(), now).find((item) => item.game === 'zzz')!;
    expect(row.predicted).toBe(true);
    expect(row.start).toBe(Date.parse('2026-10-07T11:30:00Z'));
    expect(row.eventId).toBeUndefined();
  });
  it('uses owner edits for tracked games and keeps accounts separate', () => {
    const second = { ...game, id: 'zzz-2', accountLabel: 'Asia', tz: 'UTC+8' };
    const rows = upcomingBroadcasts(
      { ...emptyState(), games: [game, second], events: [event, { ...event, id: 'second-stream', gameId: second.id }] },
      now,
    );
    expect(rows.filter((row) => row.game === 'zzz')).toHaveLength(2);
    expect(rows.find((row) => row.id === event.id)).toMatchObject({
      name: event.name,
      start: event.start,
      eventId: event.id,
      gameId: game.id,
      predicted: false,
    });
    expect(rows.find((row) => row.id === 'second-stream')).toMatchObject({ gameId: second.id });
    expect(rows.find((row) => row.id === 'second-stream')?.gameName).toContain('Asia');
  });
  it.each([{ deleted: true }, { done: true }, { end: now }])(
    'does not restore hidden broadcasts from the bundle: %j',
    (overrides) => {
      const rows = upcomingBroadcasts({ ...emptyState(), games: [game], events: [{ ...event, ...overrides }] }, now);
      expect(rows.filter((row) => row.game === 'zzz')).toEqual([]);
    },
  );
});
