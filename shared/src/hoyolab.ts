import { DateTime } from 'luxon';
import { md5hex } from './md5';
import type { AppState, Completion, EventType, GameStatus, HoyoKind, HoyoLink, NoteStat, NoteSummary, Snapshot } from './types';
import { dailyPeriodKey } from './periods';
import { completionId } from './checklist';
import { latestSnapshots, projectEnergy } from './energy';

/**
 * HoYoLAB auto-import: daily notes (energy, dailies, expeditions, weeklies)
 * and public in-game announcement lists (events/banners for the timeline).
 *
 * These are the community-documented endpoints every widget/tracker uses.
 * They are NOT official public API — expect an occasional field to move after
 * big patches; every parser here is defensive and yields what it can.
 *
 * Browsers can't call them directly (CORS), so requests are described as
 * `ProxyRequest`s and executed by whichever backend is at hand: the Cloudflare
 * worker (/api/hoyolab), the desktop launcher, or the vite dev server.
 */

export interface ProxyRequest {
  url: string;
  headers?: Record<string, string>;
}

/** Envelope every HoYoLAB endpoint responds with. */
export interface HoyoEnvelope {
  retcode: number;
  message: string;
  data: unknown;
}

export const HOYO_KINDS: HoyoKind[] = ['genshin', 'hsr', 'zzz'];

export const HOYO_KIND_LABEL: Record<HoyoKind, string> = {
  genshin: 'Genshin Impact',
  hsr: 'Honkai: Star Rail',
  zzz: 'Zenless Zone Zero',
};

const GAME_BIZ: Record<HoyoKind, string> = {
  genshin: 'hk4e_global',
  hsr: 'hkrpg_global',
  zzz: 'nap_global',
};

/** Region select options per game (overseas servers). */
export const HOYO_REGIONS: Record<HoyoKind, Array<{ label: string; region: string }>> = {
  genshin: [
    { label: 'Europe', region: 'os_euro' },
    { label: 'America', region: 'os_usa' },
    { label: 'Asia', region: 'os_asia' },
    { label: 'TW/HK/MO', region: 'os_cht' },
  ],
  hsr: [
    { label: 'Europe', region: 'prod_official_eu' },
    { label: 'America', region: 'prod_official_usa' },
    { label: 'Asia', region: 'prod_official_asia' },
    { label: 'TW/HK/MO', region: 'prod_official_cht' },
  ],
  zzz: [
    { label: 'Europe', region: 'prod_gf_eu' },
    { label: 'America', region: 'prod_gf_us' },
    { label: 'Japan', region: 'prod_gf_jp' },
    { label: 'Asia', region: 'prod_gf_sg' },
  ],
};

/** Hosts the proxies are willing to forward to. */
export const HOYO_ALLOWED_HOSTS = ['.hoyolab.com', '.hoyoverse.com'];

export function isAllowedHoyoUrl(url: string): boolean {
  // Deliberately strict: plain https, a [a-z0-9.-] hostname immediately
  // followed by a path — anything fancier (ports, credentials, backslashes)
  // is rejected outright. Runtime-neutral (no URL global in this package).
  const m = /^https:\/\/([a-z0-9.-]+)\//i.exec(url);
  if (!m) return false;
  const host = m[1]!.toLowerCase();
  return HOYO_ALLOWED_HOSTS.some((suffix) => host.endsWith(suffix));
}

/* ---------------------------------------------------------------- signing */

/** Overseas DS salt (public knowledge, shipped in every community client). */
const DS_SALT = '6s25p5ox5y14umn1p61aqyyvbvvl3lrt';

function ds(now: number): string {
  const t = Math.floor(now / 1000);
  const r = Math.random().toString(36).slice(2, 8).padEnd(6, '0');
  return `${t},${r},${md5hex(`salt=${DS_SALT}&t=${t}&r=${r}`)}`;
}

function authHeaders(cookie: string, now: number): Record<string, string> {
  return {
    cookie,
    ds: ds(now),
    'x-rpc-app_version': '1.5.0',
    'x-rpc-client_type': '5',
    'x-rpc-language': 'en-us',
  };
}

