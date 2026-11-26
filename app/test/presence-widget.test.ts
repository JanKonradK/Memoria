import { emptyState } from '@memoria/shared';
import { describe, expect, it, vi } from 'vitest';
import { makeGame, makeResource, makeSnapshot, makeTask } from '../../shared/test/helpers';
import { watchList } from '../src/presence';
import { openFromWidget, widgetSnapshot } from '../src/home-widget';

const scan = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('../src/connectors', () => ({ scanWithCamera: scan }));

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
      name: 'Urgent',
      label: 'TL',
      meter: { value: 100, cap: 100, isFull: true, regenMinutes: 6 },
      dailyTotal: 0,
      dailyResetAt: null,
    });
    expect(snapshot.rows[1]).toMatchObject({ meter: null, dailyDone: 0, dailyTotal: 1 });
    expect(snapshot.rows[1]!.dailyResetAt).toBeGreaterThan(now);
  });

  it('keeps games pinned to a single-game widget even outside the top 24', () => {
    const games = Array.from({ length: 26 }, (_, index) =>
      makeGame({ id: `g${index}`, name: `Game ${index}`, sort: index }),
    );
    const snapshot = widgetSnapshot({ ...emptyState(), games }, now, ['g25']);
    expect(snapshot.rows.map((row) => row.id)).toContain('g25');
    expect(snapshot.rows).toHaveLength(25);
  });
});

describe('widget ticks', () => {
  it('apply dailies ticked on the widget today, once per game, and ignore ticks from before the reset', async () => {
    const { useApp } = await import('../src/store');
    const { applyWidgetTicks } = await import('../src/home-widget');
    const game = makeGame({ id: 'g1' });
    useApp.setState({
      state: { ...emptyState(), games: [game], tasks: [makeTask({ gameId: 'g1', cadence: 'daily' })] },
      loaded: true,
    });
    const day = 24 * 3_600_000;
    const queue = JSON.stringify([
      { gameId: 'g1', at: now - day * 2 },
      { gameId: 'g1', at: now - 60_000 },
      { gameId: 'g1', at: now - 30_000 },
      { gameId: 'gone', at: now - 60_000 },
    ]);
    expect(applyWidgetTicks(queue, now)).toEqual(['g1']);
    expect(applyWidgetTicks('not json', now)).toEqual([]);
  });
});

describe('widget links', () => {
  it('opens the camera reader from the Quick Scan widget', async () => {
    openFromWidget('memoria://scan');
    await vi.waitFor(() => expect(scan).toHaveBeenCalledOnce());
  });
});
