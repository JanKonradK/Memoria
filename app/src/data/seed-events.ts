import { DateTime } from 'luxon';
import type { AppState, EventType, Game } from '@technogg/shared';
import { PRESETS } from '@technogg/shared';

/**
 * Bundled event feed — current banners/events per game, refreshed by asking
 * Claude after each patch (it reads the official HoYo announcement feeds and
 * patch notes, then rewrites this file). The Timeline shows an "Import"
 * button whenever this file contains events the local state doesn't.
 *
 * Times are strings in the game's SERVER time and converted with the game's
 * configured tz at import, so they stay correct on any server region.
 * HoYo feed items reuse the ⤓ HoYoLAB sourceKey (`genshin:<ann_id>`) so the
 * two import paths dedupe against each other.
 */

/** When the bundled data was last refreshed. */
export const SEED_UPDATED = '2026-07-09';

export interface SeedEvent {
  /** Preset key — matched against the game's name/short (games carry no preset id). */
  game: string;
  name: string;
  type: EventType;
  /** 'yyyy-MM-dd HH:mm' in the game's server timezone. */
  start: string;
  end: string;
  dailyTouch?: boolean;
  /** "Ending soon" alert. Omitted = true; maintenance never notifies. */
  notify?: boolean;
  notes?: string;
  /** Stable identity — re-imports update dates instead of duplicating. */
  sourceKey: string;
}

