import { describe, expect, it } from 'vitest';
import { md5hex } from '../src/md5';
import {
  applyNote,
  isAllowedHoyoUrl,
  noteRequest,
  parseAnnList,
  parseNote,
  parseRoles,
  refreshNotes,
  unwrapHoyo,
} from '../src/hoyolab';
import { dailyPeriodKey } from '../src/periods';
import { latestSnapshots } from '../src/energy';
import { makeGame, makeResource, makeSnapshot, makeState, makeTask, utc } from './helpers';
import type { HoyoLink, NoteSummary } from '../src/types';

describe('md5', () => {
  it('matches RFC 1321 vectors', () => {
    expect(md5hex('')).toBe('d41d8cd98f00b204e9800998ecf8427e');
    expect(md5hex('abc')).toBe('900150983cd24fb0d6963f7d28e17f72');
    expect(md5hex('The quick brown fox jumps over the lazy dog')).toBe('9e107d9d372bb6826bd81d3542a419d6');
    // > 55 bytes forces a second padding block.
    expect(md5hex('12345678901234567890123456789012345678901234567890123456789012345678901234567890')).toBe(
      '57edf4a22be3c955ac49da2e2107b67a',
    );
  });
});

describe('requests', () => {
  it('signs note requests with cookie + DS', () => {
    const req = noteRequest('genshin', { uid: '700123456', region: 'os_euro' }, 'ltoken_v2=x; ltuid_v2=1', utc('2026-07-05T12:00:00'));
    expect(req.url).toContain('game_record/genshin/api/dailyNote');
    expect(req.url).toContain('role_id=700123456');
    expect(req.headers?.cookie).toContain('ltoken_v2=x');
    // DS = "<unix seconds>,<6 chars>,<md5 hex>"
    expect(req.headers?.ds).toMatch(/^\d{10},[a-z0-9]{6},[0-9a-f]{32}$/);
  });

  it('allows only hoyo hosts through the proxy', () => {
    expect(isAllowedHoyoUrl('https://bbs-api-os.hoyolab.com/game_record/x')).toBe(true);
    expect(isAllowedHoyoUrl('https://sg-hk4e-api.hoyoverse.com/common/x')).toBe(true);
    expect(isAllowedHoyoUrl('https://evil.com/?x=.hoyolab.com')).toBe(false);
    expect(isAllowedHoyoUrl('http://bbs-api-os.hoyolab.com/x')).toBe(false);
    expect(isAllowedHoyoUrl('not a url')).toBe(false);
  });

  it('unwraps the envelope and throws on API errors', () => {
    expect(unwrapHoyo({ retcode: 0, message: 'OK', data: { a: 1 } })).toEqual({ a: 1 });
    expect(() => unwrapHoyo({ retcode: 10001, message: 'Please login', data: null })).toThrow(/Please login/);
    expect(() => unwrapHoyo('nope')).toThrow(/unexpected/);
  });

  it('parses game roles', () => {
    const roles = parseRoles({
      list: [{ game_uid: '700123456', region: 'os_euro', nickname: 'Ada', level: 60 }],
    });
    expect(roles).toEqual([{ uid: '700123456', region: 'os_euro', nickname: 'Ada', level: 60 }]);
    expect(parseRoles({})).toEqual([]);
  });
});

