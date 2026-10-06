import { describe, expect, it } from 'vitest';
import {
  mapHoYoNotes,
  parseScreenshotReadings,
  extractScreenshotRatios,
  planGameImport,
  PRESETS,
  type HoYoProvider,
} from '../src';
import { makeGame, makeResource, makeState, makeTask, utc } from './helpers';

const observedAt = utc('2026-10-06T12:00:00Z');
function stateFor(provider: HoYoProvider | 'wuwa') {
  const names = { genshin: 'Original Resin', hsr: 'Trailblaze Power', zzz: 'Battery Charge', wuwa: 'Waveplates' };
  const caps = { genshin: 200, hsr: 300, zzz: 240, wuwa: 240 };
  const keys = {
    genshin: 'genshin-commissions',
    hsr: 'hsr-daily-training',
    zzz: 'zzz-engagement',
    wuwa: 'wuwa-daily-activity',
  };
  return makeState({
    games: [makeGame({ presetKey: provider })],
    resources: [
      makeResource({ name: names[provider], cap: caps[provider], reserveCap: provider === 'genshin' ? 0 : 2400 }),
    ],
    tasks: [makeTask({ presetTaskKey: keys[provider] })],
  });
}

describe('HoYoLAB observation mapping', () => {
  it.each([
    ['genshin', { current_resin: 123, finished_task_num: 4, total_task_num: 4, is_extra_task_reward_received: true }],
    ['hsr', { current_stamina: 123, current_train_score: 500, max_train_score: 500 }],
    ['zzz', { energy: { progress: { current: 123 } }, vitality: { current: 400, max: 400 } }],
  ] as const)('maps a legacy %s game and its unkeyed preset task', (provider, data) => {
    const state = stateFor(provider);
    const preset = PRESETS.find((item) => item.key === provider)!;
    state.games[0] = { ...state.games[0]!, presetKey: undefined, name: preset.name, short: preset.short };
    const task = preset.tasks.find((item) => item.key === state.tasks[0]!.presetTaskKey)!;
    state.tasks[0] = { ...state.tasks[0]!, presetTaskKey: undefined, name: task.name };
    const batch = mapHoYoNotes(state, 'g1', { provider, uid: '700000001', observedAt, data });
    expect(batch.resources).toEqual([{ resourceId: 'r1', value: 123 }]);
    expect(batch.tasks).toEqual([{ taskId: 't1', done: true }]);
  });

  it('preserves ambiguous, renamed, and differently keyed legacy tasks', () => {
    const state = stateFor('hsr');
    const preset = PRESETS.find((item) => item.key === 'hsr')!;
    const task = preset.tasks.find((item) => item.key === 'hsr-daily-training')!;
    const observation = {
      provider: 'hsr' as const,
      uid: '700000001',
      observedAt,
      data: { current_train_score: 500, max_train_score: 500 },
    };
    state.tasks = [makeTask({ name: task.name }), makeTask({ id: 'duplicate', name: task.name })];
    expect(mapHoYoNotes(state, 'g1', observation).tasks).toEqual([]);
    state.tasks = [makeTask({ name: 'My custom routine' })];
    expect(mapHoYoNotes(state, 'g1', observation).tasks).toEqual([]);
    state.tasks = [makeTask({ name: task.name, presetTaskKey: 'some-other-task' })];
    expect(mapHoYoNotes(state, 'g1', observation).tasks).toEqual([]);
    state.tasks = [makeTask({ name: task.name }), makeTask({ id: 'keyed', presetTaskKey: task.key })];
    expect(mapHoYoNotes(state, 'g1', observation).tasks).toEqual([]);
  });

  it('maps Genshin resin and reward-confirmed commissions using API fields', () => {
    const state = stateFor('genshin');
    state.resources.push(makeResource({ id: 'realm', name: 'Realm Currency', cap: 2400 }));
    const batch = mapHoYoNotes(state, 'g1', {
      provider: 'genshin',
      uid: '700000001',
      observedAt,
      data: {
        current_resin: 123,
        current_home_coin: 900,
        finished_task_num: 4,
        total_task_num: 4,
        is_extra_task_reward_received: true,
      },
    });
    expect(batch.resources).toEqual([
      { resourceId: 'r1', value: 123 },
      { resourceId: 'realm', value: 900 },
    ]);
    expect(batch.tasks).toEqual([{ taskId: 't1', done: true }]);
    expect(planGameImport(state, batch, observedAt).issues).toEqual([]);
  });

  it('does not assume the commission reward is claimed from four finished commissions', () => {
    const state = stateFor('genshin');
    const observation = {
      provider: 'genshin' as const,
      uid: '700000001',
      observedAt,
      data: { finished_task_num: 4, total_task_num: 4 },
    };
    expect(mapHoYoNotes(state, 'g1', observation).tasks).toEqual([]);
    expect(
      mapHoYoNotes(state, 'g1', { ...observation, data: { ...observation.data, is_extra_task_reward_received: false } })
        .tasks,
    ).toEqual([{ taskId: 't1', done: false }]);
  });

  it('accepts documented nested Genshin daily tasks without guessing unrelated fields', () => {
    const batch = mapHoYoNotes(stateFor('genshin'), 'g1', {
      provider: 'genshin',
      uid: '700000001',
      observedAt,
      data: { daily_task: { finished_num: 4, total_num: 4, is_extra_task_reward_received: true }, current_resin: 0 },
    });
    expect(batch.resources).toEqual([{ resourceId: 'r1', value: 0 }]);
    expect(batch.tasks).toEqual([{ taskId: 't1', done: true }]);
  });

  it('maps Star Rail power, reserve and training', () => {
    const batch = mapHoYoNotes(stateFor('hsr'), 'g1', {
      provider: 'hsr',
      uid: '700000001',
      observedAt,
      data: { current_stamina: 201, current_reserve_stamina: 801, current_train_score: 500, max_train_score: 500 },
    });
    expect(batch.resources).toEqual([{ resourceId: 'r1', value: 201, reserve: 801 }]);
    expect(batch.tasks).toEqual([{ taskId: 't1', done: true }]);
  });

  it('maps ZZZ energy.progress and vitality without inventing a backup reading', () => {
    const batch = mapHoYoNotes(stateFor('zzz'), 'g1', {
      provider: 'zzz',
      uid: '100000001',
      observedAt,
      data: { energy: { progress: { current: 101, max: 240 } }, vitality: { current: 300, max: 400 } },
    });
    expect(batch.resources).toEqual([{ resourceId: 'r1', value: 101 }]);
    expect(batch.tasks).toEqual([{ taskId: 't1', done: false }]);
  });

  it('ignores missing, negative, string and invalid fields instead of coercing them to zero', () => {
    const batch = mapHoYoNotes(stateFor('hsr'), 'g1', {
      provider: 'hsr',
      uid: '700000001',
      observedAt,
      data: { current_stamina: '50', current_reserve_stamina: -2, current_train_score: 0, max_train_score: 0 },
    });
    expect(batch.resources).toEqual([]);
    expect(batch.tasks).toEqual([]);
  });

  it('scopes providers to the selected preset and stable task keys', () => {
    const state = stateFor('hsr');
    const observation = { provider: 'genshin' as const, uid: '700000001', observedAt, data: { current_resin: 99 } };
    expect(mapHoYoNotes(state, 'g1', observation).resources).toEqual([]);
    state.tasks[0]!.presetTaskKey = undefined;
    expect(
      mapHoYoNotes(state, 'g1', {
        ...observation,
        provider: 'hsr',
        data: { current_train_score: 500, max_train_score: 500 },
      }).tasks,
    ).toEqual([]);
  });

  it('does not route ambiguous resources or duplicate preset tasks', () => {
    const state = stateFor('hsr');
    state.resources.push({ ...state.resources[0]!, id: 'duplicate' });
    state.tasks.push({ ...state.tasks[0]!, id: 'duplicate-task' });
    const batch = mapHoYoNotes(state, 'g1', {
      provider: 'hsr',
      uid: '700000001',
      observedAt,
      data: { current_stamina: 123, current_train_score: 500, max_train_score: 500 },
    });
    expect(batch.resources).toEqual([]);
    expect(batch.tasks).toEqual([]);
  });

  it('gives the same evidence a stable ID and keeps raw account identifiers out of provenance', () => {
    const observation = { provider: 'hsr' as const, uid: '700000001', observedAt, data: { current_stamina: 123 } };
    const first = mapHoYoNotes(stateFor('hsr'), 'g1', observation);
    expect(mapHoYoNotes(stateFor('hsr'), 'g1', observation).id).toBe(first.id);
    expect(JSON.stringify(first)).not.toContain(observation.uid);
    expect(mapHoYoNotes(stateFor('hsr'), 'g1', { ...observation, uid: '700000002' }).id).not.toBe(first.id);
  });
});

