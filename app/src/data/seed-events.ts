import { DateTime } from 'luxon';
import type { AppState, EventType, Game } from '@void/shared';
import { PRESETS } from '@void/shared';

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
 *
 * Rebuilt from scratch 2026-07-12, cross-checked against the official HoYo
 * announcement feeds, game8's per-game event calendars, nte.wiki and the
 * fandom wikis. Refreshed 2026-07-20: added the ZZZ v3.1 slate revealed in the
 * 3.1 livestream (releases Jul 29) and corrected the NTE phase-2 name to Iroi;
 * Genshin 6.7 / HSR 4.4 / WuWa 3.5 were mid-patch with no new announcements.
 * Categories: 'event' (play these), 'cycle' (recurring endgame
 * windows — Abyss/Theater, MoC/PF/AS/AA, Shiyu/DA), 'banner' (pulls),
 * 'maintenance' (patch downtime). Web-only and permanent content is excluded.
 */

/** When the bundled data was last refreshed. */
export const SEED_UPDATED = '2026-07-20';

export interface SeedEvent {
  /** Preset key — matched against the game's name/short (games carry no preset id). */
  game: string;
  name: string;
  type: EventType;
  /** 'yyyy-MM-dd HH:mm' in the game's server timezone. */
  start: string;
  end: string;
  dailyTouch?: boolean;
  /** Include in in-app next actions. Omitted = true; maintenance stays informational. */
  notify?: boolean;
  notes?: string;
  /** Stable identity — re-imports update dates instead of duplicating. */
  sourceKey: string;
}

