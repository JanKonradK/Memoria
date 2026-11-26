import { describe, expect, it } from 'vitest';
import {
  assertStateCapacity,
  COMPLETION_RETENTION_MS,
  compactState,
  mergeState,
  normalizeState,
  pruneCompletions,
  slimTombstones,
  thinSnapshots,
  TOMBSTONE_RETENTION_MS,
  TOMBSTONE_SLIM_MS,
} from '../src/merge';
import { latestSnapshots } from '../src/energy';
import { groupBy } from '../src/internal';
import { MAX_GAME_IMAGE_LENGTH, type AppState, type Snapshot } from '../src/types';
import { APP_STATE_COLLECTION_LIMITS, FUTURE_CLOCK_SKEW_TOLERANCE_MS, safeParseAppState } from '../src/validation';
import { makeEvent, makeGame, makeResource, makeSnapshot, makeState, makeTask } from './helpers';

describe('mergeState', () => {
  it('rejects an oversized local document before normalization can truncate it', () => {
    const local = makeState({ games: Array.from({ length: 101 }, (_, i) => makeGame({ id: `g${i}` })) });
    expect(() => assertStateCapacity(local)).toThrow('100 item limit');
    expect(() => mergeState(local, makeState())).toThrow('100 item limit');
    expect(local.games).toHaveLength(101);
  });

  it('keeps the newer row per id (LWW)', () => {
    const a = makeState({ games: [makeGame({ name: 'Old', updatedAt: 1 })] });
    const b = makeState({ games: [makeGame({ name: 'New', updatedAt: 2 })] });
    expect(mergeState(a, b).games[0]!.name).toBe('New');
    expect(mergeState(b, a).games[0]!.name).toBe('New'); // commutative
  });

  it('propagates newer tombstones over older edits', () => {
    const edited = makeState({ games: [makeGame({ name: 'Edited', updatedAt: 5 })] });
    const deleted = makeState({ games: [makeGame({ deleted: true, updatedAt: 9 })] });
    expect(mergeState(edited, deleted).games[0]!.deleted).toBe(true);
  });

  it('rejects a merged collection above capacity without losing existing rows', () => {
    const pc = makeState({ games: Array.from({ length: 100 }, (_, i) => makeGame({ id: `z${i}` })) });
    const phone = makeState({ games: [makeGame({ id: 'a-new' })] });
    const beforePc = JSON.stringify(pc);
    const beforePhone = JSON.stringify(phone);
    expect(() => mergeState(pc, phone)).toThrow('combined games exceed the 100 item limit');
    expect(() => mergeState(phone, pc)).toThrow('combined games exceed the 100 item limit');
    expect(JSON.stringify(pc)).toBe(beforePc);
    expect(JSON.stringify(phone)).toBe(beforePhone);
  });

  it('merges updates and tombstones at capacity without counting shared IDs twice', () => {
    const pc = makeState({ games: Array.from({ length: 100 }, (_, i) => makeGame({ id: `g${i}`, updatedAt: 1 })) });
    const phone = makeState({
      games: [
        makeGame({ id: 'g0', name: 'Updated', updatedAt: 2 }),
        makeGame({ id: 'g1', deleted: true, updatedAt: 2 }),
      ],
    });
    const merged = mergeState(pc, phone);
    expect(merged.games).toHaveLength(100);
    expect(merged.games.find((game) => game.id === 'g0')?.name).toBe('Updated');
    expect(merged.games.find((game) => game.id === 'g1')?.deleted).toBe(true);
  });

  it('unions snapshots and trims to the most recent 200 per resource', () => {
    const a = makeState({
      snapshots: Array.from({ length: 150 }, (_, i) => makeSnapshot({ id: `a${i}`, takenAt: i })),
    });
    const b = makeState({
      snapshots: Array.from({ length: 150 }, (_, i) => makeSnapshot({ id: `b${i}`, takenAt: 1000 + i })),
    });
    const merged = mergeState(a, b);
    expect(merged.snapshots).toHaveLength(200);
    // All the newer "b" snapshots survive.
    expect(merged.snapshots.filter((s) => s.id.startsWith('b'))).toHaveLength(150);
  });

  it('uses the newer legacy settings clock when field clocks are absent', () => {
    const a = makeState();
    a.settings = { ...a.settings, localTz: 'Europe/Warsaw', updatedAt: 10 };
    const b = makeState();
    b.settings = { ...b.settings, localTz: 'UTC', updatedAt: 3 };
    expect(mergeState(a, b).settings.localTz).toBe('Europe/Warsaw');
  });

  it('merges unrelated settings fields without losing either device edit', () => {
    const a = makeState();
    a.settings = {
      ...a.settings,
      localTz: 'Europe/Warsaw',
      fieldUpdatedAt: { localTz: 20, sleepHours: 1 },
      updatedAt: 20,
    };
    const b = makeState();
    b.settings = {
      ...b.settings,
      localTz: 'UTC',
      sleepHours: 10,
      fieldUpdatedAt: { localTz: 1, sleepHours: 30 },
      updatedAt: 30,
    };
    const merged = mergeState(a, b);
    expect(merged.settings.localTz).toBe('Europe/Warsaw');
    expect(merged.settings.sleepHours).toBe(10);
  });

  it('is idempotent', () => {
    const a = makeState({ games: [makeGame()] });
    const once = mergeState(a, a);
    expect(once.games).toHaveLength(1);
    expect(mergeState(once, once)).toEqual(once);
  });

  it('resolves equal-timestamp conflicts deterministically', () => {
    const left = makeState({ games: [makeGame({ name: 'Alpha', updatedAt: 10 })] });
    const right = makeState({ games: [makeGame({ name: 'Omega', updatedAt: 10 })] });
    expect(mergeState(left, right)).toEqual(mergeState(right, left));
  });

  it('drops a poisoned future row before LWW instead of letting it beat sane local data', () => {
    const now = Date.now();
    const local = makeState({ games: [makeGame({ name: 'Local', updatedAt: now })] });
    const future = makeState({
      games: [
        makeGame({
          name: 'Future',
          updatedAt: now + FUTURE_CLOCK_SKEW_TOLERANCE_MS + 60_000,
        }),
      ],
    });

    expect(mergeState(local, future).games[0]!.name).toBe('Local');
    expect(mergeState(local, future)).toEqual(mergeState(future, local));
  });
});

