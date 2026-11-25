import { DateTime } from 'luxon';
import { objectRecord } from '../internal';
import { GamePitySchema, MAX_PITY_LOG, pityRulesFor } from '../pity';
import type { GamePity, PityFiveStar, PityOutcome, PityRule, PityTrack } from '../pity';

/**
 * Pull-history import: UIGF v4 (and the older v2/v3 single-account shape) and
 * WuWa Tracker JSON, turned into Memoria's pity tracks.
 *
 * Banner codes map strictly. A code this file does not know is reported back
 * and leaves every track alone, because guessing which pity a new banner type
 * spends would quietly corrupt the count the player relies on.
 */

export type GachaPresetKey = 'genshin' | 'hsr' | 'zzz' | 'wuwa';

export interface RawGachaPull {
  id: string;
  /** Server wall-clock string ("2026-11-21 12:34:56") or epoch ms. */
  time: string | number;
  name: string;
  /** Star rank, 3–5. ZZZ's S/A/B (4/3/2 in its exports) are normalised to 5/4/3 when parsed. */
  rank: number;
  gachaType: string;
  itemType?: string;
}

export interface GachaImportSummary {
  presetKey: GachaPresetKey;
  uid?: string;
  totalPulls: number;
  fiveStarsImported: number;
  tracksUpdated: string[];
  ignoredBannerTypes: string[];
  pity: GamePity;
}

export interface UigfParseResult {
  presetKey: GachaPresetKey;
  uid?: string;
  availableUids: string[];
  pulls: RawGachaPull[];
  sourceFormat: 'uigf-v4' | 'uigf-v3' | 'wuwa-json';
}

const BANNER_TRACKS: Record<GachaPresetKey, Readonly<Record<string, string>>> = {
  genshin: { '301': 'character', '400': 'character', '302': 'weapon', '200': 'standard' },
  hsr: { '11': 'character', '12': 'weapon', '1': 'standard' },
  zzz: {
    '2001': 'character',
    '2': 'character',
    '3001': 'weapon',
    '3': 'weapon',
    '5001': 'bangboo',
    '5': 'bangboo',
    '1001': 'standard',
    '1': 'standard',
  },
  wuwa: { '1': 'character', '2': 'weapon', '3': 'standard', '4': 'standard' },
};

/** The permanent 5★s each game's limited banners can lose a 50/50 to. */
const STANDARD_FIVE_STARS: Record<GachaPresetKey, ReadonlySet<string>> = {
  genshin: /*#__PURE__*/ new Set(['diluc', 'jean', 'mona', 'qiqi', 'keqing', 'tighnari', 'dehya', 'yumemizuki mizuki']),
  hsr: /*#__PURE__*/ new Set(['himeko', 'welt', 'bronya', 'gepard', 'clara', 'yanqing', 'bailu']),
  zzz: /*#__PURE__*/ new Set(['grace', 'koleda', 'lycaon', 'nekomata', 'rina', 'soldier 11']),
  wuwa: /*#__PURE__*/ new Set(['calcharo', 'encore', 'jianxin', 'lingyang', 'verina']),
};

/** The pity track a banner code spends, or undefined for a code this importer does not know. */
export function gachaTrackFor(presetKey: GachaPresetKey, gachaType: string): string | undefined {
  return BANNER_TRACKS[presetKey][String(gachaType).trim()];
}

export function isStandardFiveStar(presetKey: GachaPresetKey, name: string): boolean {
  return STANDARD_FIVE_STARS[presetKey].has(name.trim().toLowerCase());
}

/**
 * Epoch ms for a pull time. Exports write the game SERVER's wall clock without
 * an offset, so it is read in the game's timezone — never the device's.
 */
export function parseGachaTime(time: string | number, gameTz: string): number | undefined {
  if (typeof time === 'number') return Number.isFinite(time) && time > 0 ? Math.round(time) : undefined;
  const text = time.trim();
  let dt = DateTime.fromFormat(text, 'yyyy-MM-dd HH:mm:ss', { zone: gameTz });
  if (!dt.isValid) dt = DateTime.fromISO(text, { zone: gameTz });
  if (dt.isValid) return dt.toMillis();
  if (/^\d+$/.test(text)) {
    const ms = Number(text);
    return Number.isFinite(ms) && ms > 0 ? ms : undefined;
  }
  return undefined;
}