/* ----------------------------------------------------------------- basics */

export function unwrapHoyo(json: unknown): unknown {
  const env = json as Partial<HoyoEnvelope> | null;
  if (!env || typeof env.retcode !== 'number') throw new Error('HoYoLAB: unexpected response shape');
  if (env.retcode !== 0) throw new Error(`HoYoLAB: ${env.message || 'error'} (${env.retcode})`);
  return env.data;
}

function num(v: unknown, fallback = 0): number {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : fallback;
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}

/* ---------------------------------------------------------------- account */

/** Lists the account's game characters ("roles") for one game — uid + region. */
export function rolesRequest(kind: HoyoKind, cookie: string, now: number): ProxyRequest {
  return {
    url: `https://api-account-os.hoyolab.com/binding/api/getUserGameRolesByCookie?game_biz=${GAME_BIZ[kind]}`,
    headers: authHeaders(cookie, now),
  };
}

export interface HoyoRole {
  uid: string;
  region: string;
  nickname: string;
  level: number;
}

export function parseRoles(data: unknown): HoyoRole[] {
  const list = obj(data)['list'];
  if (!Array.isArray(list)) return [];
  return list.map((r) => {
    const o = obj(r);
    return {
      uid: String(o['game_uid'] ?? ''),
      region: String(o['region'] ?? ''),
      nickname: String(o['nickname'] ?? ''),
      level: num(o['level']),
    };
  }).filter((r) => r.uid && r.region);
}

/* ------------------------------------------------------------- daily note */

export function noteRequest(kind: HoyoKind, link: Pick<HoyoLink, 'uid' | 'region'>, cookie: string, now: number): ProxyRequest {
  const q = `role_id=${encodeURIComponent(link.uid)}&server=${encodeURIComponent(link.region)}`;
  const urls: Record<HoyoKind, string> = {
    genshin: `https://bbs-api-os.hoyolab.com/game_record/genshin/api/dailyNote?${q}`,
    hsr: `https://bbs-api-os.hoyolab.com/game_record/hkrpg/api/note?${q}`,
    zzz: `https://sg-public-api.hoyolab.com/event/game_record_zzz/api/zzz/note?${q}`,
  };
  return { url: urls[kind], headers: authHeaders(cookie, now) };
}

function parseGenshinNote(d: Record<string, unknown>): NoteSummary {
  // Newer responses nest dailies under daily_task; older use flat fields.
  const dt = obj(d['daily_task']);
  const done = num(dt['finished_num'] ?? d['finished_task_num']);
  const total = num(dt['total_num'] ?? d['total_task_num']);
  const claimed = Boolean(dt['is_extra_task_reward_received'] ?? d['is_extra_task_reward_received']);

  const expeditions = Array.isArray(d['expeditions']) ? d['expeditions'] : [];
  const expDone = expeditions.filter((e) => String(obj(e)['status']) === 'Finished').length;
  const expTotal = num(d['current_expedition_num'], expeditions.length);

  const homeCoin = num(d['current_home_coin']);
  const homeCoinMax = num(d['max_home_coin']);
  const discountsLeft = num(d['remain_resin_discount_num']);
  const discountsMax = num(d['resin_discount_num_limit']);
  const transformer = obj(obj(d['transformer'])['recovery_time']);

  const stats: NoteStat[] = [];
  if (expTotal > 0) stats.push({ label: 'Expeditions', value: `${expDone}/${expTotal}`, urgent: expDone >= expTotal });
  if (homeCoinMax > 0)
    stats.push({ label: 'Realm currency', value: `${homeCoin}/${homeCoinMax}`, urgent: homeCoin >= homeCoinMax });
  if (discountsMax > 0) stats.push({ label: 'Boss discounts', value: `${discountsLeft} left`, urgent: false });
  if (obj(d['transformer'])['obtained'] && Boolean(transformer['reached']))
    stats.push({ label: 'Transformer', value: 'ready', urgent: true });

  return {
    primary: {
      value: num(d['current_resin']),
      cap: num(d['max_resin']),
      recoverSeconds: num(d['resin_recovery_time'], -1) >= 0 ? num(d['resin_recovery_time']) : null,
    },
    reserve: null,
    daily: total > 0 ? { done, total, claimed } : null,
    stats,
  };
}