describe('normalizeState', () => {
  it('fills missing collections and settings defaults', () => {
    const s = normalizeState({ games: [makeGame()] });
    expect(s.games).toHaveLength(1);
    expect(s.tasks).toEqual([]);
    expect(s.settings.localTz).toBeTruthy();
  });

  it('strips legacy credentials from normalized sync state', () => {
    const state = normalizeState({
      settings: {
        ...makeState().settings,
        discordWebhook: 'https://discord.com/api/webhooks/secret',
        telegramToken: '12345:secret',
        telegramChatId: '123456789',
      },
    });
    expect(state.settings).not.toHaveProperty('discordWebhook');
    expect(state.settings).not.toHaveProperty('telegramToken');
    expect(state.settings).not.toHaveProperty('telegramChatId');
  });
  it('tolerates garbage', () => {
    expect(normalizeState(null).games).toEqual([]);
    expect(normalizeState('x').events).toEqual([]);
  });

  it('normalizes legacy resources and tasks with inferred tracking metadata', () => {
    const state = normalizeState({
      resources: [
        {
          id: 'r1',
          gameId: 'g1',
          name: 'Condensed Resin',
          cap: 5,
          regenMinutes: 0,
          reserveCap: 0,
          sort: 0,
          updatedAt: 1,
        },
      ],
      tasks: [
        {
          id: 't1',
          gameId: 'g1',
          name: 'Weekly Bosses ×3',
          cadence: 'weekly',
          intervalDays: 1,
          anchorAt: 0,
          sort: 0,
          updatedAt: 1,
        },
      ],
    });
    expect(state.resources[0]!.kind).toBe('counter');
    expect(state.tasks[0]!.mode).toBe('count');
    expect(state.tasks[0]!.countTarget).toBe(3);
  });

  it('drops unusable optional numbers but keeps an idle timer null', () => {
    // These fields all mean "infer the default when absent", so a broken value
    // must become absent — not zero, and not a reason to lose the whole row.
    const state = normalizeState(
      makeState({
        resources: [makeResource({ id: 'r1', reserveRegenMinutes: 0 })],
        tasks: [
          makeTask({
            id: 'idle',
            name: 'Expeditions (collect + resend)',
            timerEndsAt: null,
            timerStepMinutes: -5,
            countTarget: 900,
          }),
          makeTask({ id: 'running', name: 'Expeditions (collect + resend)', timerEndsAt: 1_700_000_000_123.7 }),
        ],
      }),
    );

    expect(state.resources[0]).not.toHaveProperty('reserveRegenMinutes');
    const idle = state.tasks.find((task) => task.id === 'idle')!;
    expect(idle.timerEndsAt).toBeNull();
    expect(idle).not.toHaveProperty('timerStepMinutes');
    // 365 is the schema ceiling; the row survives clamped rather than dropped.
    expect(idle.countTarget).toBe(365);
    expect(state.tasks.find((task) => task.id === 'running')!.timerEndsAt).toBe(1_700_000_000_124);
  });

  it('drops oversized images so imported documents self-heal before validation', () => {
    const state = normalizeState({
      games: [makeGame({ image: 'x'.repeat(MAX_GAME_IMAGE_LENGTH + 1) })],
    });
    expect(state.games[0]).not.toHaveProperty('image');
  });

  it('keeps embedded pictures but drops web addresses and SVG, which could load from elsewhere', () => {
    const jpeg = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
    const state = normalizeState({
      games: [
        makeGame({ id: 'ok', image: jpeg }),
        makeGame({ id: 'web', image: 'https://tracker.example/pixel.png' }),
        makeGame({ id: 'svg', image: 'data:image/svg+xml;base64,PHN2Zz4=' }),
        makeGame({ id: 'path', image: '//tracker.example/p.png' }),
      ],
    });
    const image = (id: string) => state.games.find((game) => game.id === id)?.image;
    expect(image('ok')).toBe(jpeg);
    expect(image('web')).toBeUndefined();
    expect(image('svg')).toBeUndefined();
    expect(image('path')).toBeUndefined();
  });

  it('drops one irreparable row without losing its siblings or other collections', () => {
    const state = normalizeState(
      makeState({
        games: [makeGame({ id: '', name: 'Broken identity' }), makeGame({ id: 'good-game', name: 'Keep game' })],
        resources: [makeResource({ id: 'keep-resource', gameId: 'good-game' })],
        tasks: [makeTask({ id: 'keep-task', gameId: 'good-game' })],
        events: [makeEvent({ id: 'keep-event', gameId: 'good-game' })],
      }),
    );

    expect(state.games.map((game) => game.id)).toEqual(['good-game']);
    expect(state.resources.map((resource) => resource.id)).toEqual(['keep-resource']);
    expect(state.tasks.map((task) => task.id)).toEqual(['keep-task']);
    expect(state.events.map((event) => event.id)).toEqual(['keep-event']);
    expect(safeParseAppState(state).success).toBe(true);
  });
});

