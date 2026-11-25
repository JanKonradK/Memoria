import { describe, expect, it } from 'vitest';
import {
  applyConnectorObservation,
  hoyolabErrorGuidance,
  hoyolabServerFor,
  mapGenshinDailyNote,
  mapHoyolabNote,
  mapHsrDailyNote,
  mapZzzDailyNote,
  windowMatches,
} from '../src/connectors';
import type { ConnectorObservation } from '../src/connectors';
import { completionId } from '../src/checklist';
import { projectEnergy } from '../src/energy';
import { taskPeriodKey } from '../src/periods';
import { makeEvent, makeGame, makeResource, makeSnapshot, makeState, makeTask, utc } from './helpers';

const AT = utc('2026-11-21T12:00:00');

describe('mapGenshinDailyNote', () => {
  const raw = {
    current_resin: 120,
    max_resin: 200,
    resin_recovery_time: '38400',
    current_home_coin: 1800,
    max_home_coin: '2400',
    home_coin_recovery_time: '7200',
    finished_task_num: 4,
    total_task_num: 4,
    is_extra_task_reward_received: false,
    resin_discount_num_limit: 3,
    remain_resin_discount_num: 1,
    expeditions: [{ remained_time: '3600' }, { remained_time: '14280' }, { remained_time: 'x' }],
    transformer: { obtained: true, recovery_time: { Day: 2, Hour: 3, Minute: 0, Second: 0, reached: false } },
  };

  it('maps resin, realm currency and tasks, reading numeric strings', () => {
    const obs = mapGenshinDailyNote(raw, AT);
    expect(obs.provider).toBe('hoyolab');
    expect(obs.energies).toEqual([
      { primary: true, resourceName: 'Original Resin', value: 120, cap: 200, recoverySeconds: 38400 },
      { resourceName: 'Realm Currency', value: 1800, cap: 2400, recoverySeconds: 7200 },
    ]);
    const byKey = Object.fromEntries(obs.tasks.map((t) => [t.presetTaskKey, t]));
    expect(byKey['genshin-commissions']).toEqual({ presetTaskKey: 'genshin-commissions', done: true });
    // The API reports discounts LEFT: 3 − 1 = 2 bosses done.
    expect(byKey['genshin-weekly-bosses']?.countDone).toBe(2);
    expect(byKey['genshin-expeditions']).toEqual({
      presetTaskKey: 'genshin-expeditions',
      timerEndsAt: AT + 14280_000,
      done: true,
    });
    expect(byKey['genshin-parametric']).toEqual({
      presetTaskKey: 'genshin-parametric',
      timerEndsAt: AT + (2 * 86400 + 3 * 3600) * 1000,
      done: true,
    });
    expect(obs.summary[0]).toBe('Original Resin 120/200');
  });

  it('treats all-back expeditions and a ready transformer as ready, not done', () => {
    const obs = mapGenshinDailyNote(
      {
        expeditions: [{ remained_time: '0' }],
        transformer: { obtained: true, recovery_time: { Day: 0, Hour: 0, Minute: 0, Second: 0, reached: true } },
      },
      AT,
    );
    expect(obs.tasks).toEqual([
      { presetTaskKey: 'genshin-expeditions', timerEndsAt: AT, done: false },
      { presetTaskKey: 'genshin-parametric', timerEndsAt: AT, done: false },
    ]);
  });

  it('ignores negative, NaN and missing fields', () => {
    const obs = mapGenshinDailyNote({ current_resin: -5, max_resin: 'abc', transformer: { obtained: false } }, AT);
    expect(obs.energies).toEqual([]);
    expect(obs.tasks).toEqual([]);
    expect(mapGenshinDailyNote(null, AT).energies).toEqual([]);
  });

  it('marks commissions done by the extra reward even when the count disagrees', () => {
    const obs = mapGenshinDailyNote(
      { finished_task_num: 2, total_task_num: 4, is_extra_task_reward_received: true },
      AT,
    );
    expect(obs.tasks[0]).toEqual({ presetTaskKey: 'genshin-commissions', done: true });
  });
});

