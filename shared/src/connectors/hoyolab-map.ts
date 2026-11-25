import { objectRecord } from '../internal';
import type { SkportPresetKey } from './skport-map';

/**
 * Pure mappers from a HoYoLAB "daily note" (real-time notes) payload to a
 * game-neutral observation. Nothing here talks to the network: the caller
 * fetches `data` from the record endpoint and hands it in, and this file only
 * reads numbers out of it.
 *
 * The payloads report several things the other way round from Memoria: weekly
 * boss discounts and Echo of War claims are given as what is LEFT, so each is
 * turned into runs done before it reaches a count task.
 */

export type HoyolabPresetKey = 'genshin' | 'hsr' | 'zzz';

export interface EnergyObservation {
  /** The game's main regenerating bar. Matched to the first regen resource. */
  primary?: boolean;
  resourceName?: string;
  value: number;
  cap?: number;
  reserve?: number;
  /** Seconds until the bar is full, as the game reports it. */
  recoverySeconds?: number;
}

export interface TaskObservation {
  presetTaskKey: string;
  done?: boolean;
  countDone?: number;
  timerEndsAt?: number | null;
}

/** Progress on a timeline endgame cycle, read from the account's Battle Chronicle. */
export interface EventObservation {
  /** Cycle event prefix/name to match on the timeline, e.g. 'Spiral Abyss'. */
  eventName: string;
  progress: 'partial' | 'done';
  /** Concise human summary for confirmations/toasts, e.g. 'Spiral Abyss 36/36★'. */
  detail?: string;
}

/** Which account service a reading came from; stored as the snapshot's provenance provider. */
export type ConnectorProvider = 'hoyolab' | 'skport';

export interface ConnectorObservation {
  presetKey: HoyolabPresetKey | SkportPresetKey;
  observedAt: number;
  provider: ConnectorProvider;
  energies: EnergyObservation[];
  tasks: TaskObservation[];
  /** Endgame cycles with progress; absent when the payload carried none. */
  events?: EventObservation[];
  /** Short human lines describing what was read, for a confirmation sheet. */
  summary: string[];
}

