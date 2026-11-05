import type { GameUrgency, NextAction } from '@memoria/shared';
import { expect, it } from 'vitest';
import { makeEvent, makeGame } from '../../shared/test/helpers';
import { selectTodayAgenda } from '../src/today-agenda';

const NOW = Date.UTC(2026, 10, 1, 12);
const HOUR = 3_600_000;

function entry(id: string, actions: Array<Omit<NextAction, 'gameId'>>, paused = false): GameUrgency {
  const game = makeGame({ id, name: id, paused });
  const full = actions.map((action) => ({ ...action, gameId: id }));
  return { game, next: full[0] ?? null, actions: full };
}

it('lists the next two days across games, soonest first, with shared resets on one line', () => {
  const order = [
    entry('a', [
      { kind: 'energy_full', at: NOW, label: 'Resin is FULL' },
      { kind: 'daily', at: NOW + 15 * HOUR, label: 'Dailies resets' },
      { kind: 'daily', at: NOW + 15 * HOUR, label: 'Expeditions resets' },
    ]),
    entry('b', [
      { kind: 'energy_full', at: NOW, label: 'Pixels is FULL' },
      { kind: 'energy_soon', at: NOW + 3 * HOUR, label: 'Power caps' },
      { kind: 'daily', at: NOW + 15 * HOUR, label: 'Check-in resets' },
      { kind: 'weekly', at: NOW + 30 * HOUR, label: 'Bosses resets' },
    ]),
    entry('paused', [{ kind: 'energy_full', at: NOW, label: 'X is FULL' }], true),
  ];
  const events = [
    makeEvent({ id: 'ends', gameId: 'a', name: 'Ends soon', start: NOW - HOUR, end: NOW + 5 * HOUR }),
    makeEvent({ id: 'starts', gameId: 'b', name: 'Starts soon', start: NOW + 2 * HOUR, end: NOW + 90 * HOUR }),
    makeEvent({ id: 'later', gameId: 'a', name: 'Ends later', start: NOW - HOUR, end: NOW + 47 * HOUR }),
    makeEvent({ id: 'beyond', gameId: 'a', name: 'Ends after the window', start: NOW - HOUR, end: NOW + 49 * HOUR }),
    makeEvent({ id: 'done', gameId: 'a', name: 'Done', start: NOW - HOUR, end: NOW + HOUR, done: true }),
    makeEvent({ id: 'muted', gameId: 'paused', name: 'Paused game', start: NOW - HOUR, end: NOW + HOUR }),
  ];

  const items = selectTodayAgenda(order, events, NOW);

  expect(items.map((item) => item.key)).toEqual([
    'energy:full',
    'start:starts',
    'energy:b:Power caps',
    'end:ends',
    `reset:daily:${NOW + 15 * HOUR}`,
    `reset:weekly:${NOW + 30 * HOUR}`,
    'end:later',
  ]);
  expect(items[0]).toMatchObject({ label: '2 energy bars full', gameIds: ['a', 'b'], full: true });
  expect(items[4]).toMatchObject({ gameIds: ['a', 'b'], left: 3, cadence: 'daily' });
});