describe('mapHsrDailyNote', () => {
  it('maps stamina with reserve and the remaining-claims Echo of War count', () => {
    const obs = mapHsrDailyNote(
      {
        current_stamina: 180,
        max_stamina: 240,
        stamina_recover_time: 21600,
        current_reserve_stamina: 1500,
        current_train_score: 500,
        max_train_score: 500,
        current_rogue_score: 4000,
        max_rogue_score: 14000,
        weekly_cocoon_cnt: 1,
        weekly_cocoon_limit: 3,
        expeditions: [{ remaining_time: 600 }, { remained_time: 1200 }],
      },
      AT,
    );
    expect(obs.energies[0]).toEqual({
      primary: true,
      resourceName: 'Trailblaze Power',
      value: 180,
      cap: 240,
      reserve: 1500,
      recoverySeconds: 21600,
    });
    expect(obs.tasks).toEqual([
      { presetTaskKey: 'hsr-daily-training', done: true },
      { presetTaskKey: 'hsr-universe', done: false },
      { presetTaskKey: 'hsr-echo-of-war', countDone: 2 },
      { presetTaskKey: 'hsr-assignments', timerEndsAt: AT + 1_200_000, done: true },
    ]);
  });
});

describe('mapZzzDailyNote', () => {
  it('maps battery and finishes Ridu at 800 points', () => {
    const obs = mapHoyolabNote(
      'zzz',
      {
        energy: { progress: { current: 100, max: 240 }, restore: 50400 },
        vitality: { current: 400, max: 400 },
        weekly_task: { cur_point: 900, max_point: 2100 },
        bounty_commission: { num: 2, total: 4 },
      },
      AT,
    );
    expect(obs.energies[0]).toEqual({
      primary: true,
      resourceName: 'Battery Charge',
      value: 100,
      cap: 240,
      recoverySeconds: 50400,
    });
    expect(obs.tasks).toEqual([
      { presetTaskKey: 'zzz-engagement', done: true },
      { presetTaskKey: 'zzz-ridu', done: true },
      { presetTaskKey: 'zzz-hollow-zero', done: false },
    ]);
  });

  it('skips bounty commissions with no total', () => {
    const obs = mapZzzDailyNote({ bounty_commission: { num: 0, total: 0 }, weekly_task: { cur_point: 500 } }, AT);
    expect(obs.tasks).toEqual([{ presetTaskKey: 'zzz-ridu', done: false }]);
  });
});

describe('hoyolabServerFor', () => {
  it('maps Memoria server ids', () => {
    expect(hoyolabServerFor('genshin', 'eu')).toBe('os_euro');
    expect(hoyolabServerFor('hsr', 'tw')).toBe('prod_official_cht');
    expect(hoyolabServerFor('zzz', 'asia')).toBe('prod_gf_jp');
    expect(hoyolabServerFor('genshin', 'cn')).toBeUndefined();
  });

  it('prefers the UID prefix', () => {
    expect(hoyolabServerFor('genshin', 'eu', '612345678')).toBe('os_usa');
    expect(hoyolabServerFor('genshin', undefined, '1812345678')).toBe('os_asia');
    expect(hoyolabServerFor('hsr', undefined, '700000001')).toBe('prod_official_eur');
    expect(hoyolabServerFor('hsr', undefined, '900000001')).toBe('prod_official_cht');
    expect(hoyolabServerFor('zzz', undefined, '1500012345')).toBe('prod_gf_eu');
    expect(hoyolabServerFor('zzz', undefined, '1700012345')).toBe('prod_gf_sg');
    expect(hoyolabServerFor('zzz', 'na', '999')).toBe('prod_gf_us');
  });
});

describe('hoyolabErrorGuidance', () => {
  it('classifies known retcodes', () => {
    expect(hoyolabErrorGuidance(0).kind).toBe('ok');
    expect(hoyolabErrorGuidance(10102).kind).toBe('notes-off');
    expect(hoyolabErrorGuidance(1034).kind).toBe('captcha');
    expect(hoyolabErrorGuidance(-100).kind).toBe('auth');
    expect(hoyolabErrorGuidance(10001).kind).toBe('auth');
    expect(hoyolabErrorGuidance(10101).kind).toBe('rate-limit');
    const other = hoyolabErrorGuidance(-1);
    expect(other.kind).toBe('error');
    expect(other.message).toContain('-1');
  });
});