function parseHsrNote(d: Record<string, unknown>): NoteSummary {
  const trainDone = num(d['current_train_score']);
  const trainTotal = num(d['max_train_score']);
  // The API historically misspells this field ("epedition"); read both.
  const expDone = num(d['finished_expedition_num'] ?? d['finished_epedition_num'], NaN);
  const expTotal = num(d['total_expedition_num'] ?? d['accepted_epedition_num'] ?? d['accepted_expedition_num']);
  const expeditions = Array.isArray(d['expeditions']) ? d['expeditions'] : [];
  const expFinished = Number.isFinite(expDone)
    ? expDone
    : expeditions.filter((e) => String(obj(e)['status']) === 'Finished').length;

  const cocoonDone = num(d['weekly_cocoon_cnt'], NaN);
  const cocoonMax = num(d['weekly_cocoon_limit']);
  const rogue = num(d['current_rogue_score'], NaN);
  const rogueMax = num(d['max_rogue_score']);

  const stats: NoteStat[] = [];
  if (expTotal > 0) stats.push({ label: 'Assignments', value: `${expFinished}/${expTotal}`, urgent: expFinished >= expTotal });
  if (cocoonMax > 0 && Number.isFinite(cocoonDone))
    stats.push({ label: 'Echo of War', value: `${cocoonDone} left`, urgent: false });
  if (rogueMax > 0 && Number.isFinite(rogue))
    stats.push({ label: 'Simulated U.', value: `${rogue}/${rogueMax}`, urgent: false });

  const reserveCap = num(d['max_reserve_stamina'], 2400);
  return {
    primary: {
      value: num(d['current_stamina']),
      cap: num(d['max_stamina']),
      recoverSeconds: num(d['stamina_recover_time'], -1) >= 0 ? num(d['stamina_recover_time']) : null,
    },
    reserve: d['current_reserve_stamina'] != null ? { value: num(d['current_reserve_stamina']), cap: reserveCap } : null,
    daily: trainTotal > 0 ? { done: trainDone, total: trainTotal, claimed: trainDone >= trainTotal } : null,
    stats,
  };
}

function parseZzzNote(d: Record<string, unknown>): NoteSummary {
  const energy = obj(d['energy']);
  const progress = obj(energy['progress']);
  const vitality = obj(d['vitality']);
  const vhs = String(obj(d['vhs_sale'])['sale_state'] ?? '');
  const cardSign = String(d['card_sign'] ?? '');
  const bounty = obj(d['bounty_commission']);
  const weekly = obj(d['weekly_task']);

  const stats: NoteStat[] = [];
  if (vhs) stats.push({ label: 'Video store', value: vhs.includes('Done') ? 'settled' : 'open', urgent: vhs.includes('Done') });
  if (cardSign) stats.push({ label: 'Scratch card', value: cardSign.includes('Done') ? 'done' : 'to do', urgent: !cardSign.includes('Done') });
  if (num(bounty['total']) > 0)
    stats.push({ label: 'Bounties', value: `${num(bounty['num'])}/${num(bounty['total'])}`, urgent: false });
  if (num(weekly['max_point']) > 0)
    stats.push({ label: 'Weekly task', value: `${num(weekly['cur_point'])}/${num(weekly['max_point'])}`, urgent: false });

  const vitDone = num(vitality['current']);
  const vitTotal = num(vitality['max']);
  return {
    primary: {
      value: num(progress['current']),
      cap: num(progress['max']),
      recoverSeconds: num(energy['restore'], -1) >= 0 ? num(energy['restore']) : null,
    },
    reserve: null,
    daily: vitTotal > 0 ? { done: vitDone, total: vitTotal, claimed: vitDone >= vitTotal } : null,
    stats,
  };
}

