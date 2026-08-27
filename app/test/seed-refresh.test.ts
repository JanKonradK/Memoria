import { emptyState, PRESETS, type AppState, type Game, type GameEvent } from '@memoria/shared';
import { describe, expect, it } from 'vitest';
import { seedBundledEvents } from '../src/store';
import { SEED_EVENTS, SEED_UPDATED } from '../src/data/seed-events';

/**
 * The promise made to anyone who pulls a new build: their document gains the
 * corrections and loses nothing they put there themselves.
 */
const AT = Date.parse('2026-08-27T12:00:00Z');

function gameFor(key: string, id: string): Game {
  const preset = PRESETS.find((p) => p.key === key)!;
  return {
    id,
    name: preset.name,
    presetKey: preset.key,
    short: preset.short ?? key,
    color: preset.color,
    color2: preset.color2,
    color3: preset.color3,
    icon: preset.icon,
    platform: preset.platform,
    tz: preset.tz,
    dailyResetHour: preset.dailyResetHour,
    weeklyResetDay: preset.weeklyResetDay,
    monthlyResetDay: preset.monthlyResetDay,
    paused: false,
    sort: 0,
    updatedAt: 1,
  };
}

/** A document as an older build would have left it: seeded rows, no fingerprints. */
function friendsDocument(): AppState {
  const games = [gameFor('hsr', 'hsr-1'), gameFor('genshin', 'gi-1')];
  const before = { ...emptyState(), games, settings: { ...emptyState().settings, updatedAt: 1 } };
  const seeded = seedBundledEvents(before, AT);
  // Pretend it was written by the previous bundle.
  return {
    ...seeded,
    events: seeded.events.map((event) => {
      const stripped = { ...event };
      delete stripped.seedHash;
      return stripped;
    }),
    settings: { ...seeded.settings, seedImportedVersion: '2026-08-18' },
  };
}

describe('shipping a new bundle to an existing install', () => {
  it('adopts every seeded row without changing one of them', () => {
    const before = friendsDocument();
    const after = seedBundledEvents(before, AT);

    expect(before.events.every((e) => e.seedHash === undefined)).toBe(true);
    expect(after.events.every((e) => e.seedHash !== undefined)).toBe(true);
    for (const was of before.events) {
      const now = after.events.find((e) => e.id === was.id)!;
      expect({ n: now.name, s: now.start, e: now.end, t: now.notes }).toEqual({
        n: was.name,
        s: was.start,
        e: was.end,
        t: was.notes,
      });
    }
    expect(after.settings.seedImportedVersion).toBe(SEED_UPDATED);
  });

  it('keeps the edits, the tick marks and the deletions across a refresh', () => {
    const base = seedBundledEvents(friendsDocument(), AT);
    const [renamed, ticked, removed, muted] = base.events.slice(0, 4) as GameEvent[];

    const customised: AppState = {
      ...base,
      settings: { ...base.settings, seedImportedVersion: '2026-08-18' },
      events: base.events.map((event) => {
        if (event.id === renamed!.id) return { ...event, name: 'RAID NIGHT — do not miss', notes: 'ping the group' };
        if (event.id === ticked!.id) return { ...event, done: true };
        if (event.id === removed!.id) return { ...event, deleted: true };
        if (event.id === muted!.id) return { ...event, notify: false };
        return event;
      }),
    };

    const after = seedBundledEvents(customised, AT);
    const find = (id: string) => after.events.find((e) => e.id === id)!;

    expect(find(renamed!.id).name).toBe('RAID NIGHT — do not miss');
    expect(find(renamed!.id).notes).toBe('ping the group');
    expect(find(ticked!.id).done).toBe(true);
    expect(find(removed!.id).deleted).toBe(true);
    expect(find(muted!.id).notify).toBe(false);
  });

  it('never touches a hand-made event or anything outside the event list', () => {
    const base = { ...seedBundledEvents(friendsDocument(), AT) };
    const mine: GameEvent = {
      id: 'mine',
      gameId: 'hsr-1',
      name: 'Coffee with M',
      type: 'custom',
      start: AT,
      end: AT + 3_600_000,
      dailyTouch: false,
      notify: true,
      notes: 'the good place',
      updatedAt: 1,
    };
    const before: AppState = {
      ...base,
      events: [...base.events, mine],
      settings: { ...base.settings, seedImportedVersion: '2026-08-18' },
    };

    const after = seedBundledEvents(before, AT);

    expect(after.events.find((e) => e.id === 'mine')).toEqual(mine);
    expect(after.games).toEqual(before.games);
    expect(after.chips).toEqual(before.chips);
    expect(after.tasks).toEqual(before.tasks);
    expect(after.energySnapshots ?? []).toEqual(before.energySnapshots ?? []);
  });

  it('withdraws a row the bundle drops, once the row has been stamped', () => {
    const base = seedBundledEvents(friendsDocument(), AT);
    const orphan = base.events.find((e) => e.seedHash && !e.deleted)!;
    const stillShipped = new Set(SEED_EVENTS.map((seed) => seed.sourceKey));
    expect(stillShipped.has(orphan.sourceKey!)).toBe(true);

    // Simulate the bundle dropping it by pointing the row at a key nothing ships.
    const withdrawn: AppState = {
      ...base,
      settings: { ...base.settings, seedImportedVersion: '2026-08-18' },
      events: base.events.map((e) => (e.id === orphan.id ? { ...e, sourceKey: 'seed:gone:upstream' } : e)),
    };

    const after = seedBundledEvents(withdrawn, AT);

    expect(after.events.find((e) => e.id === orphan.id)!.deleted).toBe(true);
  });
});