describe('applyConnectorObservation', () => {
  const game = makeGame({ id: 'g1', presetKey: 'genshin' });
  const resin = makeResource({ id: 'resin', name: 'Original Resin', cap: 200, regenMinutes: 8, kind: 'regen' });
  const realm = makeResource({
    id: 'realm',
    name: 'Realm Currency',
    cap: 2400,
    regenMinutes: 2,
    kind: 'regen',
    sort: 2,
  });
  const commissions = makeTask({ id: 'comm', presetTaskKey: 'genshin-commissions', mode: 'check' });
  const bosses = makeTask({
    id: 'boss',
    presetTaskKey: 'genshin-weekly-bosses',
    cadence: 'weekly',
    mode: 'count',
    countTarget: 3,
  });
  const expeditions = makeTask({
    id: 'exp',
    presetTaskKey: 'genshin-expeditions',
    mode: 'timer',
    timerEndsAt: null,
  });
  const base = makeState({ games: [game], resources: [resin, realm], tasks: [commissions, bosses, expeditions] });
  let n = 0;
  const makeId = () => `id${++n}`;

  const obs = (over: Partial<ConnectorObservation> = {}): ConnectorObservation => ({
    presetKey: 'genshin',
    observedAt: AT,
    provider: 'hoyolab',
    energies: [],
    tasks: [],
    summary: [],
    ...over,
  });

  it('does nothing for a missing or deleted game', () => {
    const result = applyConnectorObservation(base, 'nope', obs(), AT, 'b1', makeId);
    expect(result).toEqual({ state: base, applied: 0 });
    const deleted = makeState({ ...base, games: [{ ...game, deleted: true }] });
    expect(applyConnectorObservation(deleted, 'g1', obs(), AT, 'b1', makeId).applied).toBe(0);
  });

  it('writes a backdated snapshot that keeps the game regen phase', () => {
    // 120/200 with 38,280 s to full: 80 points × 480 s = 38,400 s, so 120 s into the current point.
    const result = applyConnectorObservation(
      base,
      'g1',
      obs({ energies: [{ primary: true, value: 120, cap: 200, recoverySeconds: 38_280 }] }),
      AT + 5,
      'batch',
      makeId,
    );
    expect(result.applied).toBe(1);
    const snap = result.state.snapshots.find((s) => s.resourceId === 'resin')!;
    expect(snap.value).toBe(120);
    expect(snap.takenAt).toBe(AT - 120_000);
    expect(snap.provenance).toEqual({
      kind: 'account',
      provider: 'hoyolab',
      observedAt: AT,
      importedAt: AT + 5,
      batchId: 'batch',
    });
    const projected = projectEnergy(resin, snap, AT);
    expect(projected.fullAt).toBe(AT + 38_280_000);
  });

  it('updates a changed cap, clamps the value and matches by name', () => {
    const result = applyConnectorObservation(
      base,
      'g1',
      obs({ energies: [{ resourceName: 'realm currency', value: 3000, cap: 2800 }] }),
      AT,
      'b',
      makeId,
    );
    const res = result.state.resources.find((r) => r.id === 'realm')!;
    expect(res.cap).toBe(2800);
    expect(res.updatedAt).toBe(AT);
    expect(result.state.snapshots.at(-1)).toMatchObject({ resourceId: 'realm', value: 2800, takenAt: AT });
  });

  it('never lands on or before an existing real reading', () => {
    const state = makeState({
      ...base,
      snapshots: [makeSnapshot({ id: 'manual', resourceId: 'resin', value: 50, takenAt: AT })],
    });
    const result = applyConnectorObservation(
      state,
      'g1',
      obs({ energies: [{ primary: true, value: 120, cap: 200, recoverySeconds: 38_280 }] }),
      AT,
      'b',
      makeId,
    );
    expect(result.state.snapshots.at(-1)!.takenAt).toBe(AT + 1);
  });

  it('ticks check tasks, raises counts and sets dispatch timers', () => {
    const result = applyConnectorObservation(
      base,
      'g1',
      obs({
        tasks: [
          { presetTaskKey: 'genshin-commissions', done: true },
          { presetTaskKey: 'genshin-weekly-bosses', countDone: 2 },
          { presetTaskKey: 'genshin-expeditions', timerEndsAt: AT + 3_600_000, done: true },
          { presetTaskKey: 'genshin-unknown', done: true },
        ],
      }),
      AT,
      'b',
      makeId,
    );
    expect(result.applied).toBe(3);
    const row = (task: typeof commissions) =>
      result.state.completions.find((c) => c.id === completionId(task.id, taskPeriodKey(game, task, AT)));
    expect(row(commissions)).toMatchObject({ done: true, provenance: { kind: 'account' } });
    expect(row(bosses)).toMatchObject({ countDone: 2, done: false });
    expect(row(expeditions)).toMatchObject({ done: true });
    expect(result.state.tasks.find((t) => t.id === 'exp')!.timerEndsAt).toBe(AT + 3_600_000);
  });

  it('never un-ticks or lowers what the player recorded', () => {
    const commPeriod = taskPeriodKey(game, commissions, AT);
    const bossPeriod = taskPeriodKey(game, bosses, AT);
    const state = makeState({
      ...base,
      completions: [
        { id: completionId('comm', commPeriod), taskId: 'comm', periodKey: commPeriod, done: true, updatedAt: 1 },
        {
          id: completionId('boss', bossPeriod),
          taskId: 'boss',
          periodKey: bossPeriod,
          done: true,
          countDone: 3,
          updatedAt: 1,
        },
      ],
    });
    const result = applyConnectorObservation(
      state,
      'g1',
      obs({
        tasks: [
          { presetTaskKey: 'genshin-commissions', done: false },
          { presetTaskKey: 'genshin-weekly-bosses', countDone: 1 },
        ],
      }),
      AT,
      'b',
      makeId,
    );
    expect(result.applied).toBe(0);
    expect(result.state).toBe(state);
  });

  it('does not write an empty count row', () => {
    const result = applyConnectorObservation(
      base,
      'g1',
      obs({ tasks: [{ presetTaskKey: 'genshin-weekly-bosses', countDone: 0 }] }),
      AT,
      'b',
      makeId,
    );
    expect(result.applied).toBe(0);
    expect(result.state.completions).toEqual([]);
  });
});