describe('compactState', () => {
  it('drops tombstones older than the retention cutoff', () => {
    const cutoff = 1_000_000;
    const state = makeState({
      games: [
        makeGame({ id: 'live', updatedAt: cutoff }),
        makeGame({ id: 'old-tombstone', deleted: true, updatedAt: cutoff - 1 }),
        makeGame({ id: 'fresh-tombstone', deleted: true, updatedAt: cutoff }),
      ],
    });
    const compacted = compactState(state, cutoff);
    expect(compacted.games.map((game) => game.id)).toEqual(['live', 'fresh-tombstone']);
  });

  it('keeps completions at the retention boundary and prunes older rows', () => {
    const cutoff = 1_000_000;
    const state = makeState({
      completions: [
        { id: 'old', taskId: 'task', periodKey: 'old', done: true, updatedAt: cutoff - 1 },
        { id: 'boundary', taskId: 'task', periodKey: 'boundary', done: true, updatedAt: cutoff },
      ],
    });
    expect(pruneCompletions(state, cutoff).completions.map((completion) => completion.id)).toEqual(['boundary']);
  });

  it('prunes after merge because a stale device can resurrect a row pruned without a tombstone', () => {
    const cutoff = 1_000_000;
    const stale = makeState({
      completions: [{ id: 'stale', taskId: 'task', periodKey: 'old', done: true, updatedAt: cutoff - 1 }],
    });
    const alreadyPruned = pruneCompletions(stale, cutoff);

    expect(mergeState(alreadyPruned, stale).completions.map((completion) => completion.id)).toEqual(['stale']);
    expect(compactState(mergeState(alreadyPruned, stale), 0, cutoff).completions).toEqual([]);
  });

  it('still prunes completions at 120 days now that tombstones are kept for a year', () => {
    const at = Date.now();
    const completion = (id: string, age: number) => ({
      id,
      taskId: 't',
      periodKey: id,
      done: true,
      updatedAt: at - age,
    });
    const state = makeState({
      completions: [
        completion('old', COMPLETION_RETENTION_MS + 1_000),
        completion('recent', COMPLETION_RETENTION_MS - 1_000),
      ],
    });
    expect(compactState(state, at - TOMBSTONE_RETENTION_MS).completions.map((row) => row.id)).toEqual(['recent']);
  });

  it('returns the same state when there is nothing to drop, slim, or prune', () => {
    const state = makeState({ games: [makeGame(), makeGame({ id: 'gone', deleted: true, updatedAt: Date.now() })] });
    expect(compactState(state, Date.now() - TOMBSTONE_RETENTION_MS)).toBe(state);
  });
});