/** A finite, non-negative number from a number or a numeric string ("14280"); otherwise undefined. */
export function connectorNumber(raw: unknown): number | undefined {
  let n: number;
  if (typeof raw === 'number') n = raw;
  else if (typeof raw === 'string' && /^\s*\d+(?:\.\d+)?\s*$/.test(raw)) n = Number(raw);
  else return undefined;
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function observation(presetKey: HoyolabPresetKey, observedAt: number): ConnectorObservation {
  return { presetKey, observedAt, provider: 'hoyolab', energies: [], tasks: [], summary: [] };
}

function fraction(value: number, cap: number | undefined): string {
  return cap != null ? `${value}/${cap}` : `${value}`;
}

/** Longest non-negative remaining time across a dispatch list; undefined when not a list. */
function maxRemaining(list: unknown, ...fields: string[]): number | undefined {
  if (!Array.isArray(list)) return undefined;
  let max = 0;
  for (const entry of list) {
    const row = objectRecord(entry);
    if (!row) continue;
    for (const field of fields) {
      const secs = connectorNumber(row[field]);
      if (secs !== undefined) {
        max = Math.max(max, secs);
        break;
      }
    }
  }
  return max;
}

function pushEvent(out: ConnectorObservation, event: EventObservation): void {
  (out.events ??= []).push(event);
  out.summary.push(event.detail ?? event.eventName);
}

/** Star-rated cycles: done at `full` stars, partial once any are earned. */
function starEvent(
  out: ConnectorObservation,
  eventName: string,
  stars: number | undefined,
  full: number,
  detail: string,
) {
  if (stars === undefined || stars <= 0) return;
  pushEvent(out, { eventName, progress: stars >= full ? 'done' : 'partial', detail });
}

/**
 * Whether a cycle window (in seconds) covers the reading. A record that ended
 * within the last day still counts, so a late refresh after the reset still
 * credits the cycle that just closed. Missing windows are trusted.
 */
export function windowMatches(startSec: unknown, endSec: unknown, observedAt: number): boolean {
  const start = connectorNumber(startSec);
  const end = connectorNumber(endSec);
  if (start === undefined || end === undefined || start <= 0 || end <= 0) return true;
  return start * 1000 <= observedAt && end * 1000 >= observedAt - 86_400_000;
}

function records(list: unknown): Record<string, unknown>[] {
  return Array.isArray(list)
    ? list.flatMap((item) => {
        const row = objectRecord(item);
        return row ? [row] : [];
      })
    : [];
}

function scheduleMatches(row: Record<string, unknown>, observedAt: number): boolean {
  const schedule = objectRecord(row.schedule);
  return windowMatches(schedule?.start_time, schedule?.end_time, observedAt);
}

function mapGenshinEndgame(out: ConnectorObservation, endgame: Record<string, unknown>): void {
  const at = out.observedAt;
  const abyss = objectRecord(endgame.spiralAbyss);
  if (abyss?.is_unlock === true && windowMatches(abyss.start_time, abyss.end_time, at)) {
    const stars = connectorNumber(abyss.total_star);
    starEvent(out, 'Spiral Abyss', stars, 36, `Spiral Abyss ${stars}/36★`);
  }

  const theater = records(objectRecord(endgame.roleCombat)?.data).find(
    (row) => row.has_data === true && scheduleMatches(row, at),
  );
  const act = connectorNumber(objectRecord(theater?.stat)?.max_round_id);
  if (act !== undefined && act > 0) {
    pushEvent(out, {
      eventName: 'Imaginarium Theater',
      progress: act >= 10 ? 'done' : 'partial',
      detail: `Imaginarium Theater Act ${act}`,
    });
  }

  const modes = (row: Record<string, unknown>) =>
    [objectRecord(row.single), objectRecord(row.mp)].filter((mode) => mode?.has_data === true);
  const stygian = records(objectRecord(endgame.hardChallenge)?.data).find(
    (row) => scheduleMatches(row, at) && modes(row).length > 0,
  );
  const difficulty = stygian
    ? Math.max(0, ...modes(stygian).map((mode) => connectorNumber(objectRecord(mode?.best)?.difficulty) ?? 0))
    : 0;
  if (difficulty > 0) {
    pushEvent(out, {
      eventName: 'Stygian Onslaught',
      progress: difficulty >= 3 ? 'done' : 'partial',
      detail: 'Stygian Onslaught',
    });
  }
}

/** An HSR record date, `{ year, month, day, hour, minute }` in server time, as epoch ms read as UTC. */
function hsrDate(raw: unknown): number | undefined {
  const date = objectRecord(raw);
  const year = connectorNumber(date?.year);
  const month = connectorNumber(date?.month);
  const day = connectorNumber(date?.day);
  if (!year || !month || !day) return undefined;
  return Date.UTC(year, month - 1, day, connectorNumber(date?.hour) ?? 0, connectorNumber(date?.minute) ?? 0);
}

/**
 * Whether an HSR endgame record belongs to the cycle being read. Its dates are server time with no zone,
 * so each window is widened by a day on both sides: only a record from an older cycle is turned away.
 * A record with no readable dates is trusted.
 */
function hsrScheduleMatches(row: Record<string, unknown>, observedAt: number): boolean {
  const windows = [row, ...records(row.groups)]
    .map((item) => [hsrDate(item.begin_time), hsrDate(item.end_time)] as const)
    .filter((pair): pair is readonly [number, number] => pair[0] !== undefined && pair[1] !== undefined);
  if (windows.length === 0) return true;
  return windows.some(([begin, end]) => begin - 86_400_000 <= observedAt && observedAt <= end + 86_400_000);
}

function mapHsrEndgame(out: ConnectorObservation, endgame: Record<string, unknown>): void {
  const cycle = (key: string, eventName: string, defaultFull: number) => {
    const row = objectRecord(endgame[key]);
    if (row?.has_data !== true || !hsrScheduleMatches(row, out.observedAt)) return;
    // Older records leave the total out; each floor still carries its own stars.
    const floors = records(row.all_floor_detail);
    const stars =
      connectorNumber(row.star_num) ??
      (floors.length > 0 ? floors.reduce((sum, floor) => sum + (connectorNumber(floor.star_num) ?? 0), 0) : undefined);
    const full = connectorNumber(row.max_star) || defaultFull;
    starEvent(out, eventName, stars, full, `${eventName} ${stars}/${full}★`);
  };
  cycle('moc', 'Memory of Chaos', 36);
  cycle('pf', 'Pure Fiction', 12);
  cycle('as', 'Apocalyptic Shadow', 12);
}

const SHIYU_FLOORS = 7;

function isSRank(rating: unknown): boolean {
  return rating === 'S' || rating === 'S+';
}

/** A Shiyu floor counts once it has a rating, stars or a recorded clear time. */
function floorCleared(floor: Record<string, unknown>): boolean {
  return (
    (typeof floor.rating === 'string' && floor.rating.trim() !== '') ||
    (connectorNumber(floor.star) ?? 0) > 0 ||
    objectRecord(floor.floor_challenge_time) !== null
  );
}

/** Shiyu Defense in either record shape: v1 lists seven floors, v2 gives a brief and its own floors. */
function shiyuProgress(shiyu: Record<string, unknown>): Omit<EventObservation, 'eventName'> | undefined {
  const v1Floors = records(objectRecord(shiyu.hadal_info_v1)?.all_floor_detail).filter(floorCleared);
  if (v1Floors.length > 0) {
    const sRanked = v1Floors.filter((floor) => isSRank(floor.rating) || (connectorNumber(floor.star) ?? 0) >= 3).length;
    return {
      progress: sRanked >= SHIYU_FLOORS ? 'done' : 'partial',
      detail: `Shiyu Defense ${sRanked}/${SHIYU_FLOORS} S`,
    };
  }
  const v2 = objectRecord(shiyu.hadal_info_v2);
  if (!v2) return undefined;
  const brief = objectRecord(v2.brief);
  const floors = records(v2.floor_detail).filter(floorCleared);
  const rating = typeof brief?.rating === 'string' ? brief.rating.trim() : '';
  const cleared =
    rating !== '' ||
    (connectorNumber(brief?.star) ?? 0) > 0 ||
    (connectorNumber(brief?.pass_layer_num) ?? 0) > 0 ||
    floors.length > 0;
  if (!cleared) return undefined;
  const done = isSRank(rating) || (floors.length > 0 && floors.every((floor) => isSRank(floor.rating)));
  return { progress: done ? 'done' : 'partial', detail: rating ? `Shiyu Defense ${rating}` : 'Shiyu Defense' };
}

function mapZzzEndgame(out: ConnectorObservation, endgame: Record<string, unknown>): void {
  const shiyu = objectRecord(endgame.shiyu);
  const hadal = shiyu ? shiyuProgress(shiyu) : undefined;
  if (hadal) pushEvent(out, { eventName: 'Shiyu Defense', ...hadal });

  const assault = objectRecord(endgame.deadlyAssault);
  if (assault?.has_data === true) {
    const stars = connectorNumber(assault.total_star);
    starEvent(out, 'Deadly Assault', stars, 6, `Deadly Assault ${stars}★`);
  }
}

function dispatchTask(presetTaskKey: string, maxRemain: number, observedAt: number): TaskObservation {
  return {
    presetTaskKey,
    timerEndsAt: maxRemain > 0 ? observedAt + maxRemain * 1000 : observedAt,
    done: maxRemain > 0,
  };
}

function primaryEnergy(
  out: ConnectorObservation,
  resourceName: string,
  value: number | undefined,
  cap: number | undefined,
  recoverySeconds: number | undefined,
  reserve?: number,
): void {
  if (value === undefined) return;
  out.energies.push({
    primary: true,
    resourceName,
    value,
    ...(cap !== undefined && cap > 0 ? { cap } : {}),
    ...(reserve !== undefined ? { reserve } : {}),
    ...(recoverySeconds !== undefined ? { recoverySeconds } : {}),
  });
  out.summary.push(`${resourceName} ${fraction(value, cap && cap > 0 ? cap : undefined)}`);
}

/** Today's HoYoLAB check-in, read alongside the notes: only a claimed one is reported. */
function mapCheckin(out: ConnectorObservation, raw: unknown, presetTaskKey: string): void {
  const checkin = objectRecord(raw);
  if (checkin?.is_sign !== true) return;
  out.tasks.push({ presetTaskKey, done: true });
  out.summary.push('HoYoLAB check-in (done)');
}

export function mapGenshinDailyNote(raw: unknown, observedAt: number): ConnectorObservation {
  const out = observation('genshin', observedAt);
  const data = objectRecord(raw);
  if (!data) return out;

  primaryEnergy(
    out,
    'Original Resin',
    connectorNumber(data.current_resin),
    connectorNumber(data.max_resin),
    connectorNumber(data.resin_recovery_time),
  );

  const coin = connectorNumber(data.current_home_coin);
  const coinCap = connectorNumber(data.max_home_coin);
  if (coin !== undefined && coinCap !== undefined && coinCap > 0) {
    const recovery = connectorNumber(data.home_coin_recovery_time);
    out.energies.push({
      resourceName: 'Realm Currency',
      value: coin,
      cap: coinCap,
      ...(recovery !== undefined ? { recoverySeconds: recovery } : {}),
    });
    out.summary.push(`Realm Currency ${fraction(coin, coinCap)}`);
  }

  // Newer payloads nest commissions under daily_task, where Encounter Point claims count too.
  const daily = objectRecord(data.daily_task);
  const finished = connectorNumber(data.finished_task_num) ?? connectorNumber(daily?.finished_num);
  const total = connectorNumber(data.total_task_num) ?? connectorNumber(daily?.total_num);
  const extra = data.is_extra_task_reward_received ?? daily?.is_extra_task_reward_received;
  const attendance = Array.isArray(daily?.attendance_rewards) ? records(daily.attendance_rewards) : undefined;
  const claimed = attendance?.filter((row) => row.status === 'AttendanceRewardStatusTakenAward').length ?? 0;
  if (finished !== undefined || extra !== undefined || attendance !== undefined) {
    const done = extra === true || (total !== undefined && total > 0 && (finished ?? 0) >= total) || claimed >= 4;
    out.tasks.push({ presetTaskKey: 'genshin-commissions', done });
    const encounter = claimed > 0 ? `, Encounter Points ${claimed}/4` : '';
    out.summary.push(`Commissions ${fraction(finished ?? 0, total)}${encounter}${done ? ' (done)' : ''}`);
  }

  const limit = connectorNumber(data.resin_discount_num_limit);
  const remain = connectorNumber(data.remain_resin_discount_num);
  if (limit !== undefined && remain !== undefined) {
    const countDone = Math.max(0, limit - remain);
    out.tasks.push({ presetTaskKey: 'genshin-weekly-bosses', countDone });
    out.summary.push(`Weekly bosses ${fraction(countDone, limit)}`);
  }

  const expeditions = maxRemaining(data.expeditions, 'remained_time');
  if (expeditions !== undefined) {
    out.tasks.push(dispatchTask('genshin-expeditions', expeditions, observedAt));
    out.summary.push(expeditions > 0 ? 'Expeditions out' : 'Expeditions ready');
  }

  const transformer = objectRecord(data.transformer);
  const recovery = objectRecord(transformer?.recovery_time);
  if (transformer?.obtained === true && recovery) {
    const secs =
      (connectorNumber(recovery.Day) ?? 0) * 86_400 +
      (connectorNumber(recovery.Hour) ?? 0) * 3_600 +
      (connectorNumber(recovery.Minute) ?? 0) * 60 +
      (connectorNumber(recovery.Second) ?? 0);
    const reached = recovery.reached === true;
    out.tasks.push({
      presetTaskKey: 'genshin-parametric',
      timerEndsAt: reached ? observedAt : observedAt + secs * 1000,
      done: !reached && secs > 0,
    });
    out.summary.push(reached ? 'Parametric Transformer ready' : 'Parametric Transformer cooling down');
  }

  mapCheckin(out, data._checkin, 'genshin-hoyolab');
  const endgame = objectRecord(data._endgame);
  if (endgame) mapGenshinEndgame(out, endgame);
  return out;
}

export function mapHsrDailyNote(raw: unknown, observedAt: number): ConnectorObservation {
  const out = observation('hsr', observedAt);
  const data = objectRecord(raw);
  if (!data) return out;

  primaryEnergy(
    out,
    'Trailblaze Power',
    connectorNumber(data.current_stamina),
    connectorNumber(data.max_stamina),
    connectorNumber(data.stamina_recover_time),
    connectorNumber(data.current_reserve_stamina),
  );

  /** A points track, summarised; undefined when the payload leaves it out. */
  const track = (current: unknown, max: unknown, label: string): boolean | undefined => {
    const cur = connectorNumber(current);
    const top = connectorNumber(max);
    if (cur === undefined || top === undefined) return undefined;
    const done = top > 0 && cur >= top;
    out.summary.push(`${label} ${fraction(cur, top)}${done ? ' (done)' : ''}`);
    return done;
  };
  const training = track(data.current_train_score, data.max_train_score, 'Daily Training');
  if (training !== undefined) out.tasks.push({ presetTaskKey: 'hsr-daily-training', done: training });
  // One weekly row covers both point tracks: Divergent Universe and Currency Wars.
  const universe = track(data.current_rogue_score, data.max_rogue_score, 'Weekly points');
  const currencyWars = track(data.grid_fight_weekly_cur, data.grid_fight_weekly_max, 'Currency Wars');
  if (universe !== undefined || currencyWars !== undefined) {
    out.tasks.push({ presetTaskKey: 'hsr-universe', done: universe === true || currencyWars === true });
  }

  const left = connectorNumber(data.weekly_cocoon_cnt);
  const limit = connectorNumber(data.weekly_cocoon_limit);
  if (left !== undefined && limit !== undefined) {
    const countDone = Math.max(0, limit - left);
    out.tasks.push({ presetTaskKey: 'hsr-echo-of-war', countDone });
    out.summary.push(`Echo of War ${fraction(countDone, limit)}`);
  }

  const assignments = maxRemaining(data.expeditions, 'remaining_time', 'remained_time');
  if (assignments !== undefined) {
    out.tasks.push(dispatchTask('hsr-assignments', assignments, observedAt));
    out.summary.push(assignments > 0 ? 'Assignments out' : 'Assignments ready');
  }

  mapCheckin(out, data._checkin, 'hsr-hoyolab');
  const endgame = objectRecord(data._endgame);
  if (endgame) mapHsrEndgame(out, endgame);
  return out;
}

export function mapZzzDailyNote(raw: unknown, observedAt: number): ConnectorObservation {
  const out = observation('zzz', observedAt);
  const data = objectRecord(raw);
  if (!data) return out;

  const energy = objectRecord(data.energy);
  const progress = objectRecord(energy?.progress);
  primaryEnergy(
    out,
    'Battery Charge',
    connectorNumber(progress?.current),
    connectorNumber(progress?.max),
    connectorNumber(energy?.restore),
    connectorNumber(energy?.current_backup ?? energy?.backup_current ?? data.current_backup),
  );

  const vitality = objectRecord(data.vitality);
  const vitalityCur = connectorNumber(vitality?.current);
  const vitalityMax = connectorNumber(vitality?.max);
  if (vitalityCur !== undefined && vitalityMax !== undefined) {
    const done = vitalityMax > 0 && vitalityCur >= vitalityMax;
    out.tasks.push({ presetTaskKey: 'zzz-engagement', done });
    out.summary.push(`Engagement ${fraction(vitalityCur, vitalityMax)}${done ? ' (done)' : ''}`);
  }

  const weekly = objectRecord(data.weekly_task);
  const ridu = connectorNumber(weekly?.cur_point);
  if (ridu !== undefined) {
    const max = connectorNumber(weekly?.max_point) ?? 0;
    // All four Polychrome tiers are paid by 800 points; the rest of the track is Denny.
    const done = ridu >= Math.min(800, max > 0 ? max : 800);
    out.tasks.push({ presetTaskKey: 'zzz-ridu', done });
    out.summary.push(`Ridu Weekly ${fraction(ridu, max > 0 ? max : undefined)}${done ? ' (done)' : ''}`);
  }

  const bounty =
    objectRecord(data.bounty_commission) ?? objectRecord(objectRecord(data.hollow_zero)?.bounty_commission);
  const bountyNum = connectorNumber(bounty?.num);
  const bountyTotal = connectorNumber(bounty?.total);
  if (bountyNum !== undefined && bountyTotal !== undefined && bountyTotal > 0) {
    const done = bountyNum >= bountyTotal;
    out.tasks.push({ presetTaskKey: 'zzz-hollow-zero', done });
    out.summary.push(`Bounty commissions ${fraction(bountyNum, bountyTotal)}${done ? ' (done)' : ''}`);
  }

  mapCheckin(out, data._checkin, 'zzz-hoyolab');
  const endgame = objectRecord(data._endgame);
  if (endgame) mapZzzEndgame(out, endgame);
  return out;
}

export function mapHoyolabNote(presetKey: HoyolabPresetKey, raw: unknown, observedAt: number): ConnectorObservation {
  switch (presetKey) {
    case 'genshin':
      return mapGenshinDailyNote(raw, observedAt);
    case 'hsr':
      return mapHsrDailyNote(raw, observedAt);
    case 'zzz':
      return mapZzzDailyNote(raw, observedAt);
  }
}

type Region = 'na' | 'eu' | 'asia' | 'tw';

const REGION_SERVERS: Record<HoyolabPresetKey, Record<Region, string>> = {
  genshin: { na: 'os_usa', eu: 'os_euro', asia: 'os_asia', tw: 'os_cht' },
  hsr: { na: 'prod_official_usa', eu: 'prod_official_eur', asia: 'prod_official_asia', tw: 'prod_official_cht' },
  zzz: { na: 'prod_gf_us', eu: 'prod_gf_eu', asia: 'prod_gf_jp', tw: 'prod_gf_sg' },
};

/** UID prefixes per game, longest first so "18" wins over a shorter match. */
const UID_PREFIXES: Record<HoyolabPresetKey, ReadonlyArray<readonly [string, Region]>> = {
  genshin: [
    ['18', 'asia'],
    ['6', 'na'],
    ['7', 'eu'],
    ['8', 'asia'],
    ['9', 'tw'],
  ],
  hsr: [
    ['18', 'asia'],
    ['6', 'na'],
    ['7', 'eu'],
    ['8', 'asia'],
    ['9', 'tw'],
  ],
  zzz: [
    ['10', 'na'],
    ['15', 'eu'],
    ['13', 'asia'],
    ['17', 'tw'],
  ],
};

function isRegion(id: string | undefined): id is Region {
  return id === 'na' || id === 'eu' || id === 'asia' || id === 'tw';
}

/**
 * The HoYoLAB `server` query value for an account: from its UID when the
 * prefix is recognised (the UID is what the API actually checks), else from
 * the Memoria server id. Undefined for China or anything unknown.
 */
export function hoyolabServerFor(presetKey: HoyolabPresetKey, serverId?: string, uid?: string): string | undefined {
  const digits = uid?.trim();
  if (digits && /^\d+$/.test(digits)) {
    const hit = UID_PREFIXES[presetKey].find(([prefix]) => digits.startsWith(prefix));
    if (hit) return REGION_SERVERS[presetKey][hit[1]];
  }
  return isRegion(serverId) ? REGION_SERVERS[presetKey][serverId] : undefined;
}

export type HoyolabErrorKind = 'ok' | 'notes-off' | 'captcha' | 'auth' | 'rate-limit' | 'error';

/** What a HoYoLAB `retcode` means for the player, in words they can act on. */
export function hoyolabErrorGuidance(retcode: number): { kind: HoyolabErrorKind; message: string } {
  switch (retcode) {
    case 0:
      return { kind: 'ok', message: 'Read your live numbers.' };
    case 10102:
      return {
        kind: 'notes-off',
        message:
          'Real-Time Notes are turned off for this account. Turn them on in the HoYoLAB app (Battle Chronicle, Real-Time Notes) and try again.',
      };
    case 1034:
      return {
        kind: 'captcha',
        message:
          'HoYoLAB wants a quick verification. Open Battle Chronicle in the HoYoLAB app or site once, solve the check, then try again.',
      };
    case -10001:
      return {
        kind: 'auth',
        message:
          'HoYoLAB refused this request. Check that Battle Chronicle is public with its data toggles on in HoYoLAB, or sign in again.',
      };
    case -100:
    case 10001:
      return {
        kind: 'auth',
        message: 'HoYoLAB no longer accepts this sign-in. Sign in again to keep reading your numbers.',
      };
    case 10103:
      return {
        kind: 'auth',
        message:
          'This HoYoLAB sign-in has no game account linked to it. Link the game in the HoYoLAB app, or sign in with the account that has it.',
      };
    case 10104:
      return {
        kind: 'error',
        message:
          'This UID is not on the HoYoLAB account you signed in with. Check the UID, or sign in with the account that owns it.',
      };
    case 10101:
      return {
        kind: 'rate-limit',
        message:
          'HoYoLAB is limiting how often this account can be read (it allows only so many reads a day). Wait a while before trying again.',
      };
    case -110:
      return {
        kind: 'rate-limit',
        message: 'HoYoLAB says the account was read too often just now. Wait a few minutes before trying again.',
      };
    case -502:
      return {
        kind: 'error',
        message:
          'HoYoLAB could not answer this request (code -502). Try again in a few minutes; if it keeps happening, sign in again.',
      };
    default:
      return { kind: 'error', message: `HoYoLAB returned an error (code ${retcode}). Try again later.` };
  }
}