describe('dailies from nested and fallback fields', () => {
  it('reads nested Genshin daily_task counts', () => {
    const obs = mapGenshinDailyNote({ daily_task: { finished_num: 4, total_num: 4 } }, AT);
    expect(obs.tasks).toEqual([{ presetTaskKey: 'genshin-commissions', done: true }]);
    expect(obs.summary).toEqual(['Commissions 4/4 (done)']);
    expect(mapGenshinDailyNote({ daily_task: { finished_num: 1, total_num: 4 } }, AT).tasks[0]?.done).toBe(false);
    expect(
      mapGenshinDailyNote({ daily_task: { finished_num: 1, total_num: 4, is_extra_task_reward_received: true } }, AT)
        .tasks[0]?.done,
    ).toBe(true);
  });

  it('marks commissions done once four Encounter Point rewards are claimed', () => {
    const taken = { status: 'AttendanceRewardStatusTakenAward' };
    const waiting = { status: 'AttendanceRewardStatusUnfinished' };
    const done = mapGenshinDailyNote(
      { daily_task: { finished_num: 0, total_num: 4, attendance_rewards: [taken, taken, taken, taken] } },
      AT,
    );
    expect(done.tasks[0]).toEqual({ presetTaskKey: 'genshin-commissions', done: true });
    expect(done.summary).toEqual(['Commissions 0/4, Encounter Points 4/4 (done)']);
    const partly = mapGenshinDailyNote({ daily_task: { attendance_rewards: [taken, taken, waiting, null] } }, AT);
    expect(partly.tasks[0]?.done).toBe(false);
  });

  it('reads ZZZ bounty commissions from hollow_zero and the battery reserve', () => {
    const obs = mapZzzDailyNote(
      {
        energy: { progress: { current: 100, max: 240 }, restore: 600, current_backup: 30 },
        hollow_zero: { bounty_commission: { num: 4, total: 4 } },
      },
      AT,
    );
    expect(obs.energies[0]).toEqual({
      primary: true,
      resourceName: 'Battery Charge',
      value: 100,
      cap: 240,
      reserve: 30,
      recoverySeconds: 600,
    });
    expect(obs.tasks).toEqual([{ presetTaskKey: 'zzz-hollow-zero', done: true }]);
    expect(
      mapZzzDailyNote({ energy: { progress: { current: 5, max: 240 } }, current_backup: '12' }, AT).energies[0]
        ?.reserve,
    ).toBe(12);
  });

  it('attaches no events when there is no endgame data', () => {
    expect(mapGenshinDailyNote({ current_resin: 1, max_resin: 200 }, AT).events).toBeUndefined();
  });
});