function compareIds(a: string, b: string): number {
  if (/^\d+$/.test(a) && /^\d+$/.test(b) && a.length !== b.length) return a.length - b.length;
  return a < b ? -1 : a > b ? 1 : 0;
}

interface TimedPull extends RawGachaPull {
  at: number;
}

function countTrack(
  presetKey: GachaPresetKey,
  rule: PityRule,
  pulls: readonly TimedPull[],
): { track: PityTrack; fiveStars: number } {
  let count = 0;
  let guaranteed = false;
  const log: PityFiveStar[] = [];
  for (const pull of pulls) {
    count += 1;
    if (pull.rank < 5) continue;
    const outcome: PityOutcome =
      rule.featured === undefined
        ? 'standard'
        : rule.featured >= 1 || guaranteed
          ? 'guaranteed'
          : isStandardFiveStar(presetKey, pull.name)
            ? 'lost'
            : 'won';
    guaranteed = outcome === 'lost';
    const name = pull.name.trim().slice(0, 80);
    log.push({
      id: `gacha:${presetKey}:${pull.id}`.slice(0, 64),
      at: pull.at,
      pity: Math.min(Math.max(1, count), rule.hard),
      outcome,
      ...(name ? { name } : {}),
    });
    count = 0;
  }
  return { track: { count: Math.min(200, count), guaranteed, log }, fiveStars: log.length };
}

/**
 * Rebuilds the pity tracks an export covers. Tracks the export does not touch
 * stay exactly as they were, and 5★s the player logged by hand before the
 * export's first pull on a track are kept.
 */
export function importGachaHistory(
  presetKey: GachaPresetKey,
  pulls: readonly RawGachaPull[],
  gameTz: string,
  existing?: GamePity,
  uid?: string,
): GachaImportSummary {
  const ignored = new Set<string>();
  const byTrack = new Map<string, TimedPull[]>();
  const rules = pityRulesFor(presetKey);
  let totalPulls = 0;
  for (const pull of pulls) {
    const trackId = gachaTrackFor(presetKey, pull.gachaType);
    if (!trackId || !rules.some((rule) => rule.id === trackId)) {
      ignored.add(String(pull.gachaType));
      continue;
    }
    const at = parseGachaTime(pull.time, gameTz);
    if (at === undefined) continue;
    totalPulls += 1;
    const list = byTrack.get(trackId) ?? [];
    list.push({ ...pull, at });
    byTrack.set(trackId, list);
  }

  const tracks: Record<string, PityTrack> = { ...(existing?.tracks ?? {}) };
  const tracksUpdated: string[] = [];
  let fiveStarsImported = 0;
  for (const rule of rules) {
    const list = byTrack.get(rule.id);
    if (!list?.length) continue;
    list.sort((a, b) => a.at - b.at || compareIds(a.id, b.id));
    const { track, fiveStars } = countTrack(presetKey, rule, list);
    fiveStarsImported += fiveStars;
    const earliest = list[0]!.at;
    const importedIds = new Set(track.log.map((entry) => entry.id));
    const manual = (existing?.tracks[rule.id]?.log ?? []).filter(
      (entry) => entry.at < earliest && !importedIds.has(entry.id),
    );
    const seen = new Set<string>();
    const log = [...manual, ...track.log]
      .sort((a, b) => a.at - b.at)
      .filter((entry) => (seen.has(entry.id) ? false : (seen.add(entry.id), true)))
      .slice(-MAX_PITY_LOG);
    tracks[rule.id] = { ...track, log };
    tracksUpdated.push(rule.id);
  }

  return {
    presetKey,
    ...(uid ? { uid } : {}),
    totalPulls,
    fiveStarsImported,
    tracksUpdated,
    ignoredBannerTypes: [...ignored].sort(),
    pity: GamePitySchema.parse({ tracks }),
  };
}

const UIGF_V4_KEYS: Record<Exclude<GachaPresetKey, 'wuwa'>, string> = {
  genshin: 'hk4e',
  hsr: 'hkrpg',
  zzz: 'nap',
};

function text(raw: unknown): string | undefined {
  if (typeof raw === 'string') return raw.trim() || undefined;
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw);
  return undefined;
}

function rankOf(presetKey: GachaPresetKey, raw: unknown): number | undefined {
  const n = Number(text(raw));
  if (!Number.isInteger(n)) return undefined;
  // ZZZ ranks are B/A/S = 2/3/4.
  return presetKey === 'zzz' ? n + 1 : n;
}

