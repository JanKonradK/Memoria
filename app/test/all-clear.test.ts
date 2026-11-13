import { expect, it } from 'vitest';
import type { ChecklistItem, EnergyProjection, GameUrgency } from '@memoria/shared';
import { makeGame } from '../../shared/test/helpers';
import { selectAllClear } from '../src/all-clear';
import type { Derived } from '../src/selectors';

const NOW = Date.UTC(2026, 10, 13, 12);
// Daily reset at 04:00 UTC: the next one is 16 hours away.
const RESET = Date.UTC(2026, 10, 14, 4);

function derived(opts: {
  done: boolean;
  fullAt?: number | null;
  isFull?: boolean;
  paused?: boolean;
  noDailies?: boolean;
}) {
  const game = makeGame({
    id: 'g',
    name: 'Genshin Impact',
    tz: 'UTC',
    dailyResetHour: 4,
    paused: opts.paused ?? false,
  });
  const daily = { taskId: 't', gameId: 'g', name: 'Commissions', cadence: 'daily', done: opts.done } as ChecklistItem;
  const next = { kind: 'event' as const, gameId: 'g', at: NOW + 3_600_000, label: 'Lantern Rite ends' };
  const order: GameUrgency[] = [{ game, next, actions: [next] }];
  const projection = { isFull: opts.isFull ?? false, fullAt: opts.fullAt ?? null } as EnergyProjection;
  return {
    now: NOW,
    order,
    checklistByGame: new Map([['g', opts.noDailies ? [] : [daily]]]),
    primaryEnergy: () => ({ resource: undefined, projection }),
  } as unknown as Derived;
}

it('is all clear when every daily is done and nothing caps before the reset', () => {
  expect(selectAllClear(derived({ done: true, fullAt: RESET + 1 }))).toEqual({
    until: RESET,
    next: expect.objectContaining({ gameName: 'Genshin Impact', label: 'Lantern Rite ends' }),
  });
});

it('is not all clear with a daily left, energy full, or a cap before the reset', () => {
  expect(selectAllClear(derived({ done: false }))).toBeNull();
  expect(selectAllClear(derived({ done: true, isFull: true }))).toBeNull();
  expect(selectAllClear(derived({ done: true, fullAt: RESET - 60_000 }))).toBeNull();
});

it('does not celebrate an empty or untracked list', () => {
  expect(selectAllClear(derived({ done: true, paused: true }))).toBeNull();
  expect(selectAllClear(derived({ done: true, noDailies: true }))).toBeNull();
});