describe('tombstone slimming', () => {
  const DAY = 86_400_000;

  /** One row per slimmed collection, carrying every heavy optional field. */
  function heavyRows(updatedAt: number, deleted = true): AppState {
    const meta = { deleted, updatedAt, hlc: { wall: updatedAt, counter: 0, device: 'phone' }, deviceId: 'phone' };
    return normalizeState(
      makeState({
        games: [
          makeGame({
            ...meta,
            id: 'g-dead',
            presetKey: 'genshin',
            image: 'data:image/png;base64,iVBORw0KGgo=',
            notes: 'old game notes',
            cardLayout: [{ id: 'events' }],
            codes: [{ id: 'code-1', code: 'GIFT2026', addedAt: 1 }],
            processNames: ['GenshinImpact.exe'],
            titleFont: 'Serif',
            accountLabel: 'Main EU',
            server: 'eu',
          }),
        ],
        resources: [makeResource({ ...meta, id: 'r-dead', gameId: 'g-dead', reserveLabel: 'Spare' })],
        tasks: [
          makeTask({
            ...meta,
            id: 't-check',
            gameId: 'g-dead',
            mode: 'check',
            timelineMatch: 'Boss',
            timerStepMinutes: 5,
            timerDurationMinutes: 30,
            timerEndsAt: null,
          }),
          makeTask({
            ...meta,
            id: 't-timer',
            gameId: 'g-dead',
            mode: 'timer',
            timelineMatch: 'Expedition',
            timerDurationMinutes: 45,
            timerEndsAt: null,
          }),
        ],
        completions: [
          {
            ...meta,
            id: 'c-dead',
            taskId: 't-check',
            periodKey: 'p',
            done: true,
            provenance: { kind: 'manual', observedAt: 1, importedAt: 1 },
          },
        ],
        events: [
          makeEvent({
            ...meta,
            id: 'e-dead',
            gameId: 'g-dead',
            notes: 'x'.repeat(5_000),
            reward: 60,
            sourceKey: 'genshin:banner-1',
            seedHash: 'abc123',
          }),
        ],
        reminders: [{ ...meta, id: 'm-dead', gameId: null, message: 'Spend resin before bed', at: 1 }],
        customQuests: [
          {
            ...meta,
            id: 'q-dead',
            gameId: 'g-dead',
            title: 'Archon Quest',
            kind: 'main',
            series: 'Prologue',
            characters: ['Paimon'],
            parts: [{ id: 'p1', title: 'Part 1' }],
            notes: 'quest notes',
          },
        ],
        notes: [{ ...meta, id: 'n-dead', gameId: null, title: 'Pity plan', body: 'y'.repeat(5_000), sort: 0 }],
      }),
    );
  }

  const SLIMMED = [
    'games',
    'resources',
    'tasks',
    'completions',
    'events',
    'reminders',
    'customQuests',
    'notes',
  ] as const;

  it('keeps every required field and the clock, and sheds the payload, after 90 days', () => {
    const at = Date.now();
    const full = heavyRows(at - 100 * DAY);
    const slim = compactState(full, at - TOMBSTONE_RETENTION_MS);

    // The same schema validates v0.6 and v0.7 documents.
    expect(safeParseAppState(slim).success).toBe(true);
    for (const key of [
      'image',
      'notes',
      'cardLayout',
      'codes',
      'processNames',
      'titleFont',
      'accountLabel',
      'server',
    ]) {
      expect(slim.games[0]).not.toHaveProperty(key);
    }
    expect(slim.resources[0]).not.toHaveProperty('reserveLabel');
    expect(slim.completions[0]).not.toHaveProperty('provenance');
    expect(slim.events[0]).not.toHaveProperty('reward');
    expect(slim.events[0]).toMatchObject({ notes: '', sourceKey: 'genshin:banner-1', seedHash: 'abc123' });
    expect(slim.reminders[0]!.message).toBe('');
    expect(slim.notes[0]).toMatchObject({ title: '', body: '' });
    for (const key of ['series', 'characters', 'parts', 'notes']) expect(slim.customQuests[0]).not.toHaveProperty(key);
    const [check, timer] = slim.tasks;
    for (const key of ['timelineMatch', 'timerStepMinutes', 'timerDurationMinutes', 'timerEndsAt']) {
      expect(check).not.toHaveProperty(key);
    }
    // The normalizer infers these for a timer task, so stripping them would only
    // bring them back on the next load and strip them again.
    expect(timer).not.toHaveProperty('timelineMatch');
    expect(timer).toMatchObject({ timerDurationMinutes: 45, timerEndsAt: null });

    // Whatever is kept is kept unchanged, identity and clock included.
    for (const collection of SLIMMED) {
      full[collection].forEach((row, index) => {
        const slimmed = slim[collection][index] as unknown as Record<string, unknown>;
        const original = row as unknown as Record<string, unknown>;
        for (const [key, value] of Object.entries(slimmed)) if (value !== '') expect(value).toEqual(original[key]);
        expect(slimmed).toMatchObject({ id: row.id, deleted: true, updatedAt: row.updatedAt, hlc: row.hlc });
      });
    }
    expect(JSON.stringify(slim).length).toBeLessThan(JSON.stringify(full).length / 4);
  });

  it('writes a slimmed tombstone once: it is a fixed point of loading and compaction', () => {
    const at = Date.now();
    const slim = compactState(heavyRows(at - 100 * DAY), at - TOMBSTONE_RETENTION_MS);
    expect(normalizeState(slim)).toEqual(slim);
    expect(compactState(normalizeState(slim), at - TOMBSTONE_RETENTION_MS)).toEqual(slim);
    expect(compactState(slim, at - TOMBSTONE_RETENTION_MS)).toBe(slim);
    expect(slimTombstones(slim, at)).toBe(slim);
  });

  it('leaves live rows and tombstones younger than 90 days as they are', () => {
    const at = Date.now();
    const fresh = heavyRows(at - 89 * DAY);
    expect(compactState(fresh, at - TOMBSTONE_RETENTION_MS)).toBe(fresh);
    const live = heavyRows(at - 300 * DAY, false);
    expect(slimTombstones(live, at)).toBe(live);
  });

  it('keeps beating every older live copy, so an old backup cannot bring the row back', () => {
    const at = Date.now();
    const slim = compactState(heavyRows(at - 100 * DAY), at - TOMBSTONE_RETENTION_MS);
    const backup = heavyRows(at - 101 * DAY, false);
    const merged = mergeState(slim, backup);
    expect(merged).toEqual(mergeState(backup, slim));
    for (const collection of SLIMMED) {
      expect(merged[collection].map((row) => row.deleted)).toEqual(slim[collection].map(() => true));
    }
    expect(merged.notes[0]!.body).toBe('');
  });

  it('prefers the slimmed copy of one deletion over the full one, on either side', () => {
    const at = Date.now();
    const full = heavyRows(at - 100 * DAY);
    const slim = compactState(full, at - TOMBSTONE_RETENTION_MS);
    // A peer that has not compacted yet must not undo the slimming on every sync.
    expect(mergeState(full, slim)).toEqual(mergeState(slim, slim));
    expect(mergeState(slim, full)).toEqual(mergeState(slim, slim));
    expect(mergeState(full, slim).events[0]!.notes).toBe('');
  });

  it('drops a tombstone only once it is older than 365 days', () => {
    const at = Date.now();
    expect(TOMBSTONE_RETENTION_MS).toBe(365 * DAY);
    expect(TOMBSTONE_SLIM_MS).toBe(90 * DAY);
    const kept = compactState(heavyRows(at - 364 * DAY), at - TOMBSTONE_RETENTION_MS);
    expect(kept.games.map((game) => game.id)).toEqual(['g-dead']);
    expect(kept.notes.map((note) => note.body)).toEqual(['']);
    const dropped = compactState(heavyRows(at - 366 * DAY), at - TOMBSTONE_RETENTION_MS);
    for (const collection of SLIMMED) expect(dropped[collection]).toEqual([]);
  });
});