/** Pulls from a UIGF-style list; entries without a time or banner code are skipped. */
function uigfPulls(presetKey: GachaPresetKey, list: unknown): RawGachaPull[] {
  if (!Array.isArray(list)) return [];
  const out: RawGachaPull[] = [];
  const seen = new Map<string, number>();
  for (const entry of list) {
    const row = objectRecord(entry);
    if (!row) continue;
    const time = text(row.time);
    const gachaType = text(row.gacha_type) ?? text(row.real_gacha_type) ?? text(row.uigf_gacha_type);
    const rank = rankOf(presetKey, row.rank_type);
    if (!time || !gachaType || rank === undefined) continue;
    let id = text(row.id);
    if (!id) {
      const key = `${gachaType}-${time.replace(/\D/g, '')}`;
      const n = seen.get(key) ?? 0;
      seen.set(key, n + 1);
      id = `${key}-${n}`;
    }
    const itemType = text(row.item_type);
    out.push({ id, time, name: text(row.name) ?? '', rank, gachaType, ...(itemType ? { itemType } : {}) });
  }
  return out;
}

function wuwaPulls(list: unknown[]): RawGachaPull[] {
  const out: RawGachaPull[] = [];
  const seen = new Map<string, number>();
  for (const entry of list) {
    const row = objectRecord(entry);
    if (!row) continue;
    const gachaType = text(row.cardPoolType);
    const time = typeof row.time === 'number' ? row.time : text(row.time);
    const rank = Number(text(row.qualityLevel));
    if (!gachaType || time === undefined || !Number.isInteger(rank)) continue;
    let id = text(row.id);
    if (!id) {
      // No id in the export: the pool, the second and its place among pulls in that second stay stable on re-import.
      const key = `w${gachaType}-${String(time).replace(/\D/g, '')}`;
      const n = seen.get(key) ?? 0;
      seen.set(key, n + 1);
      id = `${key}-${n}`;
    }
    const itemType = text(row.resourceType);
    out.push({ id, time, name: text(row.name) ?? '', rank, gachaType, ...(itemType ? { itemType } : {}) });
  }
  return out;
}

/**
 * Reads a pull-history export for one game. For a UIGF v4 file with several
 * accounts, `uid` picks one (default: the first) and `availableUids` lists them
 * all so the caller can ask. Throws on a file that is none of the known shapes.
 */
export function parseGachaExport(raw: unknown, presetKey: GachaPresetKey, uid?: string): UigfParseResult {
  if (presetKey === 'wuwa') {
    const record = objectRecord(raw);
    const list = Array.isArray(raw) ? raw : Array.isArray(record?.pulls) ? (record.pulls as unknown[]) : undefined;
    if (!list) throw new Error('This is not a WuWa pull-history file.');
    return { presetKey, availableUids: [], pulls: wuwaPulls(list), sourceFormat: 'wuwa-json' };
  }

  const record = objectRecord(raw);
  const info = objectRecord(record?.info);
  if (!record || !info) throw new Error('This is not a UIGF pull-history file.');

  const accounts = record[UIGF_V4_KEYS[presetKey]];
  if (Array.isArray(accounts)) {
    const rows = accounts.map(objectRecord).filter((row): row is Record<string, unknown> => row !== null);
    const availableUids = rows.map((row) => text(row.uid)).filter((id): id is string => id !== undefined);
    const chosen = (uid ? rows.find((row) => text(row.uid) === uid) : undefined) ?? (uid ? undefined : rows[0]);
    const chosenUid = chosen ? text(chosen.uid) : undefined;
    return {
      presetKey,
      ...(chosenUid ? { uid: chosenUid } : {}),
      availableUids,
      pulls: chosen ? uigfPulls(presetKey, chosen.list) : [],
      sourceFormat: 'uigf-v4',
    };
  }

  if (Array.isArray(record.list)) {
    const fileUid = text(info.uid);
    return {
      presetKey,
      ...(fileUid ? { uid: fileUid } : {}),
      availableUids: fileUid ? [fileUid] : [],
      pulls: uigfPulls(presetKey, record.list),
      sourceFormat: 'uigf-v3',
    };
  }
  throw new Error('This UIGF file has no pulls for this game.');
}
