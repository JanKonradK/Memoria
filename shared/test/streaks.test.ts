import { describe, expect, it } from 'vitest';
import { completionId } from '../src/checklist';
import { dailyStreaks } from '../src/streaks';
import type { Completion } from '../src/types';
import { makeGame, makeState, makeTask, utc } from './helpers';

// 13:00 on 26 November at the game's server (UTC+1, reset 04:00).
const NOW = utc('2026-11-26T12:00:00Z');
const game = makeGame({ id: 'g1', tz: 'Etc/GMT-1', dailyResetHour: 4 });
const commissions = makeTask({ id: 'commissions', gameId: 'g1', name: 'Commissions' });
const resin = makeTask({ id: 'resin', gameId: 'g1', name: 'Spend resin' });

function done(taskId: string, day: string, over: Partial<Completion> = {}): Completion {
  const periodKey = `D${day}`;
  return { id: completionId(taskId, periodKey), taskId, periodKey, done: true, updatedAt: 1, ...over };
}

/** Both dailies done on each day. */
function both(...days: string[]): Completion[] {
  return days.flatMap((day) => [done('commissions', day), done('resin', day)]);
}

describe('dailyStreaks', () => {
  it('counts days in a row with every daily done, and today once it is done', () => {
    const open = dailyStreaks(
      makeState({
        games: [game],
        tasks: [commissions, resin],
        completions: both('2026-11-23', '2026-11-24', '2026-11-25'),
      }),
      NOW,
    );
    // Today is still open: the run through yesterday stands.
    expect(open.games).toEqual([{ gameId: 'g1', current: 3, best: 3, today: false }]);
    expect(open).toMatchObject({ current: 3, best: 3 });

    const finished = dailyStreaks(
      makeState({
        games: [game],
        tasks: [commissions, resin],
        completions: both('2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26'),
      }),
      NOW,
    );
    expect(finished.games[0]).toEqual({ gameId: 'g1', current: 4, best: 4, today: true });
  });

  it('breaks on a day with any daily left, and keeps the best run', () => {
    const summary = dailyStreaks(
      makeState({
        games: [game],
        tasks: [commissions, resin],
        completions: [
          ...both('2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14'),
          // Only one of the two on the 15th.
          done('commissions', '2026-11-15'),
          ...both('2026-11-24', '2026-11-25'),
        ],
      }),
      NOW,
    );
    expect(summary.games[0]).toMatchObject({ current: 2, best: 5 });
  });

  it('is zero once yesterday was missed', () => {
    const summary = dailyStreaks(
      makeState({ games: [game], tasks: [commissions, resin], completions: both('2026-11-22', '2026-11-23') }),
      NOW,
    );
    expect(summary.games[0]).toMatchObject({ current: 0, best: 2 });
    expect(summary.current).toBe(0);
  });

  it('reads the day by the game’s reset, not midnight', () => {
    // 02:00 on the 27th at the server is still the 26th's game day.
    const early = utc('2026-11-27T01:00:00Z');
    const summary = dailyStreaks(
      makeState({ games: [game], tasks: [commissions, resin], completions: both('2026-11-25', '2026-11-26') }),
      early,
    );
    expect(summary.games[0]).toMatchObject({ current: 2, today: true });
  });

  it('takes a counter as done at its target, and ignores unticked or deleted rows', () => {
    const bosses = makeTask({ id: 'bosses', gameId: 'g1', name: 'Bosses', mode: 'count', countTarget: 3 });
    const summary = dailyStreaks(
      makeState({
        games: [game],
        tasks: [commissions, bosses],
        completions: [
          done('commissions', '2026-11-24'),
          done('bosses', '2026-11-24', { done: false, countDone: 3 }),
          done('commissions', '2026-11-25'),
          done('bosses', '2026-11-25', { done: false, countDone: 2 }),
          done('commissions', '2026-11-23', { done: false }),
          done('bosses', '2026-11-23', { countDone: 3, deleted: true }),
        ],
      }),
      NOW,
    );
    expect(summary.games[0]).toMatchObject({ current: 0, best: 1 });
  });

  it('leaves out paused and deleted games, games without dailies, and non-daily tasks', () => {
    const weekly = makeTask({ id: 'weekly', gameId: 'g2', cadence: 'weekly' });
    const summary = dailyStreaks(
      makeState({
        games: [
          game,
          makeGame({ id: 'g2', tz: 'UTC' }),
          makeGame({ id: 'g3', tz: 'UTC', paused: true }),
          makeGame({ id: 'g4', tz: 'UTC', deleted: true }),
        ],
        tasks: [
          commissions,
          weekly,
          makeTask({ id: 'p', gameId: 'g3' }),
          makeTask({ id: 'd', gameId: 'g4' }),
          makeTask({ id: 'gone', gameId: 'g1', deleted: true }),
        ],
        completions: [done('commissions', '2026-11-25'), done('p', '2026-11-25'), done('d', '2026-11-25')],
      }),
      NOW,
    );
    expect(summary.games.map((item) => item.gameId)).toEqual(['g1']);
    expect(summary.games[0]).toMatchObject({ current: 1 });
  });

  it('counts a day overall when any game finished it, longest current streak first', () => {
    const other = makeGame({ id: 'g2', tz: 'UTC', dailyResetHour: 4 });
    const otherDaily = makeTask({ id: 'other', gameId: 'g2' });
    const summary = dailyStreaks(
      makeState({
        games: [game, other],
        tasks: [commissions, otherDaily],
        completions: [
          done('commissions', '2026-11-22'),
          done('other', '2026-11-23'),
          done('commissions', '2026-11-24'),
          done('other', '2026-11-24'),
          done('other', '2026-11-25'),
        ],
      }),
      NOW,
    );
    expect(summary.games.map((item) => [item.gameId, item.current])).toEqual([
      ['g2', 3],
      ['g1', 0],
    ]);
    expect(summary).toMatchObject({ current: 4, best: 4 });
  });

  it('is empty without games', () => {
    expect(dailyStreaks(makeState(), NOW)).toEqual({ games: [], current: 0, best: 0 });
  });

  it('keeps an existing streak when a new daily task is added, then requires it from today onward', () => {
    const added = makeTask({ id: 'extra', gameId: 'g1', name: 'New daily' });
    const history = both('2026-11-20', '2026-11-21', '2026-11-22', '2026-11-23', '2026-11-24', '2026-11-25');
    // Put the newly added daily first to ensure candidate collection never depends on task order.
    const beforeToday = dailyStreaks(
      makeState({ games: [game], tasks: [added, commissions, resin], completions: history }),
      NOW,
    );
    expect(beforeToday.games[0]).toEqual({ gameId: 'g1', current: 6, best: 6, today: false });
    expect(beforeToday).toMatchObject({ current: 6, best: 6 });

    // Ticking only old dailies today does not finish today once the new daily exists.
    const partialToday = dailyStreaks(
      makeState({
        games: [game],
        tasks: [added, commissions, resin],
        completions: [...history, ...both('2026-11-26')],
      }),
      NOW,
    );
    expect(partialToday.games[0]).toEqual({ gameId: 'g1', current: 6, best: 6, today: false });

    const finishedToday = dailyStreaks(
      makeState({
        games: [game],
        tasks: [added, commissions, resin],
        completions: [...history, ...both('2026-11-26'), done('extra', '2026-11-26')],
      }),
      NOW,
    );
    expect(finishedToday.games[0]).toEqual({ gameId: 'g1', current: 7, best: 7, today: true });
    expect(finishedToday).toMatchObject({ current: 7, best: 7 });
  });

  it('keeps the overall streak when an earlier time zone has a game whose day is still open', () => {
    // At 2026-11-26 20:00 UTC:
    // - Tokyo (UTC+9, 05:00 on 27th) is already on D2026-11-27.
    // - Los Angeles (UTC-8, 12:00 on 26th) is still on open D2026-11-26.
    const tokyo = makeGame({ id: 'tokyo', tz: 'Asia/Tokyo', dailyResetHour: 4 });
    const la = makeGame({ id: 'la', tz: 'America/Los_Angeles', dailyResetHour: 4 });
    const tTask = makeTask({ id: 't-daily', gameId: 'tokyo' });
    const lTask = makeTask({ id: 'l-daily', gameId: 'la' });
    const summary = dailyStreaks(
      makeState({
        games: [tokyo, la],
        tasks: [tTask, lTask],
        completions: [done('t-daily', '2026-11-24'), done('t-daily', '2026-11-25'), done('t-daily', '2026-11-27')],
      }),
      utc('2026-11-26T20:00:00Z'),
    );
    expect(summary).toMatchObject({ current: 3, best: 3 });
  });
});
