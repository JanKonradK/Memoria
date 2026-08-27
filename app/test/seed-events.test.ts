import { emptyState, PRESETS, type Game, type GameEvent } from '@memoria/shared';
import { describe, expect, it } from 'vitest';
import { eventFingerprint, planSeedImport, SEED_EVENTS, SEED_UPDATED } from '../src/data/seed-events';

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
      (item) => item.seed?.sourceKey === maintenance.sourceKey,
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
      (item) => item.seed?.sourceKey === maintenance.sourceKey,
    );

    const added = planned.filter((item) => item.kind === 'add');
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ kind: 'add', gameId: 'us' });
    expect(added[0]!.seed!.sourceKey).toBe('seed:genshin:6.8-maint');
  });

  it('keeps the name-collision guard inside one account', () => {
    const twin = { ...importedMaintenance(), id: 'manual-eu', sourceKey: undefined };
    const state = {
      ...emptyState(),
      games: [account('eu', 'Etc/GMT-1'), account('us', 'Etc/GMT+5')],
      events: [twin],
    };

    const planned = planSeedImport(state, beforeMaintenance).filter(
      (item) => item.seed?.sourceKey === maintenance.sourceKey,
    );

    expect(planned.map((item) => item.gameId)).toEqual(['us']);
  });
});

describe('livestream seeds', () => {
  const streams = SEED_EVENTS.filter((seed) => seed.type === 'livestream');

  it('carries one next-patch broadcast per game that runs one', () => {
    // LADS, Uma and NIKKE have no recurring patch broadcast; Endfield's 1.5
    // preview already aired and 1.6 has no history to predict from.
    expect(streams.map((seed) => seed.game).sort()).toEqual(['genshin', 'hsr', 'nte', 'wuwa', 'zzz']);
    expect(new Set(streams.map((seed) => seed.sourceKey)).size).toBe(streams.length);
  });

  it('states its uncertainty in the name rather than by going silent', () => {
    // The honesty valve inverts here on purpose: a predicted stream is an
    // estimate, but a reminder that never fires cannot do its job, so the
    // hedge moves into the title and notify stays on.
    for (const seed of streams) {
      expect(seed.notify).not.toBe(false);
      const span = Date.parse(`${seed.end}Z`) - Date.parse(`${seed.start}Z`);
      if (seed.name.includes('predicted')) {
        // A predicted row is a window to watch, not a fixture.
        expect(span).toBeGreaterThan(24 * 60 * 60 * 1000);
        expect(seed.notes ?? '').toMatch(/Not announced/);
      } else {
        expect(span).toBeLessThanOrEqual(4 * 60 * 60 * 1000);
      }
    }
  });

  it('puts every predicted window in the future of the refresh stamp', () => {
    // A stream that has already aired is not a reminder to update anything.
    for (const seed of streams) {
      expect(seed.start.slice(0, 10) >= SEED_UPDATED).toBe(true);
    }
  });
});

/**
 * The contract that makes shipping a new bundle to other people safe: it may
 * correct what it wrote, and nothing else.
 */
describe('refreshing over a live document', () => {
  /** The fingerprint the importer would stamp for the eu maintenance row. */
  function seedStamp(): string {
    const state = { ...emptyState(), games: [account('eu', 'Etc/GMT-1')] };
    const plan = planSeedImport(state, beforeMaintenance).find(
      (item) => item.seed?.sourceKey === maintenance.sourceKey,
    );
    return plan!.hash!;
  }

  function stateWith(event: GameEvent) {
    return { ...emptyState(), games: [account('eu', 'Etc/GMT-1')], events: [event] };
  }

  function planFor(event: GameEvent) {
    return planSeedImport(stateWith(event), beforeMaintenance).filter((item) => item.eventId === event.id);
  }

  it('stamps a matching pre-fingerprint row instead of rewriting it', () => {
    const [plan, ...rest] = planFor(importedMaintenance());

    expect(rest).toHaveLength(0);
    // A baseline, not an edit: no values ride along, so a note the user added
    // to this row before fingerprints existed is not overwritten to get it.
    expect(plan).toEqual({ kind: 'stamp', eventId: 'event-eu', gameId: 'eu', hash: seedStamp() });
  });

  it('still corrects a pre-fingerprint row whose dates drifted', () => {
    // The migration must not strand the corrections it shipped for: an unstamped
    // row with stale dates is the normal case on the very first refresh.
    const stale: GameEvent = { ...importedMaintenance(), start: 1_000, end: 2_000, notes: 'my own note' };

    const [plan, ...rest] = planFor(stale);

    expect(rest).toHaveLength(0);
    expect(plan).toMatchObject({ kind: 'update', eventId: 'event-eu', hash: seedStamp() });
    expect(plan!.start).toBe(importedMaintenance().start);
  });

  it('corrects a stamped row nobody has touched', () => {
    // The row as an older bundle left it: wrong dates, stamped to match them.
    const stale = { ...importedMaintenance(), start: 1_000, end: 2_000 };
    const untouched: GameEvent = { ...stale, seedHash: eventFingerprint(stale) };

    const [plan, ...rest] = planFor(untouched);

    expect(rest).toHaveLength(0);
    expect(plan).toMatchObject({ kind: 'update', eventId: 'event-eu' });
    expect(plan!.start).toBe(importedMaintenance().start);
    expect(plan!.hash).toBe(seedStamp());
  });

  it('withdraws a stamped row the bundle has dropped', () => {
    const base = { ...importedMaintenance(), id: 'orphan', sourceKey: 'seed:genshin:withdrawn-upstream' };
    const untouched: GameEvent = { ...base, seedHash: eventFingerprint(base) };

    expect(planFor(untouched)).toEqual([{ kind: 'remove', eventId: 'orphan', gameId: 'eu' }]);
  });

  it('keeps a dropped row that was edited, ticked off, or never stamped', () => {
    const base = { ...importedMaintenance(), id: 'orphan', sourceKey: 'seed:genshin:withdrawn-upstream' };
    const stamp = eventFingerprint(base);

    // Edited: the stamp no longer describes the row, so it is the user's.
    expect(planFor({ ...base, seedHash: stamp, name: 'my own title' })).toHaveLength(0);
    // Ticked off: a completed row is a record, not clutter to sweep up.
    expect(planFor({ ...base, seedHash: stamp, done: true })).toHaveLength(0);
    // Never stamped: the bundle cannot prove it wrote this, so it does not touch it.
    expect(planFor(base)).toHaveLength(0);
  });

  it('leaves hand-made and HoYoLAB-imported events alone entirely', () => {
    const handMade: GameEvent = {
      ...importedMaintenance(),
      id: 'mine',
      name: 'Coffee with M',
      sourceKey: undefined,
      seedHash: undefined,
    };
    const hoyolab: GameEvent = { ...importedMaintenance(), id: 'feed', sourceKey: 'genshin:99999' };

    expect(planFor(handMade)).toHaveLength(0);
    expect(planFor(hoyolab)).toHaveLength(0);
  });
});