describe('thinSnapshots', () => {
  /** `resources` resources with `per` hourly readings each, oldest first. */
  function readings(resources: number, per: number, kind?: (index: number) => 'manual' | 'estimate') {
    return Array.from({ length: resources * per }, (_, i) => {
      const resource = Math.floor(i / per);
      const index = i % per;
      return makeSnapshot({
        id: `r${resource}-s${index}`,
        resourceId: `r${resource}`,
        value: index,
        takenAt: 1_000_000 + index * 3_600_000,
        ...(kind ? { provenance: { kind: kind(index), observedAt: 1, importedAt: 1 } } : {}),
      });
    });
  }

  it('returns the same list when it fits', () => {
    const list = readings(2, 3);
    expect(thinSnapshots(list)).toBe(list);
  });

  it('thins 120 resources at full retention evenly, keeping every newest reading', () => {
    const log = readings(120, 200);
    const thinned = thinSnapshots(log);
    expect(thinned).toHaveLength(APP_STATE_COLLECTION_LIMITS.snapshots);
    const counts = [...groupBy(thinned, (s) => s.resourceId).values()].map((list) => list.length);
    expect(counts).toHaveLength(120);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
    for (let r = 0; r < 120; r++) expect(thinned.some((s) => s.id === `r${r}-s199`)).toBe(true);
    // Oldest go first.
    expect(thinned.some((s) => s.id === 'r0-s0')).toBe(false);
  });

  it('keeps the latest real reading even when newer estimates crowd it out', () => {
    // Resource r0 has one real reading, its oldest; everything after it is an estimate.
    const log = [...readings(1, 200, (i) => (i === 0 ? 'manual' : 'estimate')), ...readings(120, 200).slice(200)];
    const thinned = thinSnapshots(log);
    expect(thinned).toHaveLength(APP_STATE_COLLECTION_LIMITS.snapshots);
    expect(thinned.some((s) => s.id === 'r0-s0')).toBe(true);
    expect(thinned.some((s) => s.id === 'r0-s199')).toBe(true);
    expect(latestSnapshots(thinned)).toEqual(latestSnapshots(log));
  });

  it('lets one overloaded device merge instead of pausing sync, before the capacity check', () => {
    const device = makeState({ snapshots: readings(120, 200) });
    expect(() => assertStateCapacity(device)).toThrow('combined snapshots exceed');
    const merged = mergeState(device, makeState());
    expect(merged.snapshots).toHaveLength(APP_STATE_COLLECTION_LIMITS.snapshots);
    expect(safeParseAppState(merged).success).toBe(true);
    const latestIds = (snapshots: Snapshot[]) => [...latestSnapshots(snapshots)].map(([key, s]) => [key, s.id]);
    expect(latestIds(merged.snapshots).sort()).toEqual(latestIds(device.snapshots).sort());
  });

  it('thins a merged union the same way in either order, and a stale side changes nothing', () => {
    const log = readings(120, 200);
    const phone = makeState({ snapshots: log.filter((_, i) => i % 2 === 0) });
    const pc = makeState({ snapshots: log.filter((_, i) => i % 2 === 1) });
    const merged = mergeState(phone, pc);
    expect(merged.snapshots).toHaveLength(APP_STATE_COLLECTION_LIMITS.snapshots);
    expect(merged).toEqual(mergeState(pc, phone));
    expect(mergeState(merged, merged)).toEqual(merged);
    expect(mergeState(merged, phone)).toEqual(merged);
    expect(mergeState(pc, merged)).toEqual(merged);
  });

  it('still refuses other collections over capacity', () => {
    const state = makeState({
      games: Array.from({ length: 101 }, (_, i) => makeGame({ id: `g${i}` })),
      snapshots: readings(120, 200),
    });
    expect(() => mergeState(state, makeState())).toThrow('combined games exceed the 100 item limit');
  });
});