export const SEED_EVENTS: SeedEvent[] = [
  /* ------------------------------------------- Genshin Impact — v6.7 "Luna VIII" (Jul 1 – Aug 12)
     Banners/major events from the official announcement feed (Europe region, exact times). */
  { game: 'genshin', name: 'Sandrone — To the Looking-Glass the Mademoiselle Said', type: 'banner',
    start: '2026-07-01 04:00', end: '2026-07-21 17:59', sourceKey: 'genshin:21743' },
  { game: 'genshin', name: 'Citlali — Starry Night\'s Whispers', type: 'banner',
    start: '2026-07-01 04:00', end: '2026-07-21 17:59', sourceKey: 'genshin:21744' },
  { game: 'genshin', name: 'Epitome Invocation — Sandrone/Citlali weapons', type: 'banner',
    start: '2026-07-01 04:00', end: '2026-07-21 17:59', sourceKey: 'genshin:21745' },
  { game: 'genshin', name: 'Lightrace Wish — Heavenlit Prophecy', type: 'banner',
    start: '2026-07-01 04:00', end: '2026-07-21 17:59', notes: 'New wish type (Witch\'s Revelation cast).', sourceKey: 'genshin:21748' },
  { game: 'genshin', name: 'Sunny Summer Fontinalia — free Charlotte + outfit', type: 'event',
    start: '2026-07-01 04:00', end: '2026-08-11 03:59', notes: 'Flagship: aquarium on the Wingalet. Claim Charlotte before it ends.', sourceKey: 'genshin:21749' },
  { game: 'genshin', name: 'Sunny Summer login rewards', type: 'event', dailyTouch: true,
    start: '2026-07-01 04:00', end: '2026-08-10 03:59', notes: 'Verify scope in-game (announcement lists it separately from Fontinalia).', sourceKey: 'genshin:21755' },
  { game: 'genshin', name: 'Stygian Onslaught', type: 'event', notify: false,
    start: '2026-07-06 12:00', end: '2026-08-11 03:59', sourceKey: 'genshin:21168' },
  { game: 'genshin', name: 'Final Long-Range Sightlines', type: 'event',
    start: '2026-07-17 10:00', end: '2026-07-27 03:59', sourceKey: 'seed:genshin:6.7-sightlines' },
  { game: 'genshin', name: 'Dance Dance Easy-Breezy Disco', type: 'event',
    start: '2026-07-24 10:00', end: '2026-08-03 03:59', sourceKey: 'seed:genshin:6.7-disco' },
  { game: 'genshin', name: 'Ley Line Overflow', type: 'event',
    start: '2026-08-03 10:00', end: '2026-08-10 03:59', notes: 'Double ley line rewards — plan resin.', sourceKey: 'seed:genshin:6.7-leyline' },
  { game: 'genshin', name: 'Columbina — Somnias a Luna (phase 2)', type: 'banner',
    start: '2026-07-21 18:00', end: '2026-08-11 23:00', sourceKey: 'seed:genshin:6.7-columbina' },
  { game: 'genshin', name: 'Raiden Shogun — Reign of Serenity (phase 2)', type: 'banner',
    start: '2026-07-21 18:00', end: '2026-08-11 23:00', sourceKey: 'seed:genshin:6.7-raiden' },
  { game: 'genshin', name: 'v6.8 update maintenance', type: 'maintenance',
    start: '2026-08-11 23:00', end: '2026-08-12 04:00', sourceKey: 'seed:genshin:6.8-maint' },

  /* ------------------------------------------- Honkai: Star Rail — 4.3 ends Jul 14; v4.4 "In Ravages
     Does the Whistle Sound" launches Jul 15. HSR's public feed is empty (in-game calendar), so phase
     boundaries follow the announced schedule; TBC items are marked and set to not alert. */
  { game: 'hsr', name: 'Cyrene banner — 4.3 final phase', type: 'banner',
    start: '2026-06-24 12:00', end: '2026-07-14 23:00', sourceKey: 'seed:hsr:4.3-cyrene' },
  { game: 'hsr', name: 'Phainon banner — 4.3 final phase', type: 'banner',
    start: '2026-06-24 12:00', end: '2026-07-14 23:00', sourceKey: 'seed:hsr:4.3-phainon' },
  { game: 'hsr', name: 'v4.4 update maintenance', type: 'maintenance',
    start: '2026-07-14 23:00', end: '2026-07-15 04:00', sourceKey: 'seed:hsr:4.4-maint' },
  { game: 'hsr', name: 'Himeko • Nova (runs all of 4.4)', type: 'banner',
    start: '2026-07-15 04:00', end: '2026-08-25 23:00', sourceKey: 'seed:hsr:4.4-himeko-nova' },
  { game: 'hsr', name: 'Sparxie · Dan Heng PT · Evernight reruns (phase 1)', type: 'banner',
    start: '2026-07-15 04:00', end: '2026-08-05 11:59', sourceKey: 'seed:hsr:4.4-p1-reruns' },
  { game: 'hsr', name: 'Fate collab: Rin Tohsaka & Gilgamesh', type: 'banner',
    start: '2026-07-24 12:00', end: '2026-08-25 23:00', notes: 'End date TBC — announced as open-ended.', sourceKey: 'seed:hsr:4.4-fate-banners' },
  { game: 'hsr', name: 'Fate/Star Rail Night — collab event', type: 'event', notify: false,
    start: '2026-07-24 12:00', end: '2026-08-25 23:00', notes: 'Dates TBC — verify in-game.', sourceKey: 'seed:hsr:4.4-fate-event' },
  { game: 'hsr', name: 'Antigraft Brickbuster (flagship)', type: 'event', notify: false,
    start: '2026-07-15 04:00', end: '2026-08-25 23:00', notes: 'Dates TBC — verify in-game.', sourceKey: 'seed:hsr:4.4-brickbuster' },
  { game: 'hsr', name: '4.4 login gift — 10 free pulls', type: 'event', dailyTouch: true,
    start: '2026-07-15 04:00', end: '2026-08-25 23:00', notes: 'Gift of Odyssey style — log in 7 days.', sourceKey: 'seed:hsr:4.4-login' },
  { game: 'hsr', name: 'Cerydra · Anaxa · Aventurine reruns (phase 2)', type: 'banner',
    start: '2026-08-05 12:00', end: '2026-08-25 23:00', sourceKey: 'seed:hsr:4.4-p2-reruns' },

  /* ------------------------------------------- Zenless Zone Zero — v3.0 "A Sleepwalker's Confession"
     (anniversary; Jun 17 – Jul 29). All from the official announcement feed (Europe, exact times). */
  { game: 'zzz', name: 'Gleaming Shadow Team Battle', type: 'event',
    start: '2026-06-18 12:30', end: '2026-07-13 03:59', sourceKey: 'zzz:1201' },
  { game: 'zzz', name: 'Return to Ridu — anniversary login', type: 'event', dailyTouch: true,
    start: '2026-06-06 20:30', end: '2026-07-17 03:59', sourceKey: 'zzz:1189' },
  { game: 'zzz', name: 'Tales of the Hobbling Crow', type: 'event',
    start: '2026-07-01 12:30', end: '2026-07-20 03:59', sourceKey: 'zzz:1203' },
  { game: 'zzz', name: 'Assemble! Mock Exam Comeback Plan', type: 'event',
    start: '2026-06-24 12:00', end: '2026-07-27 03:59', sourceKey: 'zzz:1204' },
  { game: 'zzz', name: 'Art Is Bangboo!', type: 'event',
    start: '2026-07-06 18:15', end: '2026-07-27 03:59', sourceKey: 'zzz:212' },
  { game: 'zzz', name: 'All-New Program', type: 'event', notify: false,
    start: '2026-06-15 13:00', end: '2026-07-28 03:59', sourceKey: 'zzz:1200' },
  { game: 'zzz', name: "'En-Nah' Into Your Lap", type: 'event',
    start: '2026-07-06 18:00', end: '2026-07-28 03:59', sourceKey: 'zzz:1226' },
  { game: 'zzz', name: 'Norma (Outlier of Prodigies) + Sunna rerun — phase 2', type: 'banner',
    start: '2026-07-08 12:00', end: '2026-07-28 14:59', sourceKey: 'zzz:214' },
  { game: 'zzz', name: 'Celestial Nexus Intelligence Dossier', type: 'event', notify: false,
    start: '2026-06-15 18:30', end: '2026-07-29 05:59', notes: 'Roscaelifer exploration — runs to version end.', sourceKey: 'zzz:1205' },
  { game: 'zzz', name: 'Commemorative Gift (anniversary)', type: 'event',
    start: '2026-06-16 18:30', end: '2026-07-29 05:59', sourceKey: 'zzz:203' },
  { game: 'zzz', name: 'v3.1 update maintenance', type: 'maintenance',
    start: '2026-07-28 23:00', end: '2026-07-29 04:00', sourceKey: 'seed:zzz:3.1-maint' },

  /* ------------------------------------------- Wuthering Waves — 3.4 ends tonight; v3.5 launches
     Jul 10 (Mengzhou region, first SP character). 3.5 event end dates unannounced → set to version
     end, marked TBC, no alerts until confirmed. */
  { game: 'wuwa', name: 'Cartethyia rerun — final hours (3.4)', type: 'banner',
    start: '2026-06-18 10:00', end: '2026-07-09 23:00', sourceKey: 'seed:wuwa:3.4-cartethyia' },
  { game: 'wuwa', name: 'Cyberpunk collab: Lucy · Rebecca · Lucilla — final hours', type: 'banner',
    start: '2026-06-04 10:00', end: '2026-07-09 23:00', notes: 'Collab does not rerun — last chance.', sourceKey: 'seed:wuwa:3.4-cyberpunk' },
  { game: 'wuwa', name: 'v3.5 update maintenance', type: 'maintenance',
    start: '2026-07-09 23:00', end: '2026-07-10 04:00', sourceKey: 'seed:wuwa:3.5-maint' },
  { game: 'wuwa', name: 'Yangyang: Xuanling + signature weapon (phase 1)', type: 'banner',
    start: '2026-07-10 04:00', end: '2026-07-31 09:59', notes: 'First SP character.', sourceKey: 'seed:wuwa:3.5-xuanling' },
  { game: 'wuwa', name: 'Lynae & Luuk Herssen reruns (phase 1)', type: 'banner',
    start: '2026-07-10 04:00', end: '2026-07-31 09:59', sourceKey: 'seed:wuwa:3.5-p1-reruns' },
  { game: 'wuwa', name: 'Starpath Reverbs Convene — selectable 1.x rerun', type: 'banner',
    start: '2026-07-10 04:00', end: '2026-08-20 23:00', notes: 'Jiyan/Yinlin/Jinhsi/Changli/Zhezhi/Xiangli Yao; free first 10-pull.', sourceKey: 'seed:wuwa:3.5-starpath' },
  { game: 'wuwa', name: 'Suisui + Aemeath rerun (phase 2)', type: 'banner',
    start: '2026-07-31 10:00', end: '2026-08-20 23:00', sourceKey: 'seed:wuwa:3.5-p2' },
  { game: 'wuwa', name: 'Gifts of Aftertune (login)', type: 'event', dailyTouch: true,
    start: '2026-07-10 04:00', end: '2026-08-20 23:00', notes: 'End date TBC — verify in-game.', sourceKey: 'seed:wuwa:3.5-login' },
  { game: 'wuwa', name: 'Virtual Crisis: Quadrant Trials', type: 'event', notify: false,
    start: '2026-07-10 04:00', end: '2026-08-20 23:00', notes: 'End TBC — verify in-game.', sourceKey: 'seed:wuwa:3.5-quadrant' },
  { game: 'wuwa', name: 'Lament Recon: Tacet Crisis', type: 'event', notify: false,
    start: '2026-07-10 04:00', end: '2026-08-20 23:00', notes: 'End TBC — verify in-game.', sourceKey: 'seed:wuwa:3.5-lament' },
  { game: 'wuwa', name: 'Recaptured: Action Highlights', type: 'event', notify: false,
    start: '2026-07-10 04:00', end: '2026-08-20 23:00', notes: 'End TBC — verify in-game.', sourceKey: 'seed:wuwa:3.5-recaptured' },
  { game: 'wuwa', name: 'Shape of Yesterday', type: 'event', notify: false,
    start: '2026-07-10 04:00', end: '2026-08-20 23:00', notes: 'End TBC — verify in-game.', sourceKey: 'seed:wuwa:3.5-shape' },

  /* ------------------------------------------- Neverness to Everness — v1.2 (Jul 8 – Aug 19).
     Hotta doesn't publish exact flip times; banner boundaries use the 05:00 daily reset. */
  { game: 'nte', name: 'Shinku — Before the Dawn (+ Blushing Mirage arc)', type: 'banner',
    start: '2026-07-08 05:00', end: '2026-07-29 05:00', notes: 'Flip time approximate (reset-aligned).', sourceKey: 'seed:nte:1.2-shinku' },
  { game: 'nte', name: 'Iroha — The Lifeline (phase 2)', type: 'banner',
    start: '2026-07-29 05:00', end: '2026-08-19 05:00', notes: 'One source lists Aug 12 end — verify in-game.', sourceKey: 'seed:nte:1.2-iroha' },
  { game: 'nte', name: '999 Night Tabletop', type: 'event', notify: false,
    start: '2026-07-08 05:00', end: '2026-08-19 05:00', sourceKey: 'seed:nte:1.2-tabletop' },
  { game: 'nte', name: 'Shadow-N-Seek', type: 'event', notify: false,
    start: '2026-07-16 05:00', end: '2026-08-19 05:00', sourceKey: 'seed:nte:1.2-shadow' },
  { game: 'nte', name: 'Stamina Recharge ×2', type: 'event', dailyTouch: true,
    start: '2026-07-13 05:00', end: '2026-07-20 05:00', notes: 'Double stamina rewards — spend Pixels here.', sourceKey: 'seed:nte:1.2-stamina' },
  { game: 'nte', name: 'Gold Clash — 2× Fons in Pink Paws Heist', type: 'event', dailyTouch: true,
    start: '2026-07-18 05:00', end: '2026-08-01 05:00', sourceKey: 'seed:nte:1.2-goldclash' },
  { game: 'nte', name: 'Going, Going, Gone! (auction)', type: 'event', notify: false,
    start: '2026-07-29 05:00', end: '2026-08-19 05:00', sourceKey: 'seed:nte:1.2-auction' },
  { game: 'nte', name: 'Fishing Frenzy', type: 'event', notify: false,
    start: '2026-08-03 05:00', end: '2026-08-19 05:00', sourceKey: 'seed:nte:1.2-fishing' },
  { game: 'nte', name: 'Pixel Surge', type: 'event', dailyTouch: true,
    start: '2026-08-03 05:00', end: '2026-08-10 05:00', sourceKey: 'seed:nte:1.2-pixelsurge' },
  { game: 'nte', name: 'Warren Lucky Flip', type: 'event', dailyTouch: true,
    start: '2026-08-05 05:00', end: '2026-08-19 05:00', sourceKey: 'seed:nte:1.2-luckyflip' },
  { game: 'nte', name: 'Fons Rush', type: 'event', dailyTouch: true,
    start: '2026-08-10 05:00', end: '2026-08-17 05:00', sourceKey: 'seed:nte:1.2-fonsrush' },
];