export function parseNote(kind: HoyoKind, data: unknown): NoteSummary {
  const d = obj(data);
  switch (kind) {
    case 'genshin':
      return parseGenshinNote(d);
    case 'hsr':
      return parseHsrNote(d);
    case 'zzz':
      return parseZzzNote(d);
  }
}

/* --------------------------------------------------- apply a note to state */

/** Preset daily-task names auto-ticked when the note says dailies are finished. */
const DAILY_TASK_NAME: Record<HoyoKind, string> = {
  genshin: 'Daily Commissions',
  hsr: 'Daily Training',
  zzz: 'Daily Engagement',
};

function bySort<T extends { sort: number }>(a: T, b: T): number {
  return a.sort - b.sort;
}

/**
 * Fold one fetched note into the app state: correct the resource cap, write a
 * snapshot when the live value drifted from the projection, auto-tick the
 * daily task, and store the status summary for display. Pure and idempotent —
 * runs identically in the app and in the worker cron.
 */
export function applyNote(state: AppState, link: HoyoLink, summary: NoteSummary, now: number): AppState {
  const game = state.games.find((g) => g.id === link.gameId && !g.deleted);
  if (!game) return state;
  let next = state;

  const res = state.resources.filter((r) => r.gameId === game.id && !r.deleted).sort(bySort)[0];
  if (res && summary.primary.cap > 0) {
    if (res.cap !== summary.primary.cap) {
      next = {
        ...next,
        resources: next.resources.map((r) => (r.id === res.id ? { ...r, cap: summary.primary.cap, updatedAt: now } : r)),
      };
    }
    const last = latestSnapshots(next.snapshots).get(res.id);
    const proj = projectEnergy({ cap: summary.primary.cap, regenMinutes: res.regenMinutes }, last, now);
    const reserve = summary.reserve?.value;
    const drifted = !proj.hasSnapshot || Math.abs(proj.value - summary.primary.value) >= 2;
    const reserveChanged = reserve != null && reserve !== last?.reserve;
    if (drifted || reserveChanged) {
      const snap: Snapshot = {
        // Deterministic id: app + worker fetching in the same minute dedupe on merge.
        id: `hoyo|${res.id}|${Math.floor(now / 60_000)}`,
        resourceId: res.id,
        value: summary.primary.value,
        takenAt: now,
        ...(reserve != null ? { reserve } : {}),
      };
      next = { ...next, snapshots: [...next.snapshots.filter((s) => s.id !== snap.id), snap] };
    }
  }

  const daily = summary.daily;
  if (daily && daily.total > 0 && daily.done >= daily.total && daily.claimed) {
    const task = next.tasks.find(
      (t) => t.gameId === game.id && !t.deleted && t.cadence === 'daily' && t.name === DAILY_TASK_NAME[link.kind],
    );
    if (task) {
      const key = dailyPeriodKey(game, now);
      const cid = completionId(task.id, key);
      const existing = next.completions.find((c) => c.id === cid);
      if (!existing?.done) {
        const comp: Completion = { id: cid, taskId: task.id, periodKey: key, done: true, updatedAt: now };
        next = {
          ...next,
          completions: existing
            ? next.completions.map((c) => (c.id === cid ? comp : c))
            : [...next.completions, comp],
        };
      }
    }
  }

  const status: GameStatus = { id: game.id, gameId: game.id, fetchedAt: now, summary, updatedAt: now };
  return { ...next, statuses: [...next.statuses.filter((s) => s.id !== game.id), status] };
}

/** Executes a ProxyRequest and resolves to the parsed JSON envelope. */
export type HoyoSend = (req: ProxyRequest) => Promise<unknown>;