describe('normalizeState clamps out-of-range game fields', () => {
  // The offline path (IndexedDB load, JSON import, the launcher's user-editable
  // state.json) never ran zod — normalizeState was the only gate and it gated
  // nothing. These are the values that actually broke scheduling.
  it('pulls reset fields back into their documented ranges', () => {
    const state = makeState({
      games: [makeGame({ id: 'g1', dailyResetHour: 25, weeklyResetDay: 0, monthlyResetDay: 31 })],
      resources: [makeResource({ id: 'r1', gameId: 'g1' })],
      tasks: [makeTask({ id: 't1', gameId: 'g1' })],
      events: [makeEvent({ id: 'e1', gameId: 'g1' })],
    });

    const normalized = normalizeState(state);
    const game = normalized.games[0]!;

    expect(game.dailyResetHour).toBe(23);
    expect(game.weeklyResetDay).toBe(1);
    // 31 used to make monthlyPeriodKey require `day >= 31` while the reset
    // timestamp clamped to 28, so monthly tasks silently stopped resetting.
    expect(game.monthlyResetDay).toBe(28);
    expect(normalized.resources).toHaveLength(1);
    expect(normalized.tasks).toHaveLength(1);
    expect(normalized.events).toHaveLength(1);
    expect(safeParseAppState(normalized).success).toBe(true);
  });

  it('substitutes a sane default for values that are not numbers at all', () => {
    const state = makeState({
      games: [
        makeGame({
          id: 'g1',
          dailyResetHour: Number.NaN,
          weeklyResetDay: 'monday' as unknown as number,
          monthlyResetDay: undefined as unknown as number,
        }),
      ],
    });

    const game = normalizeState(state).games[0]!;

    expect(game.dailyResetHour).toBe(4);
    expect(game.weeklyResetDay).toBe(1);
    expect(game.monthlyResetDay).toBe(1);
  });

  it('clamps rather than dropping the game, so its resources keep their owner', () => {
    // A game row carries the user's resources, tasks and history by id. Dropping
    // it because one number is out of range would orphan all of that.
    const state = makeState({ games: [makeGame({ id: 'keep-me', monthlyResetDay: 99 })] });

    const games = normalizeState(state).games;

    expect(games).toHaveLength(1);
    expect(games[0]!.id).toBe('keep-me');
  });
});
