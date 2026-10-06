import { checklistFor, emptyState, PRESETS, type Game, type GameEvent } from '@memoria/shared';
import { describe, expect, it } from 'vitest';
import {
  eventFingerprint,
  planSeedImport,
  pruneRetiredSeedEvents,
  SEED_EVENTS,
  SEED_RETENTION_MS,
  SEED_UPDATED,
} from '../src/data/seed-events';

const genshin = PRESETS.find((preset) => preset.key === 'genshin')!;
const maintenance = SEED_EVENTS.find((seed) => seed.sourceKey === 'seed:genshin:6.8-maint')!;
const beforeMaintenance = Date.parse('2026-08-07T00:00:00Z');

it.each(['UTC+1', 'UTC+8', 'UTC-5'])('keeps permanent Genshin cycles continuous in %s', (tz) => {
  const state = { ...emptyState(), games: [account('cycle-account', tz)] };
  const planned = planSeedImport(state, Date.parse('2026-06-01T00:00:00Z'));
  for (const name of ['Spiral Abyss', 'Imaginarium Theater']) {
    const cycles = planned.filter((entry) => entry.seed?.name === name).sort((a, b) => a.start! - b.start!);
    expect(cycles.length).toBeGreaterThan(1);
    for (let i = 1; i < cycles.length; i++) {
      expect(cycles[i - 1]!.end).toBe(cycles[i]!.start);
    }
  }
  const stygian = planned.filter((entry) => entry.seed?.name === 'Stygian Onslaught');
  expect(stygian[0]!.end).toBeLessThan(stygian[1]!.start!);
});

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
  it('refreshes a lost legacy category only when it reconstructs the exact stored fingerprint', () => {
    const original = {
      ...importedMaintenance(),
      id: 'legacy-selector',
      sourceKey: 'seed:genshin:7.1-standard-selector',
      name: 'Anniversary standard character selection — time TBC',
      type: 'event' as const,
      category: 'teyvat' as const,
      notify: false,
      start: Date.parse('2026-09-22T23:00:00Z'),
      end: Date.parse('2026-11-03T22:59:00Z'),
    };
    const lost = { ...original, category: undefined, seedHash: eventFingerprint(original), sort: 4, done: true };
    const state = {
      ...emptyState(),
      games: [account('eu', 'UTC+1')],
      events: [lost],
      settings: { ...emptyState().settings, seedImportedVersion: SEED_UPDATED },
    };
    const now = Date.parse('2026-10-03T12:00:00Z');
    const plan = planSeedImport(state, now).find((row) => row.eventId === lost.id);
    expect(plan?.seed).toMatchObject({
      name: 'Across the Frozen Wilds, Honing One’s Edge — choose a standard 5★',
      category: 'teyvat',
    });
    expect(plan?.end).toBe(Date.parse('2026-11-03T13:59:00Z'));
    for (const edited of [
      { ...lost, notes: 'My instructions' },
      { ...lost, end: lost.end + 1 },
      { ...lost, category: 'miliastra' as const },
      { ...lost, deleted: true },
    ]) {
      expect(planSeedImport({ ...state, events: [edited] }, now).some((row) => row.eventId === lost.id)).toBe(false);
    }
  });

  it('corrects pristine Wonderland draws on the same bundle date while preserving owner edits and deletions', () => {
    const previous = {
      ...importedMaintenance(),
      id: 'cosmetic',
      name: 'Event Ode: Moonlight After the Rain',
      type: 'event' as const,
      category: 'miliastra' as const,
      sourceKey: 'genshin:21895',
      start: Date.parse('2026-09-23T03:00:00Z'),
      end: Date.parse('2026-11-03T13:59:00Z'),
    };
    const old = { ...previous, seedHash: eventFingerprint(previous) };
    const state = {
      ...emptyState(),
      games: [account('eu', 'UTC+1')],
      events: [old],
      settings: { ...emptyState().settings, seedImportedVersion: SEED_UPDATED },
    };
    const now = Date.parse('2026-10-03T12:00:00Z');
    const corrected = planSeedImport(state, now).find((row) => row.eventId === 'cosmetic');
    expect(corrected?.seed).toMatchObject({ type: 'banner', bannerKind: 'other', category: 'miliastra' });
    expect(corrected?.end).toBe(previous.end);
    for (const event of [
      { ...old, name: 'My draw' },
      { ...old, deleted: true },
    ]) {
      const plans = planSeedImport({ ...state, events: [event] }, now);
      expect(plans.some((row) => row.eventId === old.id || row.seed?.sourceKey === old.sourceKey)).toBe(false);
    }
  });

  it('keeps a personal Stygian task tied to the full rotation rather than the Resin cutoff', () => {
    const game = account('eu', 'UTC+1');
    const now = Date.parse('2026-10-03T12:00:00Z');
    const plans = planSeedImport({ ...emptyState(), games: [game] }, now);
    const events = plans
      .filter(
        (row) =>
          row.seed?.sourceKey === 'seed:genshin:7.1-stygian' ||
          row.seed?.sourceKey === 'seed:genshin:7.1-disturbance-outbreak',
      )
      .map((row) => ({
        ...importedMaintenance(),
        id: row.seed!.sourceKey,
        name: row.seed!.name,
        type: row.seed!.type,
        start: row.start!,
        end: row.end!,
      }));
    const task = {
      id: 'personal-stygian',
      gameId: game.id,
      name: 'Stygian Onslaught',
      cadence: 'custom' as const,
      intervalDays: 42,
      anchorAt: 0,
      sort: 0,
      updatedAt: 1,
    };
    const [item] = checklistFor({ ...emptyState(), games: [game], events, tasks: [task] }, game, now);
    expect(item?.resetAt).toBe(Date.parse('2026-11-03T02:59:00Z'));
  });

  it.each(['UTC+1', 'UTC+8', 'UTC-5'])('keeps October global and server-local boundaries distinct in %s', (tz) => {
    const games = ['genshin', 'hsr', 'wuwa', 'nte'].map((key) => ({
      ...account(key, tz),
      presetKey: key,
    }));
    const plans = planSeedImport({ ...emptyState(), games }, Date.parse('2026-09-20T00:00:00Z'));
    const row = (key: string) => plans.find((entry) => entry.seed?.sourceKey === key)!;
    const offset = tz === 'UTC+1' ? '+01:00' : tz === 'UTC+8' ? '+08:00' : '-05:00';
    expect(row('seed:genshin:7.1-silverwing').start).toBe(Date.parse(`2026-09-24T10:00:00${offset}`));
    expect(row('seed:genshin:7.1-silverwing').end).toBe(Date.parse(`2026-10-12T03:59:00${offset}`));
    expect(row('seed:genshin:7.1-disturbance-outbreak').start).toBe(Date.parse(`2026-09-30T10:00:00${offset}`));
    expect(row('seed:genshin:7.1-disturbance-outbreak').end).toBe(Date.parse(`2026-10-10T03:59:00${offset}`));
    expect(row('seed:genshin:7.1-stygian').end).toBe(Date.parse(`2026-11-03T03:59:00${offset}`));
    expect(row('seed:genshin:7.1-limited-selector').start).toBe(Date.parse('2026-09-23T03:00:00Z'));
    expect(row('seed:genshin:7.1-limited-selector').end).toBe(Date.parse(`2026-11-03T14:59:00${offset}`));
    expect(row('seed:hsr:4.6-pearl').start).toBe(Date.parse('2026-09-28T03:00:00Z'));
    expect(row('seed:hsr:4.6-pearl').end).toBe(Date.parse(`2026-11-10T15:00:00${offset}`));
    expect(row('seed:hsr:4.6-interastral-gala').start).toBe(Date.parse(`2026-10-21T12:00:00${offset}`));
    expect(row('seed:hsr:4.6-interastral-gala').end).toBe(Date.parse('2026-11-10T19:59:00Z'));
    expect(row('seed:wuwa:3.7-p1').start).toBe(Date.parse('2026-09-30T03:00:00Z'));
    expect(row('seed:wuwa:3.7-p1').end).toBe(Date.parse(`2026-10-22T09:59:00${offset}`));
    expect(row('seed:nte:1.4-coal-lump').start).toBe(Date.parse('2026-10-08T02:00:00Z'));
    expect(row('seed:nte:1.4-pixel-surge').start).toBe(Date.parse(`2026-10-19T05:00:00${offset}`));
  });

  it.each(['UTC+1', 'UTC+8', 'UTC-5'])('keeps newly verified WuWa rewards on the %s server clock', (tz) => {
    const game = { ...account('wuwa-account', tz), presetKey: 'wuwa', name: 'Wuthering Waves', short: 'WW' };
    const rows = planSeedImport({ ...emptyState(), games: [game] }, Date.parse('2026-09-20T22:00:00Z'));
    const chord = rows.find((row) => row.seed?.sourceKey === 'seed:wuwa:3.6-chord')!;
    const gifts = rows.find((row) => row.seed?.sourceKey === 'seed:wuwa:3.7-singing-drizzle')!;
    const offset = tz === 'UTC+1' ? '+01:00' : tz === 'UTC+8' ? '+08:00' : '-05:00';
    expect(chord.start).toBe(Date.parse(`2026-09-22T04:00:00${offset}`));
    expect(chord.end).toBe(Date.parse(`2026-09-29T03:59:00${offset}`));
    expect(gifts.start).toBe(Date.parse(`2026-10-22T10:00:00${offset}`));
    expect(gifts.end).toBe(Date.parse(`2026-11-11T03:59:00${offset}`));
    expect(chord.seed?.notify).not.toBe(false);
    expect(gifts.seed?.notify).not.toBe(false);
  });

  it('imports urgent Genshin gameplay cutoffs separately from the later reward claim', () => {
    const state = {
      ...emptyState(),
      games: [account('eu', 'UTC+1'), account('us', 'UTC-5'), account('asia', 'UTC+8')],
    };
    const plans = planSeedImport(state, Date.parse('2026-09-17T00:00:00Z'));
    const bastion = plans.filter((row) => row.seed?.sourceKey === 'genshin:21816');
    expect(bastion.map((row) => [row.gameId, row.end])).toEqual([
      ['eu', Date.parse('2026-09-17T02:59:00Z')],
      ['us', Date.parse('2026-09-17T08:59:00Z')],
    ]);
    const quests = plans.find(
      (row) => row.gameId === 'eu' && row.seed?.sourceKey === 'seed:genshin:7.0-starlight-voyage-quests',
    );
    const claims = plans.find((row) => row.gameId === 'eu' && row.seed?.sourceKey === 'genshin:21831');
    expect(quests?.end).toBe(Date.parse('2026-09-17T03:00:00Z'));
    expect(claims?.end).toBe(Date.parse('2026-09-21T02:59:00Z'));
    expect(quests?.seed?.notify).not.toBe(false);
    expect(claims?.seed?.notify).not.toBe(false);
  });

  it('opens ZZZ after global maintenance but closes at each server deadline', () => {
    const games = [account('eu', 'Etc/GMT-1'), account('us', 'Etc/GMT+5'), account('asia', 'Etc/GMT-8')].map(
      (game) => ({ ...game, presetKey: 'zzz', name: 'Zenless Zone Zero', short: 'ZZZ' }),
    );
    const imported = planSeedImport({ ...emptyState(), games }, Date.parse('2026-09-08T00:00:00Z'));
    const rows = imported.filter((row) => row.seed.sourceKey === 'seed:zzz:3.2-all-new-program');
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.start)).toEqual(Array(3).fill(Date.parse('2026-09-09T03:00:00Z')));
    expect(rows.map((row) => row.end)).toEqual([
      Date.parse('2026-10-20T02:59:00Z'),
      Date.parse('2026-10-20T08:59:00Z'),
      Date.parse('2026-10-19T19:59:00Z'),
    ]);
    const maintenance = imported.filter((row) => row.seed.sourceKey === 'seed:zzz:3.2-maint');
    expect(maintenance.map((row) => row.start)).toEqual(Array(3).fill(Date.parse('2026-09-08T22:00:00Z')));
  });
  it('uses the official Genshin 7.1 broadcast instant for every server', () => {
    const state = {
      ...emptyState(),
      games: [account('eu', 'Etc/GMT-1'), account('us', 'Etc/GMT+5'), account('asia', 'Etc/GMT-8')],
    };
    const broadcasts = planSeedImport(state, Date.parse('2026-09-07T00:00:00Z')).filter(
      (item) => item.seed.sourceKey === 'seed:genshin:7.1-livestream',
    );
    expect(broadcasts).toHaveLength(3);
    for (const broadcast of broadcasts) {
      expect(broadcast.start).toBe(Date.parse('2026-09-12T12:00:00Z'));
      expect(broadcast.seed.name).toBe('Genshin 7.1 Special Program');
      expect(broadcast.seed.notes).toContain('estimate');
    }
  });
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

  it('keeps predicted windows active or future at the refresh stamp', () => {
    // A window can already be open. Dated broadcasts remain historical facts.
    for (const seed of streams.filter((seed) => seed.name.includes('predicted'))) {
      expect(seed.end.slice(0, 10) >= SEED_UPDATED).toBe(true);
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

describe('two-month retention', () => {
  const DAY = 86_400_000;
  const cutoff = Date.parse('2026-08-27T00:00:00Z') - SEED_RETENTION_MS;

  function event(over: Partial<GameEvent>): GameEvent {
    return {
      id: 'e',
      gameId: 'g',
      name: 'old banner',
      type: 'banner',
      start: cutoff - 30 * DAY,
      end: cutoff - 10 * DAY,
      dailyTouch: false,
      notify: true,
      notes: '',
      seedHash: 'stamped',
      updatedAt: 1,
      ...over,
    };
  }

  it('sweeps bundled events that finished before the cutoff', () => {
    const state = { ...emptyState(), events: [event({})] };
    expect(pruneRetiredSeedEvents(state, cutoff).events).toEqual([]);
  });

  it('keeps anything still inside the window, to the minute', () => {
    const state = { ...emptyState(), events: [event({ id: 'edge', end: cutoff })] };
    expect(pruneRetiredSeedEvents(state, cutoff).events).toHaveLength(1);
  });

  it('never sweeps an event the feed did not create', () => {
    // Hand-made and ⤓ HoYoLAB rows carry no stamp. How long they live is the
    // user's call, not the bundle's, however old they get.
    const handMade = event({ id: 'mine', seedHash: undefined, sourceKey: undefined });
    const hoyolab = event({ id: 'feed', seedHash: undefined, sourceKey: 'genshin:12345' });
    const state = { ...emptyState(), events: [handMade, hoyolab] };

    expect(pruneRetiredSeedEvents(state, cutoff).events).toHaveLength(2);
  });

  it('returns the same object when there is nothing to sweep', () => {
    // Identity matters: a fresh object every load would mark the document dirty
    // and rewrite it forever.
    const state = { ...emptyState(), events: [event({ end: cutoff + DAY })] };
    expect(pruneRetiredSeedEvents(state, cutoff)).toBe(state);
  });

  it('ships no row that already fell outside the window', () => {
    // The bundle and the sweep have to agree, or the importer would add rows on
    // one load that the sweep deletes on the next.
    const oldest = SEED_EVENTS.reduce((worst, seed) => (seed.end < worst ? seed.end : worst), '9999-12-31 23:59');
    const earliestAllowed = new Date(Date.parse(`${SEED_UPDATED}T00:00:00Z`) - SEED_RETENTION_MS)
      .toISOString()
      .slice(0, 10);

    expect(oldest.slice(0, 10) >= earliestAllowed).toBe(true);
  });
});