describe('screenshot text suggestions', () => {
  it('recognizes an exact custom resource label without guessing a game', () => {
    const state = stateFor('wuwa');
    state.resources[0]!.name = 'Training Points';
    expect(parseScreenshotReadings(state, 'g1', 'Training Points: 123/240', observedAt).resources).toEqual([
      { resourceId: 'r1', value: 123, confidence: 0.85 },
    ]);
    state.resources.push({ ...state.resources[0]!, id: 'duplicate' });
    expect(parseScreenshotReadings(state, 'g1', 'Training Points: 123/240', observedAt).resources).toEqual([]);
  });
  it('extracts bare ratios only as unassigned review candidates', () => {
    expect(extractScreenshotRatios('120 / 240\n3/5\n120/240')).toEqual([
      { value: 120, cap: 240 },
      { value: 3, cap: 5 },
    ]);
    expect(extractScreenshotRatios('-5/100 1.5/200 1O/200 100/0 3/2147483648')).toEqual([]);
  });
  it('reads a labeled resource ratio and always requests review', () => {
    const state = stateFor('wuwa');
    const batch = parseScreenshotReadings(state, 'g1', 'Waveplates\n123 / 240', observedAt);
    expect(batch.resources).toEqual([{ resourceId: 'r1', value: 123, confidence: 0.85 }]);
    expect(planGameImport(state, batch, observedAt).issues[0]?.reason).toBe('needs-review');
  });

  it('does not guess what a bare ratio, number or unrelated text means', () => {
    const state = stateFor('genshin');
    for (const text of ['123 / 200', '123', 'Primogems: 123', 'Energy 123 / 200']) {
      expect(parseScreenshotReadings(state, 'g1', text, observedAt).resources).toEqual([]);
    }
  });

  it('keeps reserve labels separate from the primary power reading', () => {
    const state = stateFor('hsr');
    expect(parseScreenshotReadings(state, 'g1', 'Reserve Trailblaze Power: 123', observedAt).resources).toEqual([]);
    expect(
      parseScreenshotReadings(
        state,
        'g1',
        'Trailblaze Power: 201/300\nReserve Trailblaze Power: 1,234/2,400',
        observedAt,
      ).resources,
    ).toEqual([{ resourceId: 'r1', value: 201, reserve: 1234, confidence: 0.85 }]);
  });

  it('rejects conflicting values, wrong caps, negative and decimal readings', () => {
    const state = stateFor('genshin');
    for (const text of [
      'Original Resin 12/200\nOriginal Resin 45/200',
      'Original Resin 123/240',
      'Original Resin: -5',
      'Original Resin: 19.5',
    ]) {
      expect(parseScreenshotReadings(state, 'g1', text, observedAt).resources).toEqual([]);
    }
  });

  it('ignores screenshots for deleted or missing accounts and oversized text', () => {
    const state = stateFor('genshin');
    state.games[0]!.deleted = true;
    expect(parseScreenshotReadings(state, 'g1', 'Original Resin 123/200', observedAt).resources).toEqual([]);
    expect(
      parseScreenshotReadings(stateFor('genshin'), 'g1', `Original Resin 123/200\n${'x'.repeat(50_000)}`, observedAt)
        .resources,
    ).toEqual([]);
  });
});