describe('windowMatches', () => {
  const sec = (ms: number) => Math.floor(ms / 1000);
  it('covers the reading and one day after the end', () => {
    expect(windowMatches(sec(AT) - 100, sec(AT) + 100, AT)).toBe(true);
    expect(windowMatches(sec(AT) - 200_000, sec(AT) - 3_600, AT)).toBe(true);
    expect(windowMatches(sec(AT) - 200_000, sec(AT) - 90_000, AT)).toBe(false);
    expect(windowMatches(sec(AT) + 10, sec(AT) + 100, AT)).toBe(false);
  });
  it('trusts missing or zero windows', () => {
    expect(windowMatches(undefined, undefined, AT)).toBe(true);
    expect(windowMatches('0', '0', AT)).toBe(true);
  });
});

describe('endgame cycles', () => {
  const start = String(Math.floor(AT / 1000) - 86_400);
  const end = String(Math.floor(AT / 1000) + 86_400);
  const schedule = { start_time: start, end_time: end };

  it('maps Genshin Abyss, Theater and Stygian', () => {
    const obs = mapGenshinDailyNote(
      {
        _endgame: {
          spiralAbyss: { is_unlock: true, start_time: start, end_time: end, total_star: 36 },
          roleCombat: {
            data: [
              { has_data: true, schedule: { start_time: '1', end_time: '2' }, stat: { max_round_id: 10 } },
              { has_data: true, schedule, stat: { max_round_id: 7 } },
            ],
          },
          hardChallenge: {
            data: [
              {
                schedule,
                single: { has_data: true, best: { difficulty: 2 } },
                mp: { has_data: true, best: { difficulty: 4 } },
              },
            ],
          },
        },
      },
      AT,
    );
    expect(obs.events).toEqual([
      { eventName: 'Spiral Abyss', progress: 'done', detail: 'Spiral Abyss 36/36★' },
      { eventName: 'Imaginarium Theater', progress: 'partial', detail: 'Imaginarium Theater Act 7' },
      { eventName: 'Stygian Onslaught', progress: 'done', detail: 'Stygian Onslaught' },
    ]);
    expect(obs.summary).toEqual(['Spiral Abyss 36/36★', 'Imaginarium Theater Act 7', 'Stygian Onslaught']);
  });

  it('skips locked, stale or empty Genshin records', () => {
    const obs = mapGenshinDailyNote(
      {
        _endgame: {
          spiralAbyss: { is_unlock: true, start_time: '100', end_time: '200', total_star: 36 },
          roleCombat: { data: [{ has_data: false, schedule, stat: { max_round_id: 8 } }] },
          hardChallenge: { data: [{ schedule, single: { has_data: false, best: { difficulty: 5 } } }] },
        },
      },
      AT,
    );
    expect(obs.events).toBeUndefined();
    expect(
      mapGenshinDailyNote({ _endgame: { spiralAbyss: { is_unlock: false, total_star: 12 } } }, AT).events,
    ).toBeUndefined();
    expect(mapGenshinDailyNote({ _endgame: { spiralAbyss: { is_unlock: true, total_star: 12 } } }, AT).events).toEqual([
      { eventName: 'Spiral Abyss', progress: 'partial', detail: 'Spiral Abyss 12/36★' },
    ]);
  });

  it('maps HSR MoC, Pure Fiction and Apocalyptic Shadow', () => {
    const obs = mapHsrDailyNote(
      {
        _endgame: {
          moc: { has_data: true, star_num: 30 },
          pf: { has_data: true, star_num: 12 },
          as: { has_data: false, star_num: 12 },
        },
      },
      AT,
    );
    expect(obs.events).toEqual([
      { eventName: 'Memory of Chaos', progress: 'partial', detail: 'Memory of Chaos 30/36★' },
      { eventName: 'Pure Fiction', progress: 'done', detail: 'Pure Fiction 12/12★' },
    ]);
    expect(mapHsrDailyNote({ _endgame: { as: { has_data: true, star_num: 12 } } }, AT).events?.[0]?.progress).toBe(
      'done',
    );
  });

  it('maps ZZZ Shiyu v1 floors and Deadly Assault', () => {
    const allS = Array.from({ length: 7 }, () => ({ rating: 'S', floor_challenge_time: { year: 2026 } }));
    const done = mapZzzDailyNote(
      {
        _endgame: {
          shiyu: { hadal_info_v1: { all_floor_detail: allS } },
          deadlyAssault: { has_data: true, total_star: 6 },
        },
      },
      AT,
    );
    expect(done.events).toEqual([
      { eventName: 'Shiyu Defense', progress: 'done', detail: 'Shiyu Defense 7/7 S' },
      { eventName: 'Deadly Assault', progress: 'done', detail: 'Deadly Assault 6★' },
    ]);
    const partly = mapZzzDailyNote(
      {
        _endgame: {
          shiyu: { hadal_info_v1: { all_floor_detail: [{ rating: 'A' }, { star: 3 }, {}] } },
          deadlyAssault: { has_data: true, total_star: 4 },
        },
      },
      AT,
    );
    expect(partly.events).toEqual([
      { eventName: 'Shiyu Defense', progress: 'partial', detail: 'Shiyu Defense 1/7 S' },
      { eventName: 'Deadly Assault', progress: 'partial', detail: 'Deadly Assault 4★' },
    ]);
  });

  it('maps ZZZ Shiyu v2 from its brief or floors', () => {
    const fromBrief = (brief: Record<string, unknown>) =>
      mapZzzDailyNote({ _endgame: { shiyu: { hadal_info_v2: { brief } } } }, AT).events;
    expect(fromBrief({ rating: 'S' })).toEqual([
      { eventName: 'Shiyu Defense', progress: 'done', detail: 'Shiyu Defense S' },
    ]);
    expect(fromBrief({ rating: 'A', pass_layer_num: 1 })?.[0]?.progress).toBe('partial');
    expect(fromBrief({ pass_layer_num: 1 })).toEqual([
      { eventName: 'Shiyu Defense', progress: 'partial', detail: 'Shiyu Defense' },
    ]);
    expect(fromBrief({})).toBeUndefined();
    const floors = mapZzzDailyNote(
      { _endgame: { shiyu: { hadal_info_v2: { floor_detail: [{ rating: 'S' }, { rating: 'S+' }] } } } },
      AT,
    );
    expect(floors.events?.[0]?.progress).toBe('done');
  });
});