export interface PlannedSeed {
  kind: 'add' | 'update';
  /** Set for updates — the id of the already-imported event to patch. */
  eventId?: string;
  gameId: string;
  seed: SeedEvent;
  start: number;
  end: number;
}

function parseServerTime(s: string, tz: string): number | null {
  const dt = DateTime.fromFormat(s, 'yyyy-LL-dd HH:mm', { zone: tz });
  return dt.isValid ? dt.toMillis() : null;
}

/** Find the live game a preset key refers to (preset name or short, case-insensitive). */
function gameForPreset(games: Game[], key: string): Game | undefined {
  const preset = PRESETS.find((p) => p.key === key);
  if (!preset) return undefined;
  const names = new Set([preset.name.toLowerCase(), preset.short.toLowerCase()]);
  return games.find(
    (g) => !g.deleted && (names.has(g.name.trim().toLowerCase()) || names.has(g.short.trim().toLowerCase())),
  );
}

/**
 * What importing the bundle would do right now: new events for games that
 * exist locally, plus date/name fixes for previously imported seeds (how TBC
 * dates get corrected on a refresh). Already-ended events and name twins
 * (e.g. the same banner imported via ⤓ HoYoLAB under another key) are skipped.
 */
export function planSeedImport(state: AppState, now: number): PlannedSeed[] {
  const out: PlannedSeed[] = [];
  const live = state.events.filter((e) => !e.deleted);
  const byKey = new Map(live.filter((e) => e.sourceKey).map((e) => [e.sourceKey!, e]));
  for (const seed of SEED_EVENTS) {
    const game = gameForPreset(state.games, seed.game);
    if (!game) continue;
    const start = parseServerTime(seed.start, game.tz);
    const end = parseServerTime(seed.end, game.tz);
    if (start == null || end == null || end <= start) continue;
    const existing = byKey.get(seed.sourceKey);
    if (existing) {
      if (existing.gameId === game.id && (existing.start !== start || existing.end !== end || existing.name !== seed.name)) {
        out.push({ kind: 'update', eventId: existing.id, gameId: game.id, seed, start, end });
      }
      continue;
    }
    if (end <= now) continue;
    const name = seed.name.trim().toLowerCase();
    const twin = live.some(
      (e) => e.gameId === game.id && e.name.trim().toLowerCase() === name && e.start <= end && start <= e.end,
    );
    if (twin) continue;
    out.push({ kind: 'add', gameId: game.id, seed, start, end });
  }
  return out;
}
