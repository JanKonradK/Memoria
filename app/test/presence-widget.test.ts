import { emptyState } from '@memoria/shared';
import { describe, expect, it } from 'vitest';
import { makeGame, makeResource, makeSnapshot, makeTask } from '../../shared/test/helpers';
import { watchList } from '../src/presence';
import { widgetSnapshot } from '../src/home-widget';

const now = Date.parse('2026-11-01T12:00:00Z');

describe('game start watch list', () => {
  it('watches preset program names and a picked game program, but not a launcher', () => {
    const state = {
      ...emptyState(),
      games: [
        makeGame({ id: 'genshin', presetKey: 'genshin', processNames: ['GenshinImpact'] }),
        makeGame({ id: 'hsr', name: 'Honkai: Star Rail', short: 'HSR', presetKey: 'hsr' }),
        makeGame({ id: 'custom', name: 'My Game', short: 'MG' }),
        makeGame({ id: 'paused', paused: true, processNames: ['Paused'] }),
      ],
    };
    expect(watchList(state, { genshin: 'HYP.exe', custom: 'MyGame.exe', hsr: 'StarRail Launcher.exe' })).toEqual({
      genshin: ['GenshinImpact'],
      // An older game without saved names falls back to its preset.
      hsr: ['StarRail'],
      custom: ['MyGame.exe'],
    });
  });
});

describe('home widget snapshot', () => {
  it('lists active games most urgent first with their first meter', () => {
    const urgent = makeGame({ id: 'urgent', name: 'Urgent', sort: 1 });
    const calm = makeGame({ id: 'calm', name: 'Calm', sort: 0 });
    const paused = makeGame({ id: 'paused', paused: true });
    const state = {
      ...emptyState(),
      games: [calm, urgent, paused],
      resources: [makeResource({ id: 'r-urgent', gameId: 'urgent', cap: 100, regenMinutes: 6 })],
      snapshots: [makeSnapshot({ resourceId: 'r-urgent', value: 100, takenAt: now - 60_000 })],
      tasks: [makeTask({ gameId: 'calm', cadence: 'daily' })],
    };
    const snapshot = widgetSnapshot(state, now);
    expect(snapshot.generatedAt).toBe(now);
    expect(snapshot.rows.map((row) => row.id)).toEqual(['urgent', 'calm']);
    expect(snapshot.rows[0]).toMatchObject({
      label: 'TL',
      meter: { value: 100, cap: 100, isFull: true, regenMinutes: 6 },
      dailyTotal: 0,
      dailyResetAt: null,
    });
    expect(snapshot.rows[1]).toMatchObject({ meter: null, dailyDone: 0, dailyTotal: 1 });
    expect(snapshot.rows[1]!.dailyResetAt).toBeGreaterThan(now);
  });
});