describe('mapHsrDailyNote weekly tracks and endgame records', () => {
  it('ticks the weekly row from Currency Wars points as well as Divergent Universe', () => {
    const both = mapHsrDailyNote(
      {
        current_rogue_score: 2000,
        max_rogue_score: 14000,
        grid_fight_weekly_cur: '8000',
        grid_fight_weekly_max: '8000',
      },
      AT,
    );
    expect(both.tasks).toEqual([{ presetTaskKey: 'hsr-universe', done: true }]);
    expect(both.summary).toEqual(['Weekly points 2000/14000', 'Currency Wars 8000/8000 (done)']);
    expect(mapHsrDailyNote({ grid_fight_weekly_cur: 100, grid_fight_weekly_max: 8000 }, AT).tasks).toEqual([
      { presetTaskKey: 'hsr-universe', done: false },
    ]);
    expect(mapHsrDailyNote({ grid_fight_weekly_cur: -5, grid_fight_weekly_max: 8000 }, AT).tasks).toEqual([]);
  });

  it('sums floor stars when the total is missing and honours max_star', () => {
    const floors = Array.from({ length: 12 }, () => ({ star_num: '3' }));
    expect(mapHsrDailyNote({ _endgame: { moc: { has_data: true, all_floor_detail: floors } } }, AT).events).toEqual([
      { eventName: 'Memory of Chaos', progress: 'done', detail: 'Memory of Chaos 36/36★' },
    ]);
    expect(mapHsrDailyNote({ _endgame: { pf: { has_data: true, star_num: 12, max_star: 16 } } }, AT).events).toEqual([
      { eventName: 'Pure Fiction', progress: 'partial', detail: 'Pure Fiction 12/16★' },
    ]);
  });

  it('turns away a record from an older cycle by its group dates', () => {
    const date = (ms: number) => {
      const d = new Date(ms);
      return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour: 4, minute: 0 };
    };
    const record = (begin: number, end: number) => ({
      has_data: true,
      star_num: 36,
      groups: [{ begin_time: date(begin), end_time: date(end) }],
    });
    const day = 86_400_000;
    expect(mapHsrDailyNote({ _endgame: { moc: record(AT - 10 * day, AT + 10 * day) } }, AT).events).toHaveLength(1);
    expect(mapHsrDailyNote({ _endgame: { moc: record(AT - 60 * day, AT - 20 * day) } }, AT).events).toBeUndefined();
    expect(
      mapHsrDailyNote({ _endgame: { moc: { has_data: true, star_num: 36, groups: [{ begin_time: {} }] } } }, AT).events,
    ).toHaveLength(1);
  });
});