export const SEED_EVENTS: SeedEvent[] = [
  /* ================================================== GENSHIN IMPACT — v6.7 "Luna VIII"
     Jul 1 – Aug 12. Events/banners from the official announcement feed (exact server times);
     Abyss/Theater cadence from the fandom wiki (they alternate months since 5.7). */
  // --- events
  {
    game: 'genshin',
    name: 'Sunny Summer Fontinalia — free Charlotte + outfit',
    type: 'event',
    start: '2026-07-01 04:00',
    end: '2026-08-11 03:59',
    notes: 'Flagship: aquarium on the Wingalet. Claim Charlotte before it ends.',
    sourceKey: 'genshin:21749',
  },
  {
    game: 'genshin',
    name: 'Sunny Summer login rewards',
    type: 'event',
    dailyTouch: true,
    start: '2026-07-01 04:00',
    end: '2026-08-10 03:59',
    sourceKey: 'genshin:21755',
  },
  {
    game: 'genshin',
    name: 'To Temper Thyself and Journey Far',
    type: 'event',
    notify: false,
    start: '2026-05-18 04:00',
    end: '2026-08-10 03:59',
    notes: 'Long-running quest campaign — no rush yet.',
    sourceKey: 'seed:genshin:temper-journey',
  },
  {
    game: 'genshin',
    name: 'Final Long-Range Sightlines',
    type: 'event',
    start: '2026-07-17 10:00',
    end: '2026-07-27 03:59',
    notes: 'Shooting minigame — 420 primos.',
    sourceKey: 'seed:genshin:6.7-sightlines',
  },
  {
    game: 'genshin',
    name: 'Dance Dance Easy-Breezy Disco',
    type: 'event',
    start: '2026-07-24 10:00',
    end: '2026-08-03 03:59',
    notes: 'Dance minigame — 420 primos.',
    sourceKey: 'seed:genshin:6.7-disco',
  },
  {
    game: 'genshin',
    name: 'Ley Line Overflow — double Mora/EXP',
    type: 'event',
    dailyTouch: true,
    start: '2026-08-03 10:00',
    end: '2026-08-10 03:59',
    notes: 'Double ley line rewards — plan resin.',
    sourceKey: 'seed:genshin:6.7-leyline',
  },
  // --- cycles
  {
    game: 'genshin',
    name: 'Stygian Onslaught',
    type: 'cycle',
    notify: false,
    start: '2026-07-06 12:00',
    end: '2026-08-11 03:59',
    notes: 'Condensed Resin counts 60 Dire Prestige each.',
    sourceKey: 'genshin:21168',
  },
  // Abyss and Theater BOTH run permanently: Abyss resets the 15th, Theater the 1st.
  {
    game: 'genshin',
    name: 'Spiral Abyss',
    type: 'cycle',
    start: '2026-06-15 04:00',
    end: '2026-07-15 03:59',
    notes: 'Resets the 15th, monthly.',
    sourceKey: 'seed:genshin:abyss-2026-06',
  },
  {
    game: 'genshin',
    name: 'Spiral Abyss',
    type: 'cycle',
    notify: false,
    start: '2026-07-15 04:00',
    end: '2026-08-15 03:59',
    notes: 'Resets the 15th, monthly.',
    sourceKey: 'seed:genshin:abyss-2026-07',
  },
  {
    game: 'genshin',
    name: 'Imaginarium Theater',
    type: 'cycle',
    start: '2026-07-01 04:00',
    end: '2026-08-01 03:59',
    notes: 'Resets the 1st, monthly.',
    sourceKey: 'seed:genshin:theater-2026-07',
  },
  {
    game: 'genshin',
    name: 'Imaginarium Theater',
    type: 'cycle',
    notify: false,
    start: '2026-08-01 04:00',
    end: '2026-09-01 03:59',
    notes: 'Resets the 1st, monthly.',
    sourceKey: 'seed:genshin:theater-2026-08',
  },
  // --- banners
  {
    game: 'genshin',
    name: 'Sandrone — To the Looking-Glass the Mademoiselle Said',
    type: 'banner',
    start: '2026-07-01 04:00',
    end: '2026-07-21 17:59',
    sourceKey: 'genshin:21743',
  },
  {
    game: 'genshin',
    name: "Citlali — Starry Night's Whispers",
    type: 'banner',
    start: '2026-07-01 04:00',
    end: '2026-07-21 17:59',
    sourceKey: 'genshin:21744',
  },
  {
    game: 'genshin',
    name: 'Epitome Invocation — Sandrone/Citlali weapons',
    type: 'banner',
    start: '2026-07-01 04:00',
    end: '2026-07-21 17:59',
    sourceKey: 'genshin:21745',
  },
  {
    game: 'genshin',
    name: 'Lightrace Wish — Heavenlit Prophecy',
    type: 'banner',
    start: '2026-07-01 04:00',
    end: '2026-07-21 17:59',
    notes: "New wish type (Witch's Revelation cast).",
    sourceKey: 'genshin:21748',
  },
  {
    game: 'genshin',
    name: 'Columbina — Somnias a Luna (phase 2)',
    type: 'banner',
    start: '2026-07-21 18:00',
    end: '2026-08-11 23:00',
    sourceKey: 'seed:genshin:6.7-columbina',
  },
  {
    game: 'genshin',
    name: 'Raiden Shogun — Reign of Serenity (phase 2)',
    type: 'banner',
    start: '2026-07-21 18:00',
    end: '2026-08-11 23:00',
    sourceKey: 'seed:genshin:6.7-raiden',
  },
  // --- maintenance
  {
    game: 'genshin',
    name: 'v6.8 update maintenance',
    type: 'maintenance',
    start: '2026-08-11 23:00',
    end: '2026-08-12 04:00',
    sourceKey: 'seed:genshin:6.8-maint',
  },

  /* ================================================== HONKAI: STAR RAIL — 4.3 ends Jul 14;
     v4.4 "In Ravages Does the Whistle Sound" (Fate collab) launches Jul 15. HSR's public feed
     is empty (in-game calendar) — dates from game8's calendar, endgame phases from the wiki
     (each mode runs 6 weeks, staggered). */
  // --- events (4.3)
  {
    game: 'hsr',
    name: 'Realm of the Strange — 2× cavern relics',
    type: 'event',
    dailyTouch: true,
    start: '2026-07-03 04:00',
    end: '2026-07-13 03:59',
    notes: 'Double relic drops from Caverns — dump Trailblaze Power.',
    sourceKey: 'seed:hsr:4.3-realm',
  },
  {
    game: 'hsr',
    name: 'Pixel Plane Rumble',
    type: 'event',
    start: '2026-06-01 12:00',
    end: '2026-07-14 23:00',
    notes: 'Runs to the end of 4.3 — finish before maintenance.',
    sourceKey: 'seed:hsr:4.3-pixel-plane',
  },
  {
    game: 'hsr',
    name: 'Wispae Amusement Park',
    type: 'event',
    start: '2026-06-24 12:00',
    end: '2026-07-14 23:00',
    notes: 'Runs to the end of 4.3 — finish before maintenance.',
    sourceKey: 'seed:hsr:4.3-wispae',
  },
  {
    game: 'hsr',
    name: 'Stellar Companion — free 5★ selector',
    type: 'event',
    notify: false,
    start: '2026-04-22 04:00',
    end: '2026-08-25 23:00',
    notes: 'Long-runner — ends with 4.4.',
    sourceKey: 'seed:hsr:stellar-companion',
  },
  // --- events (4.4)
  {
    game: 'hsr',
    name: '4.4 Gift of Odyssey — 10 free pulls',
    type: 'event',
    dailyTouch: true,
    start: '2026-07-15 04:00',
    end: '2026-08-25 23:00',
    notes: '7-day login.',
    sourceKey: 'seed:hsr:4.4-login',
  },
  {
    game: 'hsr',
    name: 'Fate Gift — free collab Light Cone',
    type: 'event',
    dailyTouch: true,
    start: '2026-07-15 04:00',
    end: '2026-08-25 23:00',
    notes: 'Login gift alongside the collab.',
    sourceKey: 'seed:hsr:4.4-fate-gift',
  },
  {
    game: 'hsr',
    name: 'Antigraft Brickbuster (flagship)',
    type: 'event',
    notify: false,
    start: '2026-07-15 04:00',
    end: '2026-08-25 23:00',
    sourceKey: 'seed:hsr:4.4-brickbuster',
  },
  {
    game: 'hsr',
    name: 'Fate/Star Rail Night — collab event',
    type: 'event',
    start: '2026-07-24 12:00',
    end: '2026-08-25 23:00',
    sourceKey: 'seed:hsr:4.4-fate-event',
  },
  {
    game: 'hsr',
    name: 'Free Gilgamesh or Archer — claim window',
    type: 'event',
    notify: false,
    start: '2026-07-24 12:00',
    end: '2026-11-17 23:00',
    notes: 'Claimable until the end of 4.6 — end date approximate.',
    sourceKey: 'seed:hsr:4.4-free-servant',
  },
  {
    game: 'hsr',
    name: 'Planar Fissure — 2× Planar Ornaments',
    type: 'event',
    dailyTouch: true,
    start: '2026-07-27 04:00',
    end: '2026-08-10 03:59',
    notes: 'Double ornament drops — plan Trailblaze Power.',
    sourceKey: 'seed:hsr:4.4-planar-fissure',
  },
  {
    game: 'hsr',
    name: 'Garden of Plenty — 2× Calyx rewards',
    type: 'event',
    dailyTouch: true,
    start: '2026-08-14 04:00',
    end: '2026-08-24 03:59',
    notes: 'Double Calyx drops — plan Trailblaze Power.',
    sourceKey: 'seed:hsr:4.4-garden',
  },
  // --- cycles (staggered 6-week endgame windows)
  {
    game: 'hsr',
    name: 'Anomaly Arbitration — The Humming Laughter',
    type: 'cycle',
    start: '2026-06-01 04:00',
    end: '2026-07-13 03:59',
    sourceKey: 'seed:hsr:aa-4.3',
  },
  {
    game: 'hsr',
    name: 'Apocalyptic Shadow — current phase',
    type: 'cycle',
    start: '2026-06-08 04:00',
    end: '2026-07-20 03:59',
    sourceKey: 'seed:hsr:as-4.3',
  },
  {
    game: 'hsr',
    name: 'Pure Fiction — current phase',
    type: 'cycle',
    start: '2026-06-22 04:00',
    end: '2026-08-03 03:59',
    sourceKey: 'seed:hsr:pf-4.3',
  },
  {
    game: 'hsr',
    name: 'Memory of Chaos — current phase',
    type: 'cycle',
    start: '2026-07-06 04:00',
    end: '2026-08-17 03:59',
    sourceKey: 'seed:hsr:moc-4.3',
  },
  {
    game: 'hsr',
    name: 'Anomaly Arbitration — next phase',
    type: 'cycle',
    notify: false,
    start: '2026-07-13 04:00',
    end: '2026-08-24 03:59',
    notes: 'Follows the 6-week cadence — verify in-game.',
    sourceKey: 'seed:hsr:aa-4.4',
  },
  // --- banners
  {
    game: 'hsr',
    name: 'Cyrene banner — 4.3 final phase',
    type: 'banner',
    start: '2026-06-24 12:00',
    end: '2026-07-14 23:00',
    sourceKey: 'seed:hsr:4.3-cyrene',
  },
  {
    game: 'hsr',
    name: 'Phainon banner — 4.3 final phase',
    type: 'banner',
    start: '2026-06-24 12:00',
    end: '2026-07-14 23:00',
    sourceKey: 'seed:hsr:4.3-phainon',
  },
  {
    game: 'hsr',
    name: 'Himeko • Nova (runs all of 4.4)',
    type: 'banner',
    start: '2026-07-15 04:00',
    end: '2026-08-25 23:00',
    sourceKey: 'seed:hsr:4.4-himeko-nova',
  },
  {
    game: 'hsr',
    name: 'Sparxie · Dan Heng PT · Evernight reruns (phase 1)',
    type: 'banner',
    start: '2026-07-15 04:00',
    end: '2026-08-05 11:59',
    sourceKey: 'seed:hsr:4.4-p1-reruns',
  },
  {
    game: 'hsr',
    name: 'Fate collab: Rin Tohsaka & Gilgamesh',
    type: 'banner',
    start: '2026-07-24 12:00',
    end: '2026-08-25 23:00',
    sourceKey: 'seed:hsr:4.4-fate-banners',
  },
  {
    game: 'hsr',
    name: 'Cerydra · Anaxa · Aventurine reruns (phase 2)',
    type: 'banner',
    start: '2026-08-05 12:00',
    end: '2026-08-25 23:00',
    sourceKey: 'seed:hsr:4.4-p2-reruns',
  },
  // --- maintenance
  {
    game: 'hsr',
    name: 'v4.4 update maintenance',
    type: 'maintenance',
    start: '2026-07-14 23:00',
    end: '2026-07-15 04:00',
    sourceKey: 'seed:hsr:4.4-maint',
  },

  /* ================================================== ZENLESS ZONE ZERO — v3.0 anniversary
     (Jun 17 – Jul 29). Official announcement feed where available (exact times), game8 for
     the rest; Shiyu Critical / Deadly Assault alternate biweekly Fridays. */
  // --- events
  {
    game: 'zzz',
    name: 'Gleaming Shadow Team Battle',
    type: 'event',
    start: '2026-06-18 12:30',
    end: '2026-07-13 03:59',
    sourceKey: 'zzz:1201',
  },
  {
    game: 'zzz',
    name: 'Return to Ridu — anniversary login',
    type: 'event',
    dailyTouch: true,
    start: '2026-06-06 20:30',
    end: '2026-07-17 03:59',
    sourceKey: 'zzz:1189',
  },
  {
    game: 'zzz',
    name: 'Tales of the Hobbling Crow',
    type: 'event',
    start: '2026-07-01 12:30',
    end: '2026-07-20 03:59',
    sourceKey: 'zzz:1203',
  },
  {
    game: 'zzz',
    name: 'Assemble! Mock Exam Comeback Plan',
    type: 'event',
    start: '2026-06-24 12:00',
    end: '2026-07-27 03:59',
    sourceKey: 'zzz:1204',
  },
  {
    game: 'zzz',
    name: 'Art Is Bangboo!',
    type: 'event',
    start: '2026-07-06 18:15',
    end: '2026-07-27 03:59',
    sourceKey: 'zzz:212',
  },
  {
    game: 'zzz',
    name: 'Data Bounty — Combat Simulation',
    type: 'event',
    dailyTouch: true,
    start: '2026-07-22 12:00',
    end: '2026-07-27 03:59',
    notes: 'Short combat-sim window.',
    sourceKey: 'seed:zzz:3.0-data-bounty',
  },
  {
    game: 'zzz',
    name: 'The Final Callback',
    type: 'event',
    start: '2026-07-08 12:00',
    end: '2026-07-28 03:59',
    sourceKey: 'seed:zzz:3.0-final-callback',
  },
  {
    game: 'zzz',
    name: 'All-New Program',
    type: 'event',
    notify: false,
    start: '2026-06-15 13:00',
    end: '2026-07-28 03:59',
    sourceKey: 'zzz:1200',
  },
  {
    game: 'zzz',
    name: "'En-Nah' Into Your Lap",
    type: 'event',
    start: '2026-07-06 18:00',
    end: '2026-07-28 03:59',
    sourceKey: 'zzz:1226',
  },
  {
    game: 'zzz',
    name: 'Bangbang the Genius & Miracle Chip',
    type: 'event',
    notify: false,
    start: '2026-06-17 12:00',
    end: '2026-07-29 05:59',
    sourceKey: 'seed:zzz:3.0-bangbang',
  },
  {
    game: 'zzz',
    name: 'Celestial Nexus Intelligence Dossier',
    type: 'event',
    notify: false,
    start: '2026-06-15 18:30',
    end: '2026-07-29 05:59',
    notes: 'Roscaelifer exploration — runs to version end.',
    sourceKey: 'zzz:1205',
  },
  {
    game: 'zzz',
    name: 'Commemorative Gift (anniversary)',
    type: 'event',
    start: '2026-06-16 18:30',
    end: '2026-07-29 05:59',
    sourceKey: 'zzz:203',
  },
  // --- cycles (biweekly Friday alternation)
  {
    game: 'zzz',
    name: 'Deadly Assault — current phase',
    type: 'cycle',
    start: '2026-07-02 04:00',
    end: '2026-07-16 03:59',
    notes: 'Biweekly Friday alternation — verify in-game.',
    sourceKey: 'seed:zzz:da-2026-07-02',
  },
  {
    game: 'zzz',
    name: 'Shiyu Defense: Critical — current phase',
    type: 'cycle',
    start: '2026-07-10 04:00',
    end: '2026-07-24 03:59',
    notes: 'Biweekly Friday alternation — verify in-game.',
    sourceKey: 'seed:zzz:shiyu-2026-07-10',
  },
  // --- banners
  {
    game: 'zzz',
    name: 'Norma (Outlier of Prodigies) + Sunna rerun — phase 2',
    type: 'banner',
    start: '2026-07-08 12:00',
    end: '2026-07-28 14:59',
    sourceKey: 'zzz:214',
  },
  // --- maintenance
  {
    game: 'zzz',
    name: 'v3.1 update maintenance',
    type: 'maintenance',
    start: '2026-07-28 23:00',
    end: '2026-07-29 04:00',
    sourceKey: 'seed:zzz:3.1-maint',
  },
  /* --- v3.1 (Jul 29 – ~Sep 8), revealed in the 3.1 livestream. 3.1 releases
     Jul 29 (~11:00 UTC+8 = 04:00 EU). Phase 2 flips Aug 19; the Sep 8 version
     boundary and the summer event's end are game8 estimates until 3.2 posts. */
  // --- events
  {
    game: 'zzz',
    name: 'Summer Waves Roll In — Fantasy Resort summer event',
    type: 'event',
    notify: false,
    start: '2026-07-29 04:00',
    end: '2026-09-08 05:59',
    notes: 'Summer flagship (beachcombing + souvenir shop). End approximate — verify in-game.',
    sourceKey: 'seed:zzz:3.1-summer-waves',
  },
  // --- banners
  {
    game: 'zzz',
    name: 'Remielle — Paradise Regained (flagship)',
    type: 'banner',
    notify: false,
    start: '2026-07-29 04:00',
    end: '2026-09-08 14:59',
    notes: 'Runs both phases of 3.1. End approximate — verify in-game.',
    sourceKey: 'seed:zzz:3.1-remielle',
  },
  {
    game: 'zzz',
    name: 'Aria — Neon Angel rerun (phase 1)',
    type: 'banner',
    start: '2026-07-29 04:00',
    end: '2026-08-19 11:59',
    sourceKey: 'seed:zzz:3.1-aria',
  },
  {
    game: 'zzz',
    name: 'Sigrid — Till the Ends of the Sky (phase 2)',
    type: 'banner',
    notify: false,
    start: '2026-08-19 12:00',
    end: '2026-09-08 14:59',
    notes: 'Phase 2 — verify in-game.',
    sourceKey: 'seed:zzz:3.1-sigrid',
  },
  {
    game: 'zzz',
    name: 'Exclusive Rescreening: Dialyn · Yuzuha · Harumasa (phase 2)',
    type: 'banner',
    notify: false,
    start: '2026-08-19 12:00',
    end: '2026-09-08 14:59',
    notes: 'Selectable rerun — verify in-game.',
    sourceKey: 'seed:zzz:3.1-rescreening',
  },

  /* ================================================== WUTHERING WAVES — v3.5 (Jul 10 – ~Aug 20,
     Mengzhou region, first SP character). Dates from game8's event list (12 Jul refresh);
     double-drop windows conflicted across sources — game8 kept, flagged where sources differ.
     Permanent additions (Shape of Yesterday, A Glimpse of Xuanfang) and web events excluded. */
  // --- events
  {
    game: 'wuwa',
    name: 'Gifts of Aftertune (login)',
    type: 'event',
    dailyTouch: true,
    start: '2026-07-10 04:00',
    end: '2026-08-20 23:00',
    sourceKey: 'seed:wuwa:3.5-login',
  },
  {
    game: 'wuwa',
    name: 'Gifts of Starpath — free convenes',
    type: 'event',
    notify: false,
    start: '2026-07-10 04:00',
    end: '2026-08-20 23:00',
    sourceKey: 'seed:wuwa:3.5-gifts-starpath',
  },
  {
    game: 'wuwa',
    name: 'Mingshen Notices — commissions',
    type: 'event',
    notify: false,
    start: '2026-07-10 04:00',
    end: '2026-08-20 23:00',
    sourceKey: 'seed:wuwa:3.5-mingshen',
  },
  {
    game: 'wuwa',
    name: 'Lament Recon: Tacet Crisis',
    type: 'event',
    notify: false,
    start: '2026-07-11 04:00',
    end: '2026-08-20 23:00',
    sourceKey: 'seed:wuwa:3.5-lament',
  },
  {
    game: 'wuwa',
    name: 'Recaptured: Action Highlights',
    type: 'event',
    start: '2026-07-16 04:00',
    end: '2026-08-06 03:59',
    sourceKey: 'seed:wuwa:3.5-recaptured',
  },
  {
    game: 'wuwa',
    name: 'Bountiful Crescendo — double drops',
    type: 'event',
    dailyTouch: true,
    start: '2026-07-23 04:00',
    end: '2026-07-30 03:59',
    notes: 'Double leveling-material drops — plan Waveplates. One source says it runs to Aug 13 — verify in-game.',
    sourceKey: 'seed:wuwa:3.5-crescendo',
  },
  {
    game: 'wuwa',
    name: 'Virtual Crisis: Quadrant Trials',
    type: 'event',
    start: '2026-07-30 04:00',
    end: '2026-08-20 23:00',
    sourceKey: 'seed:wuwa:3.5-quadrant',
  },
  {
    game: 'wuwa',
    name: 'Lollo Campaign: New Journey',
    type: 'event',
    notify: false,
    start: '2026-08-06 04:00',
    end: '2026-08-20 23:00',
    notes: 'Stamp roulette.',
    sourceKey: 'seed:wuwa:3.5-lollo',
  },
  {
    game: 'wuwa',
    name: 'Chord Cleansing — double echo drops',
    type: 'event',
    dailyTouch: true,
    start: '2026-08-12 04:00',
    end: '2026-08-20 03:59',
    notes: 'Double echo drops — plan Waveplates. One source says Aug 6 start — verify in-game.',
    sourceKey: 'seed:wuwa:3.5-chord',
  },
  // --- banners
  {
    game: 'wuwa',
    name: 'Yangyang: Xuanling + signature weapon (phase 1)',
    type: 'banner',
    start: '2026-07-10 04:00',
    end: '2026-07-31 09:59',
    notes: 'First SP character.',
    sourceKey: 'seed:wuwa:3.5-xuanling',
  },
  {
    game: 'wuwa',
    name: 'Lynae & Luuk Herssen reruns (phase 1)',
    type: 'banner',
    start: '2026-07-10 04:00',
    end: '2026-07-31 09:59',
    sourceKey: 'seed:wuwa:3.5-p1-reruns',
  },
  {
    game: 'wuwa',
    name: 'Starpath Reverbs Convene — selectable 1.x rerun',
    type: 'banner',
    start: '2026-07-10 04:00',
    end: '2026-08-20 23:00',
    notes: 'Jiyan/Yinlin/Jinhsi/Changli/Zhezhi/Xiangli Yao; free first 10-pull.',
    sourceKey: 'seed:wuwa:3.5-starpath',
  },
  {
    game: 'wuwa',
    name: 'Suisui + Aemeath rerun (phase 2)',
    type: 'banner',
    start: '2026-07-31 10:00',
    end: '2026-08-20 23:00',
    sourceKey: 'seed:wuwa:3.5-p2',
  },
  // --- maintenance
  {
    game: 'wuwa',
    name: 'v3.6 update maintenance',
    type: 'maintenance',
    start: '2026-08-20 23:00',
    end: '2026-08-21 04:00',
    notes: 'Timing approximate until announced.',
    sourceKey: 'seed:wuwa:3.6-maint',
  },

  /* ================================================== NEVERNESS TO EVERNESS — v1.2 (Jul 8 – Aug 19).
     Dates from nte.wiki's 1.2 calendar, cross-checked with gamewith/icy-veins. Hotta doesn't
     publish exact flip times; boundaries use the 05:00 daily reset. Permanent additions
     (999 Nights, Riichi Mahjong, Fish Tank, Mews Flash) excluded. */
  // --- events
  {
    game: 'nte',
    name: '1.2 login — 10 Solid Dice',
    type: 'event',
    dailyTouch: true,
    start: '2026-07-08 05:00',
    end: '2026-07-15 05:00',
    notes: '7-day login. The free S-class pick is a separate one-time claim in-game.',
    sourceKey: 'seed:nte:1.2-login',
  },
  {
    game: 'nte',
    name: 'Stamina Recharge ×2',
    type: 'event',
    dailyTouch: true,
    start: '2026-07-13 05:00',
    end: '2026-07-20 05:00',
    notes: 'Double stamina rewards — spend Pixels here.',
    sourceKey: 'seed:nte:1.2-stamina',
  },
  {
    game: 'nte',
    name: 'Shadow-N-Seek',
    type: 'event',
    notify: false,
    start: '2026-07-17 05:00',
    end: '2026-08-19 05:00',
    notes: 'Prop-hunt multiplayer.',
    sourceKey: 'seed:nte:1.2-shadow',
  },
  {
    game: 'nte',
    name: 'Gold Clash — 2× Fons in Pink Paws Heist',
    type: 'event',
    dailyTouch: true,
    start: '2026-07-20 05:00',
    end: '2026-08-03 05:00',
    notes: 'One source says Jul 18 – Aug 1 — verify in-game.',
    sourceKey: 'seed:nte:1.2-goldclash',
  },
  {
    game: 'nte',
    name: 'Going, Going, Gone! (auction)',
    type: 'event',
    notify: false,
    start: '2026-07-29 05:00',
    end: '2026-08-19 05:00',
    sourceKey: 'seed:nte:1.2-auction',
  },
  {
    game: 'nte',
    name: 'Fishing Frenzy',
    type: 'event',
    notify: false,
    start: '2026-08-03 05:00',
    end: '2026-08-19 05:00',
    sourceKey: 'seed:nte:1.2-fishing',
  },
  {
    game: 'nte',
    name: 'Pixel Surge',
    type: 'event',
    dailyTouch: true,
    start: '2026-08-03 05:00',
    end: '2026-08-10 05:00',
    sourceKey: 'seed:nte:1.2-pixelsurge',
  },
  {
    game: 'nte',
    name: 'Warren Lucky Flip',
    type: 'event',
    dailyTouch: true,
    start: '2026-08-05 05:00',
    end: '2026-08-19 05:00',
    sourceKey: 'seed:nte:1.2-luckyflip',
  },
  {
    game: 'nte',
    name: 'Fons Rush',
    type: 'event',
    dailyTouch: true,
    start: '2026-08-10 05:00',
    end: '2026-08-17 05:00',
    sourceKey: 'seed:nte:1.2-fonsrush',
  },
  // --- cycles
  {
    game: 'nte',
    name: 'Beyond the Rails — 1.2 season',
    type: 'cycle',
    start: '2026-07-16 05:00',
    end: '2026-07-30 05:00',
    notes: 'Per-version endgame window.',
    sourceKey: 'seed:nte:1.2-rails',
  },
  // --- banners
  {
    game: 'nte',
    name: 'Shinku — Before the Dawn (+ Blushing Mirage arc)',
    type: 'banner',
    start: '2026-07-08 05:00',
    end: '2026-07-29 05:00',
    notes: 'Flip time approximate (reset-aligned).',
    sourceKey: 'seed:nte:1.2-shinku',
  },
  {
    game: 'nte',
    name: 'Iroi — The Lifeline (+ The Wrong Gate arc, phase 2)',
    type: 'banner',
    start: '2026-07-29 05:00',
    end: '2026-08-19 05:00',
    notes: 'One source lists Aug 12 end — verify in-game.',
    sourceKey: 'seed:nte:1.2-iroha',
  },
  // --- maintenance
  {
    game: 'nte',
    name: 'v1.3 update maintenance',
    type: 'maintenance',
    start: '2026-08-19 00:00',
    end: '2026-08-19 05:00',
    notes: 'Timing approximate until announced.',
    sourceKey: 'seed:nte:1.3-maint',
  },
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
      if (
        existing.gameId === game.id &&
        (existing.start !== start || existing.end !== end || existing.name !== seed.name)
      ) {
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
