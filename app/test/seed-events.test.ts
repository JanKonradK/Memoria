import { emptyState, PRESETS, type Game, type GameEvent } from '@memoria/shared';
import { describe, expect, it } from 'vitest';
import { planSeedImport, SEED_EVENTS } from '../src/data/seed-events';

const genshin = PRESETS.find((preset) => preset.key === 'genshin')!;
const maintenance = SEED_EVENTS.find((seed) => seed.sourceKey === 'seed:genshin:6.8-maint')!;
const beforeMaintenance = Date.parse('2026-08-07T00:00:00Z');

function account(id: string, tz: string): Game {
  return {
    id,
    name: genshin.name,
    presetKey: genshin.key,
    accountLabel: id,
    short: 'GI',
    color: genshin.color,
    color2: genshin.color2,
    color3: genshin.color3,
    icon: genshin.icon,
    platform: genshin.platform,
    tz,
    dailyResetHour: genshin.dailyResetHour,
    weeklyResetDay: genshin.weeklyResetDay,
    monthlyResetDay: genshin.monthlyResetDay,
    paused: false,
    sort: id === 'eu' ? 0 : 1,
    updatedAt: 1,
  };
}

function importedMaintenance(): GameEvent {
  return {
    id: 'event-eu',
    gameId: 'eu',
    name: maintenance.name,
    type: maintenance.type,
    start: Date.parse('2026-08-11T22:00:00Z'),
    end: Date.parse('2026-08-12T03:00:00Z'),
    dailyTouch: false,
    notify: true,
    notes: maintenance.notes ?? '',
    sourceKey: maintenance.sourceKey,
    updatedAt: 1,
  };
}

describe('planSeedImport', () => {
  it('plans one timezone-adjusted seed for every account of a preset', () => {
    const state = {
      ...emptyState(),
      games: [account('eu', 'Etc/GMT-1'), account('us', 'Etc/GMT+5')],
    };

    const planned = planSeedImport(state, beforeMaintenance).filter(
      (item) => item.seed.sourceKey === maintenance.sourceKey,
    );

    expect(planned.map((item) => item.gameId)).toEqual(['eu', 'us']);
    expect(planned[1]!.start - planned[0]!.start).toBe(6 * 60 * 60 * 1000);
    expect(planned.every((item) => item.seed.sourceKey === maintenance.sourceKey)).toBe(true);
  });

  it('scopes source identity to the account without changing sourceKey', () => {
    const state = {
      ...emptyState(),
      games: [account('eu', 'Etc/GMT-1'), account('us', 'Etc/GMT+5')],
      events: [importedMaintenance()],
    };

    const planned = planSeedImport(state, beforeMaintenance).filter(
      (item) => item.seed.sourceKey === maintenance.sourceKey,
    );

    expect(planned).toHaveLength(1);
    expect(planned[0]).toMatchObject({ kind: 'add', gameId: 'us' });
    expect(planned[0]!.seed.sourceKey).toBe('seed:genshin:6.8-maint');
  });

  it('keeps the name-collision guard inside one account', () => {
    const twin = { ...importedMaintenance(), id: 'manual-eu', sourceKey: undefined };
    const state = {
      ...emptyState(),
      games: [account('eu', 'Etc/GMT-1'), account('us', 'Etc/GMT+5')],
      events: [twin],
    };

    const planned = planSeedImport(state, beforeMaintenance).filter(
      (item) => item.seed.sourceKey === maintenance.sourceKey,
    );

    expect(planned.map((item) => item.gameId)).toEqual(['us']);
  });
});