describe('parseNote', () => {
  it('parses a Genshin daily note', () => {
    const s = parseNote('genshin', {
      current_resin: 137,
      max_resin: 200,
      resin_recovery_time: '30240',
      finished_task_num: 4,
      total_task_num: 4,
      is_extra_task_reward_received: true,
      expeditions: [{ status: 'Finished' }, { status: 'Ongoing' }],
      current_expedition_num: 2,
      current_home_coin: 2400,
      max_home_coin: 2400,
      remain_resin_discount_num: 3,
      resin_discount_num_limit: 3,
      transformer: { obtained: true, recovery_time: { reached: true } },
    });
    expect(s.primary).toEqual({ value: 137, cap: 200, recoverSeconds: 30240 });
    expect(s.daily).toEqual({ done: 4, total: 4, claimed: true });
    expect(s.stats.map((x) => x.label)).toEqual(['Expeditions', 'Realm currency', 'Boss discounts', 'Transformer']);
    expect(s.stats[1]).toMatchObject({ value: '2400/2400', urgent: true });
  });

  it('parses an HSR note with reserve', () => {
    const s = parseNote('hsr', {
      current_stamina: 112,
      max_stamina: 300,
      stamina_recover_time: 67680,
      current_reserve_stamina: 540,
      is_reserve_stamina_full: false,
      accepted_epedition_num: 4,
      expeditions: [{ status: 'Finished' }, { status: 'Finished' }],
      current_train_score: 500,
      max_train_score: 500,
      weekly_cocoon_cnt: 3,
      weekly_cocoon_limit: 3,
    });
    expect(s.primary.value).toBe(112);
    expect(s.reserve).toEqual({ value: 540, cap: 2400 });
    expect(s.daily).toEqual({ done: 500, total: 500, claimed: true });
  });

  it('parses a ZZZ note', () => {
    const s = parseNote('zzz', {
      energy: { progress: { max: 240, current: 199 }, restore: 14760 },
      vitality: { max: 400, current: 400 },
      vhs_sale: { sale_state: 'SaleStateDone' },
      card_sign: 'CardSignNo',
      bounty_commission: { num: 2, total: 4 },
      weekly_task: { max_point: 1300, cur_point: 800 },
    });
    expect(s.primary).toEqual({ value: 199, cap: 240, recoverSeconds: 14760 });
    expect(s.daily).toEqual({ done: 400, total: 400, claimed: true });
    expect(s.stats.find((x) => x.label === 'Scratch card')).toMatchObject({ value: 'to do', urgent: true });
  });

  it('survives an empty payload', () => {
    const s = parseNote('genshin', {});
    expect(s.primary.value).toBe(0);
    expect(s.daily).toBeNull();
    expect(s.stats).toEqual([]);
  });
});

function summary(over: Partial<NoteSummary> = {}): NoteSummary {
  return {
    primary: { value: 150, cap: 200, recoverSeconds: null },
    reserve: null,
    daily: null,
    stats: [],
    ...over,
  };
}

const LINK: HoyoLink = { gameId: 'g1', kind: 'genshin', uid: '1', region: 'os_euro' };

describe('applyNote', () => {
  const now = utc('2026-07-05T12:00:00');

  it('writes a snapshot when the live value drifts from the projection', () => {
    const state = makeState({
      games: [makeGame()],
      resources: [makeResource()],
      snapshots: [makeSnapshot({ value: 100, takenAt: now - 10 * 60_000 })], // projects to 101
    });
    const next = applyNote(state, LINK, summary({ primary: { value: 150, cap: 200, recoverSeconds: null } }), now);
    const latest = latestSnapshots(next.snapshots).get('r1')!;
    expect(latest.value).toBe(150);
    expect(latest.takenAt).toBe(now);
  });

  it('does not spam snapshots when the projection already matches', () => {
    const state = makeState({
      games: [makeGame()],
      resources: [makeResource()],
      snapshots: [makeSnapshot({ value: 100, takenAt: now - 8 * 60_000 })], // projects to 101
    });
    const next = applyNote(state, LINK, summary({ primary: { value: 101, cap: 200, recoverSeconds: null } }), now);
    expect(next.snapshots).toHaveLength(1);
    // status row is still recorded
    expect(next.statuses).toHaveLength(1);
  });

  it('corrects the resource cap when the API disagrees', () => {
    const state = makeState({ games: [makeGame()], resources: [makeResource({ cap: 160 })] });
    const next = applyNote(state, LINK, summary({ primary: { value: 10, cap: 200, recoverSeconds: null } }), now);
    expect(next.resources[0]!.cap).toBe(200);
  });

  it('auto-ticks the preset daily task when finished & claimed', () => {
    const game = makeGame();
    const state = makeState({
      games: [game],
      resources: [makeResource()],
      tasks: [makeTask({ id: 't1', name: 'Daily Commissions' })],
    });
    const next = applyNote(state, LINK, summary({ daily: { done: 4, total: 4, claimed: true } }), now);
    const key = dailyPeriodKey(game, now);
    expect(next.completions).toEqual([expect.objectContaining({ id: `t1|${key}`, done: true })]);

    // unclaimed → untouched
    const not = applyNote(state, LINK, summary({ daily: { done: 4, total: 4, claimed: false } }), now);
    expect(not.completions).toEqual([]);
  });

  it('stores reserve on the snapshot and refreshes when only reserve moves', () => {
    const state = makeState({
      games: [makeGame()],
      resources: [makeResource({ cap: 300, regenMinutes: 6 })],
      snapshots: [makeSnapshot({ value: 300, takenAt: now - 60_000, reserve: 100 })],
    });
    const next = applyNote(
      state,
      { ...LINK, kind: 'hsr' },
      summary({ primary: { value: 300, cap: 300, recoverSeconds: 0 }, reserve: { value: 160, cap: 2400 } }),
      now,
    );
    expect(latestSnapshots(next.snapshots).get('r1')!.reserve).toBe(160);
  });
});