describe('hoyolabErrorGuidance codes', () => {
  it('explains every code a refresh can meet', () => {
    expect(hoyolabErrorGuidance(0).kind).toBe('ok');
    expect(hoyolabErrorGuidance(10102).kind).toBe('notes-off');
    expect(hoyolabErrorGuidance(1034).kind).toBe('captcha');
    expect(hoyolabErrorGuidance(-100).kind).toBe('auth');
    expect(hoyolabErrorGuidance(10001).kind).toBe('auth');
    expect(hoyolabErrorGuidance(10103).kind).toBe('auth');
    expect(hoyolabErrorGuidance(10101).kind).toBe('rate-limit');
    expect(hoyolabErrorGuidance(-110).kind).toBe('rate-limit');
    expect(hoyolabErrorGuidance(10104).message).toContain('UID');
    expect(hoyolabErrorGuidance(-502)).toMatchObject({ kind: 'error', message: expect.stringContaining('-502') });
    expect(hoyolabErrorGuidance(42).message).toContain('code 42');
  });
});

describe('hoyolabErrorGuidance -10001', () => {
  it('points to Battle Chronicle toggles or a fresh sign-in', () => {
    const guide = hoyolabErrorGuidance(-10001);
    expect(guide.kind).toBe('auth');
    expect(guide.message).toContain('Battle Chronicle');
    expect(guide.message).toContain('sign in again');
  });
});