/** Fetch + apply notes for every linked, unpaused game. Collects per-game errors. */
export async function refreshNotes(
  state: AppState,
  now: number,
  send: HoyoSend,
): Promise<{ state: AppState; errors: string[] }> {
  const cookie = state.settings.hoyolabCookie?.trim();
  const links = state.settings.hoyolabLinks ?? [];
  const errors: string[] = [];
  let next = state;
  if (!cookie || links.length === 0) return { state, errors };
  for (const link of links) {
    const game = next.games.find((g) => g.id === link.gameId && !g.deleted);
    if (!game || game.paused) continue;
    try {
      const json = await send(noteRequest(link.kind, link, cookie, now));
      const summary = parseNote(link.kind, unwrapHoyo(json));
      next = applyNote(next, link, summary, now);
    } catch (e) {
      errors.push(`${game.short}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { state: next, errors };
}

/* ------------------------------------------------------------ announcements */

/**
 * Public in-game announcement lists (no login needed) — the source for
 * event/banner import. HSR currently publishes its events via the in-game
 * calendar instead, so its list is often empty; GI and ZZZ are rich.
 */
export function annRequest(kind: HoyoKind, region: string): ProxyRequest {
  const r = encodeURIComponent(region);
  const urls: Record<HoyoKind, string> = {
    genshin: `https://sg-hk4e-api.hoyoverse.com/common/hk4e_global/announcement/api/getAnnList?game=hk4e&game_biz=hk4e_global&lang=en&bundle_id=hk4e_global&platform=pc&region=${r}&level=55&uid=100000000`,
    hsr: `https://sg-hkrpg-api.hoyoverse.com/common/hkrpg_global/announcement/api/getAnnList?game=hkrpg&game_biz=hkrpg_global&lang=en&bundle_id=hkrpg_os&platform=pc&region=${r}&level=70&uid=100000000&channel_id=1`,
    zzz: `https://sg-announcement-api.hoyoverse.com/common/nap_global/announcement/api/getAnnList?game=nap&game_biz=nap_global&lang=en&bundle_id=nap_global&platform=pc&region=${r}&level=60&uid=100000000`,
  };
  return { url: urls[kind] };
}

export interface AnnEvent {
  sourceKey: string;
  name: string;
  type: EventType;
  start: number;
  end: number;
}

function stripHtml(s: string): string {
  return s
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function classifyAnn(title: string): EventType {
  if (/wish|warp|signal search|w-engine|bangboo channel|banner/i.test(title)) return 'banner';
  if (/maintenance|update announcement|version update|update details/i.test(title)) return 'maintenance';
  return 'event';
}

export function parseAnnList(kind: HoyoKind, data: unknown): AnnEvent[] {
  const d = obj(data);
  const tzHours = num(d['timezone'], 8);
  const zone = `UTC${tzHours >= 0 ? '+' : ''}${tzHours}`;
  const parseTime = (v: unknown): number | null => {
    const dt = DateTime.fromFormat(String(v ?? ''), 'yyyy-LL-dd HH:mm:ss', { zone });
    return dt.isValid ? dt.toMillis() : null;
  };

  const groups: unknown[] = [];
  for (const key of ['list', 'pic_list'] as const) {
    const top = d[key];
    if (!Array.isArray(top)) continue;
    for (const g of top) {
      const go = obj(g);
      if (Array.isArray(go['list'])) groups.push(...go['list']);
      // pic_list nests one level deeper: pic_list[].type_list[].list[]
      const typeList = go['type_list'];
      if (Array.isArray(typeList)) {
        for (const t of typeList) {
          const tl = obj(t)['list'];
          if (Array.isArray(tl)) groups.push(...tl);
        }
      }
    }
  }

  const out: AnnEvent[] = [];
  const seen = new Set<string>();
  for (const item of groups) {
    const o = obj(item);
    const id = num(o['ann_id'], NaN);
    const title = stripHtml(String(o['title'] ?? ''));
    const start = parseTime(o['start_time']);
    const end = parseTime(o['end_time']);
    if (!Number.isFinite(id) || !title || start == null || end == null || end <= start) continue;
    const sourceKey = `${kind}:${id}`;
    if (seen.has(sourceKey)) continue;
    seen.add(sourceKey);
    out.push({ sourceKey, name: title, type: classifyAnn(title), start, end });
  }
  return out.sort((a, b) => a.end - b.end);
}