describe('refreshNotes', () => {
  it('fetches every linked game and collects errors without failing the batch', async () => {
    const now = utc('2026-07-05T12:00:00');
    const state = makeState({
      games: [makeGame({ id: 'g1', short: 'GI' }), makeGame({ id: 'g2', short: 'ZZZ' })],
      resources: [makeResource({ id: 'r1', gameId: 'g1' }), makeResource({ id: 'r2', gameId: 'g2', cap: 240 })],
      settings: {
        ...makeState().settings,
        hoyolabCookie: 'ltoken_v2=x',
        hoyolabLinks: [
          { gameId: 'g1', kind: 'genshin', uid: '1', region: 'os_euro' },
          { gameId: 'g2', kind: 'zzz', uid: '2', region: 'prod_gf_eu' },
        ],
      },
    });
    const send = async (req: { url: string }) => {
      if (req.url.includes('genshin')) return { retcode: 0, message: 'OK', data: { current_resin: 77, max_resin: 200 } };
      return { retcode: -100, message: 'Please log in', data: null };
    };
    const { state: next, errors } = await refreshNotes(state, now, send);
    expect(latestSnapshots(next.snapshots).get('r1')!.value).toBe(77);
    expect(errors).toEqual(['ZZZ: HoYoLAB: Please log in (-100)']);
  });

  it('is a no-op without a cookie', async () => {
    const state = makeState({ games: [makeGame()] });
    const { state: next, errors } = await refreshNotes(state, 0, async () => ({ retcode: 0, message: '', data: {} }));
    expect(next).toBe(state);
    expect(errors).toEqual([]);
  });
});

describe('parseAnnList', () => {
  it('extracts events from both list and pic_list, in server timezone', () => {
    const events = parseAnnList('genshin', {
      timezone: 8,
      list: [
        {
          list: [
            {
              ann_id: 100,
              title: '<p>"Leyline Overflow" Event</p>',
              start_time: '2026-07-01 04:00:00',
              end_time: '2026-07-08 03:59:59',
            },
            { ann_id: 101, title: 'Event Wish "Sample Banner"', start_time: '2026-07-01 00:00:00', end_time: '2026-07-22 14:59:00' },
          ],
        },
      ],
      pic_list: [
        {
          type_list: [
            {
              list: [
                { ann_id: 102, title: 'Version Update Maintenance', start_time: '2026-07-09 01:00:00', end_time: '2026-07-09 06:00:00' },
                // duplicate id → dropped
                { ann_id: 100, title: 'dupe', start_time: '2026-07-01 04:00:00', end_time: '2026-07-08 03:59:59' },
              ],
            },
          ],
        },
      ],
    });
    expect(events).toHaveLength(3);
    expect(events[0]).toMatchObject({ sourceKey: 'genshin:100', name: '"Leyline Overflow" Event', type: 'event' });
    // 04:00 UTC+8 on Jul 1 = 20:00 UTC on Jun 30
    expect(events[0]!.start).toBe(utc('2026-06-30T20:00:00'));
    expect(events.find((e) => e.sourceKey === 'genshin:101')!.type).toBe('banner');
    expect(events.find((e) => e.sourceKey === 'genshin:102')!.type).toBe('maintenance');
  });

  it('returns empty for malformed payloads', () => {
    expect(parseAnnList('hsr', {})).toEqual([]);
    expect(parseAnnList('hsr', null)).toEqual([]);
  });
});