describe('applyConnectorObservation endgame cycles', () => {
  const game = makeGame({ id: 'g1', presetKey: 'genshin' });
  const window = { start: AT - 86_400_000, end: AT + 86_400_000 };
  const abyss = makeEvent({ id: 'abyss', gameId: 'g1', type: 'cycle', name: 'Spiral Abyss', ...window });
  const stygian = makeEvent({
    id: 'sty',
    gameId: 'g1',
    type: 'cycle',
    name: 'Stygian Onslaught: Savage Tremors',
    parts: 3,
    ...window,
  });
  const obs = (events: ConnectorObservation['events']): ConnectorObservation => ({
    presetKey: 'genshin',
    observedAt: AT,
    provider: 'hoyolab',
    energies: [],
    tasks: [],
    events,
    summary: [],
  });
  const run = (state: ReturnType<typeof makeState>, events: ConnectorObservation['events']) =>
    applyConnectorObservation(state, 'g1', obs(events), AT + 1, 'b', () => 'id');

  it('ticks a matching active cycle by exact name or prefix', () => {
    const state = makeState({ games: [game], events: [abyss, stygian] });
    const result = run(state, [
      { eventName: 'spiral abyss', progress: 'done' },
      { eventName: 'Stygian Onslaught', progress: 'partial' },
    ]);
    expect(result.applied).toBe(2);
    expect(result.state.events.find((e) => e.id === 'abyss')).toMatchObject({ done: true, updatedAt: AT + 1 });
    expect(result.state.events.find((e) => e.id === 'sty')).toMatchObject({ parts: 3, partsDone: 1, done: false });
  });

  it('upgrades partial to done', () => {
    const state = makeState({ games: [game], events: [{ ...abyss, partsDone: 1 }] });
    const result = run(state, [{ eventName: 'Spiral Abyss', progress: 'done' }]);
    expect(result.applied).toBe(1);
    expect(result.state.events[0]).toMatchObject({ done: true });
  });

  it('never downgrades or repeats what is already recorded', () => {
    const state = makeState({
      games: [game],
      events: [
        { ...abyss, done: true, partsDone: 2 },
        { ...stygian, partsDone: 1 },
      ],
    });
    const result = run(state, [
      { eventName: 'Spiral Abyss', progress: 'partial' },
      { eventName: 'Stygian Onslaught', progress: 'partial' },
    ]);
    expect(result.applied).toBe(0);
    expect(result.state).toBe(state);
  });

  it('ignores ended, future, deleted, non-cycle and other-game events', () => {
    const state = makeState({
      games: [game],
      events: [
        { ...abyss, id: 'old', start: AT - 200_000_000, end: AT - 1 },
        { ...abyss, id: 'next', start: AT + 1, end: AT + 200_000_000 },
        { ...abyss, id: 'gone', deleted: true },
        { ...abyss, id: 'banner', type: 'banner' },
        { ...abyss, id: 'other', gameId: 'g2' },
      ],
    });
    expect(run(state, [{ eventName: 'Spiral Abyss', progress: 'done' }]).applied).toBe(0);
  });
});

describe('HoYoLAB daily check-in mapping', () => {
  it('maps _checkin.is_sign across Genshin, HSR and ZZZ and skips unsigned responses', () => {
    const genshinDone = mapGenshinDailyNote({ _checkin: { is_sign: true } }, AT);
    expect(genshinDone.tasks).toEqual([{ presetTaskKey: 'genshin-hoyolab', done: true }]);
    expect(genshinDone.summary).toEqual(['HoYoLAB check-in (done)']);

    const genshinNotYet = mapGenshinDailyNote({ _checkin: { is_sign: false } }, AT);
    expect(genshinNotYet.tasks).toEqual([]);
    expect(genshinNotYet.summary).toEqual([]);

    expect(mapHsrDailyNote({ _checkin: { is_sign: true } }, AT).tasks).toEqual([
      { presetTaskKey: 'hsr-hoyolab', done: true },
    ]);
    expect(mapZzzDailyNote({ _checkin: { is_sign: true } }, AT).tasks).toEqual([
      { presetTaskKey: 'zzz-hoyolab', done: true },
    ]);
  });

  it('ticks the matching HoYoLAB check-in task when applied to state', () => {
    const game = makeGame({ id: 'g1', presetKey: 'genshin' });
    const checkin = makeTask({ id: 'checkin', presetTaskKey: 'genshin-hoyolab', mode: 'check' });
    const state = makeState({ games: [game], tasks: [checkin] });
    const obs = mapGenshinDailyNote({ _checkin: { is_sign: true } }, AT);
    const result = applyConnectorObservation(state, 'g1', obs, AT, 'b-checkin', () => 'c1');
    expect(result.applied).toBe(1);
    expect(result.state.completions.find((c) => c.taskId === 'checkin')?.done).toBe(true);
  });
});
