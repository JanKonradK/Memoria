import { describe, expect, it } from 'vitest';
import { bankCounterOf, bankedCounterIds, energyBank } from '../src/bank';
import { latestSnapshots, projectEnergy } from '../src/energy';
import { todaySteps } from '../src/today-steps';
import { makeGame, makeResource, makeSnapshot, makeState, utc } from './helpers';

const NOW = utc('2026-11-18T14:00:00Z');
const MIN = 60_000;
const genshin = makeGame({ id: 'genshin', name: 'Genshin Impact', tz: 'UTC', dailyResetHour: 3 });
const hsr = makeGame({ id: 'hsr', name: 'Honkai: Star Rail', tz: 'UTC', dailyResetHour: 4 });

const resin = makeResource({ id: 'resin', gameId: 'genshin', name: 'Original Resin', cap: 200, regenMinutes: 8 });
const condensed = makeResource({
  id: 'condensed',
  gameId: 'genshin',
  name: 'Condensed Resin',
  cap: 5,
  regenMinutes: 0,
  kind: 'counter',
  sort: 1,
});
const realm = makeResource({
  id: 'realm',
  gameId: 'genshin',
  name: 'Realm Currency',
  cap: 2400,
  regenMinutes: 1,
  sort: 2,
});
const power = makeResource({
  id: 'power',
  gameId: 'hsr',
  name: 'Trailblaze Power',
  cap: 300,
  regenMinutes: 6,
  reserveCap: 2400,
  reserveLabel: 'Reserved Trailblaze Power',
});

describe('bank pairing', () => {
  it('pairs a counter named for the same stuff with its bar', () => {
    const all = [resin, condensed, realm];
    expect(bankCounterOf(resin, all)?.id).toBe('condensed');
    expect(bankCounterOf(realm, all)).toBeUndefined();
    expect([...bankedCounterIds(all)]).toEqual(['condensed']);
  });

  it('leaves a counter of another game, or a deleted one, alone', () => {
    expect(bankCounterOf(resin, [resin, { ...condensed, gameId: 'other' }])).toBeUndefined();
    expect(bankCounterOf(resin, [resin, { ...condensed, deleted: true }])).toBeUndefined();
  });

  it('prefers the bar’s own reserve over any counter', () => {
    const counter = makeResource({ id: 'c', gameId: 'hsr', name: 'Fuel Power', cap: 5, kind: 'counter' });
    expect(bankCounterOf(power, [power, counter])).toBeUndefined();
  });
});

describe('energyBank', () => {
  it('reads a counter bank from its latest snapshot', () => {
    const snaps = latestSnapshots([
      makeSnapshot({ id: 's1', resourceId: 'resin', value: 137, takenAt: NOW }),
      makeSnapshot({ id: 's2', resourceId: 'condensed', value: 3, takenAt: NOW - 60 * MIN }),
    ]);
    const proj = projectEnergy(resin, snaps.get('resin'), NOW, genshin);
    expect(energyBank(resin, proj, [resin, condensed], snaps, NOW, genshin)).toMatchObject({
      kind: 'counter',
      resourceId: 'condensed',
      label: 'Condensed Resin',
      value: 3,
      cap: 5,
      full: false,
    });
  });

  it('reports an unread counter as unread, not empty', () => {
    const snaps = latestSnapshots([makeSnapshot({ id: 's1', resourceId: 'resin', value: 137, takenAt: NOW })]);
    const proj = projectEnergy(resin, snaps.get('resin'), NOW, genshin);
    expect(energyBank(resin, proj, [resin, condensed], snaps, NOW, genshin)?.value).toBeNull();
  });

  it('projects a reserve that fills while the bar sits at cap', () => {
    const snaps = latestSnapshots([
      makeSnapshot({ id: 's1', resourceId: 'power', value: 300, reserve: 100, takenAt: NOW - 120 * MIN }),
    ]);
    const proj = projectEnergy(power, snaps.get('power'), NOW, hsr);
    const bank = energyBank(power, proj, [power], snaps, NOW, hsr)!;
    expect(bank).toMatchObject({ kind: 'reserve', label: 'Reserved Trailblaze Power', cap: 2400, full: false });
    // Half speed by default: 120 minutes at 12 minutes a point.
    expect(bank.value).toBe(110);
    expect(bank.fullAt).not.toBeNull();
  });

  it('is part of Today’s energy step', () => {
    const state = makeState({
      games: [genshin],
      resources: [resin, condensed],
      snapshots: [
        makeSnapshot({ id: 's1', resourceId: 'resin', value: 190, takenAt: NOW }),
        makeSnapshot({ id: 's2', resourceId: 'condensed', value: 5, takenAt: NOW }),
      ],
    });
    const step = todaySteps(state, NOW).groups.flatMap((group) => group.steps)[0];
    expect(step).toMatchObject({ kind: 'energy', resourceId: 'resin', bank: { value: 5, full: true } });
  });
});
