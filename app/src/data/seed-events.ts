import { DateTime } from 'luxon';
import type { AppState, EventType, Game, GameEvent } from '@memoria/shared';
import { presetForGame } from '@memoria/shared';

/**
 * Bundled event feed — current banners/events per game, refreshed by asking
 * Claude after each patch (it reads the official HoYo announcement feeds and
 * patch notes, then rewrites this file). The store imports missing entries
 * automatically whenever local state loads.
 *
 * Times are strings in the game's SERVER time and converted with the game's
 * configured tz at import, so they stay correct on any server region.
 * HoYo feed items reuse the ⤓ HoYoLAB sourceKey (`genshin:<ann_id>`) so the
 * two import paths dedupe against each other.
 *
 * READING A HOYO NOTICE — the rule earlier refreshes got half right. The
 * announcement API answers the same date strings for every region but reports
 * a different `data.timezone` (os_euro → 1, os_asia → 8, os_usa → -5), and the
 * bodies tag each time with its own class:
 *   - `t_lc` (LOCAL) wraps event, banner and BP durations. Every server sees
 *     that same wall clock, which is why these end at 03:59 — one minute
 *     before the 04:00 daily reset, itself server-local. Copy `t_lc` values
 *     STRAIGHT ACROSS to the Europe rows. Do not shift them.
 *   - `t_gl` (GLOBAL) wraps the maintenance schedule, one absolute moment
 *     quoted in UTC+8. That one DOES need -7h for a UTC+1 row.
 * Subtracting 7h from a `t_lc` value was the bug that put the whole 7.0 banner
 * slate three hours early. When in doubt, check which class the notice used.
 *
 * Rebuilt from scratch 2026-07-12, cross-checked against the official HoYo
 * announcement feeds, game8's per-game event calendars, nte.wiki and the
 * fandom wikis. Refreshed 2026-07-20: added the ZZZ v3.1 slate revealed in the
 * 3.1 livestream (releases Jul 29) and corrected the NTE phase-2 name to Iroi;
 * Genshin 6.7 / HSR 4.4 / WuWa 3.5 were mid-patch with no new announcements.
 *
 * Refreshed 2026-08-07 against the official feeds, one game at a time. What
 * that pass changed, beyond adding four games:
 *   - There is no Genshin 6.8. The next version is 7.0 "Everwinter Without
 *     Mercy", on 2026-08-12.
 *   - Spiral Abyss resets on the 16th, not the 15th, and only once a month
 *     (the twice-monthly schedule ended in June 2024).
 *   - ZZZ's whole v3.1 slate is now published, so the game8 estimates are gone.
 *   - WuWa 3.5 ends on Aug 19, not Aug 20.
 *   - Several HSR and WuWa windows close at 14:59/11:59, not at the
 *     maintenance hour; a banner shuts before the servers do.
 *
 * Refreshed 2026-08-09 against the official HoYo announcement APIs (the same
 * feeds the `<game>:<ann_id>` sourceKeys come from). What that pass changed:
 *   - Stygian Onslaught opened 2026-07-06 12:00, not 07-08 10:00, and is an
 *     official notice rather than an estimate.
 *   - "When We Look Up at the Moon" is ann 21750 opening 06-29 12:00 (it was
 *     filed under 21741 / 07-01), and "To Temper Thyself" Cycle 5 is ann 21761
 *     opening 08-08 12:00 — both were placeholder guesses.
 *   - Every recurring cycle now reuses ONE name per mode, with the rotation's
 *     own title in `notes`. Names like "— current phase" both went stale on
 *     their own and broke buildCycleConnectorPaths, which groups instances by
 *     exact name: no two HSR or ZZZ windows were ever being connected.
 *   - There is still no Genshin 7.0 slate: the feed has not published one.
 *
 * Refreshed 2026-08-17/18, one game at a time, against each publisher's own
 * feed. All nine games rebuilt.
 *
 * PUBLISHERS DO NOT SHARE A CONVENTION. Per-game notes live in each block, but
 * the shape of the problem is: HoYo tags times `t_lc`/`t_gl`; ZZZ spells the
 * same split `(server time)` vs `(UTC+8)`; Kuro splits it by notice TYPE
 * (maintenance global, convenes local); Perfect World mixes both inside ONE
 * notice; Endfield splits it inside a single LINE (opens local, ends global);
 * LADS is local throughout; Uma and NIKKE are single-service so the question
 * does not arise. Never carry one game's rule to another.
 *
 * Two failure modes produced most of the errors found on this pass, and both
 * are easy to repeat:
 *   1. Inventing an end date for content that has none. HSR's Fate collab warp
 *      is explicitly permanent and was carrying a fabricated close.
 *   2. Copying a previous season's LENGTH onto a new one. That produced Uma's
 *      Virgo Cup (4 days late), LADS' phantom 45-day Hunter Contest season, and
 *      ZZZ's Deadly Assault close (2 days early — it ran a 16-day stretch
 *      season to re-align to Fridays).
 * If a notice does not state a boundary, say so with notify:false. Do not
 * derive one from last time.
 *
 * The headline finding is the t_lc/t_gl rule above. It is not cosmetic: it was
 * silently shifting whole slates. What else this pass changed:
 *   - GENSHIN: the v7.0 slate is published, so the placeholder guesses became
 *     real rows with ann_ids. Phase 1 runs to 09-01 17:59, NOT the 14:59 that
 *     was extrapolated from the old (wrong) blanket -7h rule.
 *   - getAnnList `start_time` is when the NOTICE appears, up to two days ahead
 *     of the window itself. Trust the 〓Duration〓 line in the BODY. That alone
 *     fixed Genshin's "To Temper Thyself" (opens 08-10 04:00, not 08-08 12:00)
 *     and HSR's Fate Gift (opens with the collab on 07-24, not with 4.4).
 *   - HSR: the old note here claimed HSR has no public feed. It does. Anomaly
 *     Arbitration turned out to be VERSION-ALIGNED, not a 6-week cycle, and the
 *     Fate collab warp is PERMANENT — its invented end date is gone.
 *   - Shipping an invented end for permanent content, and copying a previous
 *     season's length onto a new one, were the two recurring failure modes.
 *     They produced: HSR's Fate warp, LADS' phantom "45-day" Hunter Contest
 *     season, and Uma's Virgo Cup close (4 days late, copied from the 2025 cup).
 *   - Recurring cycles now share ONE bare name with the season in `notes`, in
 *     LADS, Uma, NIKKE and Endfield too. Season-suffixed names never grouped,
 *     so no connector was ever drawn for those four.
 *
 * Refreshed 2026-08-27 (gpt-5.6-luna, web research) against each publisher's
 * feed again, and this pass ADDS THE LIVESTREAM ROW. What changed:
 *   - GENSHIN: the 7.0 phase-1 slate verified clean — Odette, Arlecchino and
 *     the Epitome rerun all confirmed against the notice. Stygian Onslaught's
 *     v7.0 rotation actually opens 08-19 10:00, not the 08-17 12:00 carried
 *     here. Five 7.0 events were missing entirely (Raiment Collection, Event
 *     Ode, both Miliastra Wonderland phases, Forge Realm's Temper).
 *   - HSR: the whole 4.5 slate stops being an estimate. v4.5 is a SHORT 33-day
 *     version, not the usual 42, and the notice shortens Apocalyptic Shadow and
 *     Pure Fiction to 5 weeks with it: they close 10-05 and 10-19, not 10-12 and
 *     10-26. Minuscule Great Adventure opens 09-12 12:00, not with the version.
 *     The 4.6 boundary carried here (09-27 23:00) was already right — a first
 *     research pass called it wrong by reading a t_gl time as t_lc, which is the
 *     same seven-hour trap this header has warned about since July.
 *   - WUWA / NTE: 3.6 and 1.3 both have full official notices now, so almost
 *     every estimated row in those two blocks became fact.
 *   - ZZZ: six 3.1 events were missing, and the 3.2 Special Program has an
 *     official date.
 *
 * THE LIVESTREAM ROW. Every one of these games reveals its next version in a
 * broadcast a week or two before the patch, and that broadcast is the cue to
 * refresh this file. So each game that HAS one now carries a 'livestream' row.
 *   - When the date is announced, the row is the broadcast itself.
 *   - When it is not, the row is the PLAUSIBLE RANGE, derived from where the
 *     last 4-6 streams sat relative to their releases — start = earliest, end =
 *     latest. The name says "predicted window" so the bar cannot be mistaken
 *     for a fixture, and `notes` carries the offsets it was derived from.
 * This is the one deliberate exception to the notify rule below: a predicted
 * livestream keeps notify:true even though its date is an estimate, because a
 * reminder that never fires is the one thing it cannot afford to be. The name
 * carries the uncertainty instead of the flag.
 * LADS, Uma and NIKKE have NO recurring patch broadcast — news posts only — so
 * they get no livestream row rather than an invented one.
 *
 * A livestream is a single global moment, like `t_gl` maintenance, and is
 * stored here as the Europe (UTC+1) wall clock. Per-account tz conversion at
 * import will shift it for a non-EU server, exactly as it already does for
 * maintenance; that is a known limit of the one-clock-per-row model, not a
 * per-row error.
 *
 * Categories: 'event' (play these), 'cycle' (recurring endgame
 * windows — Abyss/Theater, MoC/PF/AS/AA, Shiyu/DA), 'banner' (pulls),
 * 'maintenance' (patch downtime), 'livestream' (the next-version broadcast).
 * Web-only and permanent content is excluded.
 *
 * `notify: false` is the honesty valve. Anything whose date came from a
 * community estimate rather than an official notice carries it, plus a note
 * saying so, so an approximate window never fires an alert as if it were fact.
 */

/** When the bundled data was last refreshed. */
export const SEED_UPDATED = '2026-08-27';

export interface SeedEvent {
  /** Preset key — matched against the stored preset id, with legacy name/short fallbacks. */
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
     Jul 1 – Aug 12, then v7.0 "Everwinter Without Mercy". There is no 6.8: HoYoverse
     skipped from 6.7 straight to 7.0, announced in the Jul 31 Special Program.
     Events/banners from the official announcement feed (exact server times); Abyss and
     Theater from the fandom wiki. Both run permanently and reset ONCE a month — Abyss on
     the 16th, Theater on the 1st. The twice-monthly Abyss ended in June 2024. */
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
    start: '2026-08-03 04:00',
    end: '2026-08-10 03:59',
    notes: 'Three double Ley Line claims a day — plan resin.',
    sourceKey: 'seed:genshin:6.7-leyline',
  },
  {
    game: 'genshin',
    name: 'When We Look Up at the Moon',
    type: 'event',
    start: '2026-06-29 12:00',
    end: '2026-09-22 14:59',
    notes: 'Long-runner worth 400 Primogems — outlives 6.7 entirely.',
    sourceKey: 'genshin:21750',
  },
  {
    game: 'genshin',
    name: 'To Temper Thyself and Journey Far — Cycle 5',
    type: 'event',
    // 〓Event Duration〓 in ann 21761 reads 2026/08/10 04:00 - 2026/11/02 03:59.
    // The old 08-08 12:00 was getAnnList's start_time — when the NOTICE went up.
    start: '2026-08-10 04:00',
    end: '2026-11-02 03:59',
    notes: 'Train on 5 days a week, 8 weeks out of 12, for a free standard 5★ constellation.',
    sourceKey: 'genshin:21761',
  },
  // --- cycles
  {
    game: 'genshin',
    name: 'Stygian Onslaught',
    type: 'cycle',
    start: '2026-07-06 12:00',
    end: '2026-08-11 03:59',
    notes: 'v6.7 rotation. Condensed Resin counts 60 Dire Prestige each.',
    sourceKey: 'genshin:21168',
  },
  {
    game: 'genshin',
    name: 'Stygian Onslaught',
    type: 'cycle',
    start: '2026-08-19 10:00',
    end: '2026-09-22 03:59',
    notes:
      'v7.0 rotation: Disturbance-affected Ley Line challenges. Opens 08-19 10:00 — the 08-17 12:00 carried before was the notice date, not the window.',
    sourceKey: 'genshin:21847',
  },
  // Abyss and Theater BOTH run permanently. Abyss resets the 16th, Theater the 1st.
  {
    game: 'genshin',
    name: 'Spiral Abyss',
    type: 'cycle',
    start: '2026-06-16 04:00',
    end: '2026-07-16 03:59',
    notes: 'Resets the 16th, monthly.',
    sourceKey: 'seed:genshin:abyss-2026-06',
  },
  {
    game: 'genshin',
    name: 'Spiral Abyss',
    type: 'cycle',
    start: '2026-07-16 04:00',
    end: '2026-08-16 03:59',
    notes: 'Resets the 16th, monthly.',
    sourceKey: 'seed:genshin:abyss-2026-07',
  },
  {
    game: 'genshin',
    name: 'Spiral Abyss',
    type: 'cycle',
    notify: false,
    start: '2026-08-16 04:00',
    end: '2026-09-16 03:59',
    notes: 'Resets the 16th, monthly.',
    sourceKey: 'seed:genshin:abyss-2026-08',
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
  // Wishes close at 14:59, hours before the servers go down — an end set to the
  // maintenance hour would quietly promise pulls that are no longer buyable.
  {
    game: 'genshin',
    name: 'Columbina — Somnias a Luna (phase 2)',
    type: 'banner',
    start: '2026-07-21 18:00',
    end: '2026-08-11 14:59',
    sourceKey: 'seed:genshin:6.7-columbina',
  },
  {
    game: 'genshin',
    name: 'Raiden Shogun — Reign of Serenity (phase 2)',
    type: 'banner',
    start: '2026-07-21 18:00',
    end: '2026-08-11 14:59',
    sourceKey: 'seed:genshin:6.7-raiden',
  },
  {
    game: 'genshin',
    name: "Epitome Invocation — Nocturne's Curtain Call / Engulfing Lightning (phase 2)",
    type: 'banner',
    start: '2026-07-21 18:00',
    end: '2026-08-11 14:59',
    sourceKey: 'seed:genshin:6.7-epitome-p2',
  },
  // --- maintenance
  // The key still says 6.8 on purpose: anyone who imported this seed already has
  // an event under that key, and keeping it lets the refresh rename that event
  // in place instead of leaving a phantom 6.8 beside the real 7.0.
  {
    game: 'genshin',
    name: 'v7.0 "Everwinter Without Mercy" update maintenance',
    type: 'maintenance',
    // ann 21857 〓Update Schedule〓: t_gl 2026/08/12 06:00, "estimated to take 5
    // hours". t_gl is absolute UTC+8, so -7h lands the Europe row here.
    start: '2026-08-11 23:00',
    end: '2026-08-12 04:00',
    sourceKey: 'seed:genshin:6.8-maint',
  },
  /* --- v7.0 (Aug 12 onward). The slate is published now, so these rows carry
     real ann_ids and real times instead of the reset-aligned guesses they had
     on 08-09. Everything below opens "After the Version 7.0 update", i.e. when
     the t_gl maintenance above finishes: 08-12 04:00 on the Europe clock. */
  {
    game: 'genshin',
    name: "Odette — Swan's Shadow in Silken Ice (phase 1)",
    type: 'banner',
    start: '2026-08-12 04:00',
    end: '2026-09-01 17:59',
    sourceKey: 'seed:genshin:7.0-p1',
  },
  {
    game: 'genshin',
    name: "Arlecchino — The Hearth's Ashen Shadow (phase 1)",
    type: 'banner',
    start: '2026-08-12 04:00',
    end: '2026-09-01 17:59',
    sourceKey: 'genshin:21804',
  },
  {
    game: 'genshin',
    name: 'Epitome Invocation — Whitelake Frostfeather / Crimson Moon’s Semblance (phase 1)',
    type: 'banner',
    start: '2026-08-12 04:00',
    end: '2026-09-01 17:59',
    sourceKey: 'genshin:21807',
  },
  {
    game: 'genshin',
    name: 'Flins & Ineffa (phase 2)',
    type: 'banner',
    notify: false,
    start: '2026-09-01 18:00',
    end: '2026-09-22 14:59',
    notes: 'Phase 2 is not in the feed yet — line-up and times unconfirmed.',
    sourceKey: 'seed:genshin:7.0-p2',
  },
  {
    game: 'genshin',
    name: 'Mutual Aid in Bloom: Into the Frostlands',
    type: 'event',
    start: '2026-08-12 04:00',
    end: '2026-08-24 03:59',
    notes: '7.0 flagship: Snezhnaya Expedition Operation.',
    sourceKey: 'seed:genshin:7.0-frostlands',
  },
  {
    game: 'genshin',
    name: 'The Godforsaken Frostlands — Snezhnaya exploration',
    type: 'event',
    start: '2026-08-12 04:00',
    end: '2026-11-03 14:59',
    notes: 'Five new Snezhnaya areas, 400 Primogems. Long-runner — outlives 7.0.',
    sourceKey: 'genshin:21811',
  },
  {
    game: 'genshin',
    name: 'Frostfarer — Battle Pass',
    type: 'event',
    notify: false,
    start: '2026-08-12 04:00',
    end: '2026-09-21 03:59',
    notes: 'Gnostic Hymn/Chorus purchasing closes an hour earlier, at 02:59.',
    sourceKey: 'genshin:21818',
  },
  {
    game: 'genshin',
    name: 'Great Expeditionist Challenge — free Diona',
    type: 'event',
    notify: false,
    start: '2026-08-28 10:00',
    end: '2026-09-14 03:59',
    notes: 'Dates approximate — verify in-game.',
    sourceKey: 'seed:genshin:7.0-expeditionist',
  },
  {
    game: 'genshin',
    name: 'Overflowing Abundance — double drops',
    type: 'event',
    dailyTouch: true,
    notify: false,
    start: '2026-09-14 10:00',
    end: '2026-09-21 03:59',
    notes: 'Dates approximate — verify in-game.',
    sourceKey: 'seed:genshin:7.0-abundance',
  },
  {
    game: 'genshin',
    name: 'Event Ode: Phantasmagoric Discourse',
    type: 'event',
    start: '2026-08-12 04:00',
    end: '2026-09-22 14:59',
    notes: 'Runs the whole of 7.0.',
    sourceKey: 'seed:genshin:7.0-event-ode',
  },
  {
    game: 'genshin',
    name: 'Raiment Collection: Gentle Warmth',
    type: 'event',
    start: '2026-08-12 04:00',
    end: '2026-09-23 05:59',
    notes: 'Outfit campaign — closes an hour past the version boundary.',
    sourceKey: 'seed:genshin:7.0-raiment',
  },
  {
    game: 'genshin',
    name: 'Miliastra Wonderland: Chronicle',
    type: 'event',
    start: '2026-08-12 04:00',
    end: '2026-09-21 03:59',
    sourceKey: 'seed:genshin:7.0-miliastra-chronicle',
  },
  {
    game: 'genshin',
    name: 'Miliastra Wonderland: Phantasmagoric Season — Play Phase',
    type: 'event',
    start: '2026-08-13 10:00',
    end: '2026-09-22 03:59',
    notes: 'Play phase; the showcase phase follows it.',
    sourceKey: 'seed:genshin:7.0-miliastra-play',
  },
  {
    game: 'genshin',
    name: "The Forge Realm's Temper: Game of Wits",
    type: 'event',
    notify: false,
    start: '2026-08-12 04:00',
    end: '2026-09-22 14:59',
    notes: 'Official notice states it runs during 7.0 but gives no closing time — the version boundary is assumed.',
    sourceKey: 'seed:genshin:7.0-forge-realm',
  },
  {
    game: 'genshin',
    name: 'Imaginarium Theater',
    type: 'cycle',
    notify: false,
    start: '2026-09-01 04:00',
    end: '2026-10-01 03:59',
    notes: 'Resets the 1st, monthly. September season confirmed open; close is the monthly cadence.',
    sourceKey: 'seed:genshin:theater-2026-09',
  },

  /* ================================================== HONKAI: STAR RAIL — v4.4 "In Ravages
     Does the Whistle Sound" (Fate collab, Jul 15 – Aug 25), then v4.5 "Nameless Honor" on
     Aug 26. The old note here claimed HSR's public feed is empty and fell back to game8.
     That is wrong: the announcement API works, and the 08-17 pass sourced this block from
     it directly. Two structural traps:
       - HSR splits the feed into `data.list` (Notices) and `data.pic_list` (News), and the
         WARP notices live only in pic_list. Reading only `list` sees no banners.
       - The t_lc/t_gl tags arrive HTML-ESCAPED inside the JSON. Unescape first; a plain
         search for `t_lc` matches nothing and silently drops every tag.
     One duration carries both tags — MoC Stormcleanse opens at a t_lc reset and closes at
     the t_gl version end — which is the cleanest proof of the rule in any of these feeds.

     ENDGAME CADENCE, corrected: MoC / Pure Fiction / Apocalyptic Shadow run 6 weeks,
     staggered. Anomaly Arbitration does NOT — it refreshes with the version. The two
     models agreed for 4.4 (a 6-week version) and diverge from 08-26.

     v4.5's update notice has not published; it is due ~08-25/26. Its END boundary is
     already recoverable from three live notices (t_gl 2026/09/28 06:00 → 09-27 23:00), so
     4.5 rows carry real bounds but press-sourced phase dates, and stay silent. Re-run
     after 08-26 to replace them with first-party times. */
  // --- events
  {
    game: 'hsr',
    name: 'Stellar Companion — free 5★ selector',
    type: 'event',
    notify: false,
    start: '2026-04-22 04:00',
    end: '2026-08-25 23:00',
    notes:
      'Free 5★ selector, expires with 4.4 — "Before Version 4.4 ends" in the notice, resolved through the t_gl version end. The START is inherited from the expired 4.2 notice and could not be re-verified.',
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
    notes:
      '7-day login. The notice names it but prints no time tags — these boundaries are the version window, not the event notice.',
    sourceKey: 'seed:hsr:4.4-login',
  },
  {
    game: 'hsr',
    name: 'Fate Gift — free collab Light Cone',
    type: 'event',
    dailyTouch: true,
    // Gated on the collab Warp opening, not on the version — the file had it
    // opening with 4.4, nine days early.
    start: '2026-07-24 12:00',
    end: '2026-08-25 23:00',
    notes: 'Login gift alongside the collab.',
    sourceKey: 'seed:hsr:4.4-fate-gift',
  },
  {
    game: 'hsr',
    name: 'Antigraft Brickbuster (flagship)',
    type: 'event',
    start: '2026-07-15 04:00',
    end: '2026-08-25 20:59',
    sourceKey: 'seed:hsr:4.4-brickbuster',
  },
  {
    game: 'hsr',
    name: 'Fate/Star Rail Night — collab event',
    type: 'event',
    start: '2026-07-24 12:00',
    end: '2026-08-25 20:59',
    sourceKey: 'seed:hsr:4.4-fate-event',
  },
  {
    game: 'hsr',
    name: 'Fate Contract: Renewal — free Gilgamesh or Archer',
    type: 'event',
    notify: false,
    start: '2026-07-24 12:00',
    end: '2026-11-17 23:00',
    notes:
      'Notice says only "Before the end of Version 4.6", and 4.6 has no published end. 4.6 opens 09-28, so a 6-week run would close around 11-08 — this end is likely ~a week long. Left as the older estimate rather than swapped for a fresher guess.',
    sourceKey: 'seed:hsr:4.4-free-servant',
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
    name: 'Apocalyptic Shadow',
    type: 'cycle',
    start: '2026-07-20 04:00',
    end: '2026-08-31 03:59',
    notes: 'Vanguard Knight.',
    sourceKey: 'seed:hsr:as-4.4',
  },
  {
    game: 'hsr',
    name: 'Pure Fiction',
    type: 'cycle',
    start: '2026-08-03 04:00',
    end: '2026-09-14 03:59',
    notes: 'Fabricated Business.',
    sourceKey: 'seed:hsr:pf-4.4',
  },
  {
    game: 'hsr',
    name: 'Memory of Chaos',
    type: 'cycle',
    start: '2026-08-17 04:00',
    end: '2026-09-27 23:00',
    notes: 'Stormcleanse. Opens today. Start is t_lc, end is the t_gl version boundary.',
    sourceKey: 'seed:hsr:moc-4.5',
  },
  {
    game: 'hsr',
    name: 'Anomaly Arbitration',
    type: 'cycle',
    notify: false,
    // AA is VERSION-ALIGNED, not a 6-week staggered cycle like the other three.
    // The old row modelled it on the stagger and was wrong at both ends. The two
    // models happened to agree for 4.4 (a 6-week version) and diverge from 08-26.
    start: '2026-07-15 04:00',
    end: '2026-08-25 23:00',
    notes:
      'Enwreathed by the World. Refreshes with the version update, not on the Treasures Lightward stagger. Theme is official; the exact boundaries are never printed.',
    sourceKey: 'seed:hsr:aa-4.4',
  },
  // --- banners
  // Warps close at 15:00, eight hours before the 4.5 maintenance.
  {
    game: 'hsr',
    name: 'Himeko • Nova (runs all of 4.4)',
    type: 'banner',
    start: '2026-07-15 04:00',
    end: '2026-08-25 15:00',
    sourceKey: 'seed:hsr:4.4-himeko-nova',
  },
  {
    game: 'hsr',
    name: 'A Star That Lights the Night — Light Cone Warp',
    type: 'banner',
    start: '2026-07-15 04:00',
    end: '2026-08-25 15:00',
    sourceKey: 'seed:hsr:4.4-himeko-lc',
  },
  {
    game: 'hsr',
    name: 'Cerydra · Anaxa · Aventurine reruns (phase 2)',
    type: 'banner',
    start: '2026-08-05 12:00',
    end: '2026-08-25 15:00',
    sourceKey: 'seed:hsr:4.4-p2-reruns',
  },
  {
    game: 'hsr',
    name: 'Phase 2 Light Cone Warps — Golden Blood · Cast to Flames · Unjust Destiny',
    type: 'banner',
    start: '2026-08-05 12:00',
    end: '2026-08-25 15:00',
    sourceKey: 'seed:hsr:4.4-p2-lc',
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
  {
    game: 'hsr',
    name: 'v4.5 update maintenance',
    type: 'maintenance',
    start: '2026-08-25 23:00',
    end: '2026-08-26 04:00',
    notes:
      'Both ends are sourced now, not folklore: the start is t_gl 2026/08/26 06:00 minus 7h, and "approximately 5 hours" is HoYo\'s own printed figure.',
    sourceKey: 'seed:hsr:4.5-maint',
  },
  {
    game: 'hsr',
    name: 'v4.6 update maintenance',
    type: 'maintenance',
    start: '2026-09-27 23:00',
    end: '2026-09-28 04:00',
    notes:
      'Start is the officially printed end of 4.5 (t_gl 2026/09/28 06:00). Game8 projects 4.6 opening Sep 29 off a 6-week assumption — the first-party value wins.',
    sourceKey: 'seed:hsr:4.6-maint',
  },
  /* --- v4.5 "Nameless Honor" (Aug 26 – Sep 27). The update notice has published, so the
     phase-1 rows below are no longer estimates.

     v4.5 IS A SHORT VERSION — 33 days between maintenance handoffs, not the 42 that 4.4→4.5
     ran. The notice says so outright: "Due to the duration adjustment of Version 4.5, the
     duration of Apocalyptic Shadow and Pure Fiction for this period will be shortened to 5
     weeks." Do not "fix" this back to a 6-week cadence on the next pass.

     The version line is t_gl — "until 2026/09/28 06:00 (UTC+8)" = 09-27 23:00 here. The
     Apocalyptic Shadow and Pure Fiction lines are t_lc and copy across unshifted, which is
     why they outlive the version and run on into 4.6. Overdrive's "2026/09/28 03:59 (UTC+8)"
     is likewise t_gl and lands at 09-27 20:59, NOT 09-28 03:59: reading that one as t_lc is
     the exact mistake that would push the whole 4.5 slate seven hours late. */
  {
    game: 'hsr',
    name: 'Overdrive: Whirlwind Grand Prix (flagship)',
    type: 'event',
    start: '2026-08-26 04:00',
    end: '2026-09-27 20:59',
    notes:
      'Flagship 4.5 event, on an official notice. Closes 2h01 before maintenance, not at it.',
    sourceKey: 'seed:hsr:4.5-overdrive',
  },
  {
    game: 'hsr',
    name: '4.5 Gift of Odyssey — 10 free pulls',
    type: 'event',
    dailyTouch: true,
    start: '2026-08-26 04:00',
    end: '2026-09-27 23:00',
    notes: '7-day login, on an official notice. Claim all ten pulls well before the version closes.',
    sourceKey: 'seed:hsr:4.5-login',
  },
  {
    game: 'hsr',
    name: 'Minuscule Great Adventure',
    type: 'event',
    start: '2026-09-12 12:00',
    end: '2026-09-27 20:59',
    notes:
      'Opens with phase 2, NOT with the version — the old 08-26 start assumed the version window. Spelled "Miniscule" on some trackers.',
    sourceKey: 'seed:hsr:4.5-minuscule',
  },
  {
    game: 'hsr',
    name: 'Anomaly Arbitration',
    type: 'cycle',
    notify: false,
    start: '2026-08-26 04:00',
    end: '2026-09-27 23:00',
    notes: 'Version-aligned. 4.5 rotation theme not yet announced.',
    sourceKey: 'seed:hsr:aa-4.5',
  },
  {
    game: 'hsr',
    name: 'Apocalyptic Shadow',
    type: 'cycle',
    start: '2026-08-31 04:00',
    end: '2026-10-05 03:59',
    notes:
      'Celestial Lupine. Officially SHORTENED to 5 weeks because v4.5 itself is short — the old 10-12 close assumed the usual 6.',
    sourceKey: 'seed:hsr:as-4.5',
  },
  {
    game: 'hsr',
    name: 'Pure Fiction',
    type: 'cycle',
    start: '2026-09-14 04:00',
    end: '2026-10-19 03:59',
    notes:
      'Domain Genesis. Officially SHORTENED to 5 weeks alongside Apocalyptic Shadow; both run on into v4.6.',
    sourceKey: 'seed:hsr:pf-4.5',
  },
  // Phase-swap times (11:59 / 12:00) and the 15:00 close copy the 4.4 handoff, which was
  // verified from t_lc. The 4.3 rows closed at maintenance instead, so this is a
  // convention rather than a rule — recheck when the 4.5 warp notice lands.
  {
    game: 'hsr',
    name: 'Robin • Summeretto · Hyacine rerun (phase 1)',
    type: 'banner',
    start: '2026-08-26 04:00',
    end: '2026-09-12 11:59',
    notes: 'Official 4.5 warp window — the estimated dates it carried turned out correct.',
    sourceKey: 'seed:hsr:4.5-p1-robin',
  },
  {
    game: 'hsr',
    name: 'Rise and Sing · Long May Rainbows Adorn the Sky — phase 1 Light Cone Warps',
    type: 'banner',
    start: '2026-08-26 04:00',
    end: '2026-09-12 11:59',
    notes: 'Official 4.5 warp window.',
    sourceKey: 'seed:hsr:4.5-p1-lc',
  },
  {
    game: 'hsr',
    name: 'Aventurine • Waveflair · Ashveil rerun (phase 2)',
    type: 'banner',
    notify: false,
    start: '2026-09-12 12:00',
    end: '2026-09-27 15:00',
    notes: 'Livestream/press estimate — no official Warp notice yet.',
    sourceKey: 'seed:hsr:4.5-p2-aventurine',
  },
  {
    game: 'hsr',
    name: 'Summer Rides the Surf · The Finale of a Lie — phase 2 Light Cone Warps',
    type: 'banner',
    notify: false,
    start: '2026-09-12 12:00',
    end: '2026-09-27 15:00',
    notes: 'Livestream/press estimate — no official Warp notice yet.',
    sourceKey: 'seed:hsr:4.5-p2-lc',
  },

  /* ================================================== ZENLESS ZONE ZERO — v3.1 "The Long
     Goodbye" (Jul 29 – Sep 8). The dead v3.0 block was dropped on the 08-17 pass: all 15
     rows had ended and none still appear in the live feed.

     ZZZ's notices carry NO t_lc/t_gl markup — the class rides in the text suffix instead,
     `(server time)` for LOCAL and `(UTC+8)` for GLOBAL. Same rule, different spelling.

     The version boundary is no longer a guess: ann 1234 states "Version 3.1 will run for
     42 days, ending on 2026/09/09 06:00 (UTC+8)" — GLOBAL, so -7h → 2026-09-08 23:00.
     Rows dated "End of Version 3.1" were already numerically right; what was wrong was
     calling them unsourced. They now notify.

     One trap for the next refresh: ZZZ files its BANNERS under `data.pic_list`, not
     `data.list`. A rebuild that reads only `list` silently loses every banner row. */
  // --- cycles. Both modes reset every 14 days. The 3.1 update forced Deadly Assault into
  // an early start, and it has since re-aligned to the Friday cadence via one 16-day
  // stretch season — so the two now alternate WEEKLY (Shiyu Aug 7/21, DA Aug 14/28)
  // rather than colliding. No official notice publishes either window: ann 1234 gives the
  // rotations and buff sets but no schedule, which is why every cycle row stays silent.
  {
    game: 'zzz',
    name: 'Deadly Assault',
    type: 'cycle',
    notify: false,
    start: '2026-07-29 04:00',
    end: '2026-08-14 03:59',
    notes:
      'Started early with the 3.1 update, then re-aligned to the Friday cadence — a 16-day stretch season, not the flat 14 days assumed before. Close follows from the next season opening 2026-08-14; community-sourced, verify in-game.',
    sourceKey: 'seed:zzz:da-2026-07-29',
  },
  {
    game: 'zzz',
    name: 'Shiyu Defense: Critical',
    type: 'cycle',
    notify: false,
    start: '2026-08-07 04:00',
    end: '2026-08-21 03:59',
    notes:
      'Critical Node, 3.1 Phase I buffs. No longer a bare cadence guess — community trackers reading the in-game timer give the next reset as 2026-08-21 04:00. Not an official notice; verify in-game.',
    sourceKey: 'seed:zzz:shiyu-2026-08-07',
  },
  {
    game: 'zzz',
    name: 'Deadly Assault',
    type: 'cycle',
    notify: false,
    start: '2026-08-14 04:00',
    end: '2026-08-28 03:59',
    notes:
      '3.1 Phase II rotation: Girtablullu / Ye Shiyuan the Thrall / Miasma Priest. Two independent community trackers agree on the window; no official notice. Verify in-game.',
    sourceKey: 'seed:zzz:da-2026-08-14',
  },
  {
    game: 'zzz',
    name: 'Shiyu Defense: Critical',
    type: 'cycle',
    notify: false,
    start: '2026-08-21 04:00',
    end: '2026-09-04 03:59',
    notes:
      '3.1 Phase II buffs. Start is community-confirmed; the close is the 14-day cadence and is NOT separately sourced. Verify in-game.',
    sourceKey: 'seed:zzz:shiyu-2026-08-21',
  },
  {
    game: 'zzz',
    name: 'Deadly Assault',
    type: 'cycle',
    notify: false,
    start: '2026-08-28 04:00',
    end: '2026-09-11 03:59',
    notes:
      'Start is the next reset per community trackers. The close is cadence only — and the v3.2 update on 09-08 may cut it early exactly as 3.1 did on 07-29. Provisional; verify in-game.',
    sourceKey: 'seed:zzz:da-2026-08-28',
  },
  // --- banners
  // --- maintenance
  {
    game: 'zzz',
    name: 'v3.1 update maintenance',
    type: 'maintenance',
    start: '2026-07-28 23:00',
    end: '2026-07-29 04:00',
    sourceKey: 'seed:zzz:3.1-maint',
  },
  /* --- v3.1 "The Long Goodbye" (Jul 29 – Sep 8). The full update notice is out,
     so the game8 estimates this block used to carry are gone: 3.1 opened at
     04:00 on Jul 29 and the version ends 2026-09-08 23:00. Phase 2 flips Aug 19.
     Several events are dated only "end of version" in the notice; those carry
     the version boundary and stay silent. */
  // --- events
  {
    game: 'zzz',
    name: 'Summer Waves Roll In — Fantasy Resort summer event',
    type: 'event',
    start: '2026-07-29 04:00',
    end: '2026-09-07 03:59',
    notes: 'Summer flagship: Lucy outfit, namecard, Hamster Cage.',
    sourceKey: 'seed:zzz:3.1-summer-waves',
  },
  {
    game: 'zzz',
    name: 'Gift From the Clouds — 10 free tapes',
    type: 'event',
    dailyTouch: true,
    start: '2026-07-29 04:00',
    end: '2026-09-08 03:59',
    notes: '7-day login.',
    sourceKey: 'seed:zzz:3.1-gift-clouds',
  },
  {
    game: 'zzz',
    name: 'Marcel Anniversary Gift — free S-Rank Agent + W-Engine',
    type: 'event',
    start: '2026-07-29 04:00',
    end: '2026-09-08 23:00',
    notes:
      'Pick 1 of 5 limited S-Rank Agents plus 1 of 5 limited S-Rank W-Engines, and 1,600 Polychrome. Runs to the official 3.1 end (ann 1234).',
    sourceKey: 'seed:zzz:3.1-marcel',
  },
  {
    game: 'zzz',
    name: "Phaethon's Grand Reveal of the Year",
    type: 'event',
    start: '2026-07-29 04:00',
    end: '2026-09-08 23:00',
    notes:
      'Runs to the 3.1 boundary. The event notice gives no clock of its own, but the boundary is official: 2026/09/09 06:00 (UTC+8) per ann 1234.',
    sourceKey: 'seed:zzz:3.1-grand-reveal',
  },
  {
    game: 'zzz',
    name: 'Potential Hypothesis: Hunting Game',
    type: 'event',
    start: '2026-07-29 04:00',
    end: '2026-09-08 23:00',
    notes: 'One-time trial stages. Runs to the 3.1 boundary — official per ann 1234, 2026/09/09 06:00 (UTC+8).',
    sourceKey: 'seed:zzz:3.1-hunting-game',
  },
  {
    game: 'zzz',
    name: 'New Eridu City Fund 3.1',
    type: 'event',
    start: '2026-07-29 04:00',
    end: '2026-09-07 03:59',
    notes:
      'Buying the Growth/Premium/Upgrade plans closes 09-07 02:59, an hour before the event; Expansion Tasks and reward claims stay open to the end.',
    sourceKey: 'seed:zzz:3.1-city-fund',
  },
  {
    game: 'zzz',
    name: 'Filmgoer Thank-You Gift',
    type: 'event',
    start: '2026-07-29 04:00',
    end: '2026-09-08 22:59',
    notes: 'Version-bound purchase reward.',
    sourceKey: 'seed:zzz:3.1-filmgoer',
  },
  {
    game: 'zzz',
    name: 'Return to Ridu: Feathers of Reunion',
    type: 'event',
    start: '2026-07-17 13:30',
    end: '2026-09-08 22:59',
    notes: 'Returning-player campaign. The notice quotes UTC+8 explicitly, so this one IS shifted.',
    sourceKey: 'seed:zzz:3.1-return-to-ridu',
  },
  {
    game: 'zzz',
    name: 'The Final Callback — audition stages',
    type: 'event',
    start: '2026-07-29 04:00',
    end: '2026-09-08 14:59',
    notes:
      'Free trial stages with first-clear rewards, tied to the banner phases: Remielle to 09-08 14:59, Aria only to 08-19 11:59. Phase 2 adds Sigrid, Dialyn, Yuzuha and Harumasa from 08-19 12:00.',
    sourceKey: 'seed:zzz:3.1-final-callback',
  },
  {
    game: 'zzz',
    name: 'Snap! Focus Showdown!',
    type: 'event',
    start: '2026-08-07 10:00',
    end: '2026-08-24 03:59',
    sourceKey: 'seed:zzz:3.1-snap-showdown',
  },
  {
    game: 'zzz',
    name: 'Extensive Patrol: Triple Bounty',
    type: 'event',
    dailyTouch: true,
    start: '2026-08-12 04:00',
    end: '2026-08-17 03:59',
    notes: 'Triple Area Patrol rewards — bank Battery for it.',
    sourceKey: 'seed:zzz:3.1-patrol-bounty',
  },
  {
    game: 'zzz',
    name: 'Great En-Nah Giveaway — 10 tapes + 10 Boopons',
    type: 'event',
    dailyTouch: true,
    start: '2026-08-19 10:00',
    end: '2026-09-08 03:59',
    notes: '7-day login.',
    sourceKey: 'seed:zzz:3.1-ennah-giveaway',
  },
  {
    game: 'zzz',
    name: 'Crispy Meal Deployment Plan',
    type: 'event',
    dailyTouch: true,
    start: '2026-08-19 10:00',
    end: '2026-09-07 03:59',
    notes: 'Event commissions unlock daily across the run.',
    sourceKey: 'seed:zzz:3.1-crispy-meal',
  },
  {
    game: 'zzz',
    name: "Dangerous Fugitive's Leisurely Vacation",
    type: 'event',
    start: '2026-08-24 10:00',
    end: '2026-09-07 03:59',
    sourceKey: 'seed:zzz:3.1-fugitive',
  },
  {
    game: 'zzz',
    name: 'Ding-Dong! Delivery Training in Progress',
    type: 'event',
    start: '2026-08-28 10:00',
    end: '2026-09-14 03:59',
    sourceKey: 'seed:zzz:3.1-delivery-training',
  },
  {
    game: 'zzz',
    name: 'Combat Training: Triple Bounty',
    type: 'event',
    dailyTouch: true,
    start: '2026-09-02 04:00',
    end: '2026-09-07 03:59',
    notes: 'Triple Combat Simulation rewards — bank Battery for it.',
    sourceKey: 'seed:zzz:3.1-combat-bounty',
  },
  // --- banners
  {
    game: 'zzz',
    name: 'Remielle — Paradise Regained (flagship)',
    type: 'banner',
    start: '2026-07-29 04:00',
    end: '2026-09-08 14:59',
    notes: 'Runs both phases of 3.1.',
    sourceKey: 'seed:zzz:3.1-remielle',
  },
  {
    game: 'zzz',
    name: 'Ode of Resurrected Wings — W-Engine (flagship)',
    type: 'banner',
    start: '2026-07-29 04:00',
    end: '2026-09-08 14:59',
    sourceKey: 'seed:zzz:3.1-remielle-engine',
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
    name: 'Angel in the Shell — W-Engine (phase 1)',
    type: 'banner',
    start: '2026-07-29 04:00',
    end: '2026-08-19 11:59',
    sourceKey: 'seed:zzz:3.1-aria-engine',
  },
  {
    game: 'zzz',
    name: 'Sigrid — Till the Ends of the Sky (phase 2)',
    type: 'banner',
    start: '2026-08-19 12:00',
    end: '2026-09-08 14:59',
    sourceKey: 'seed:zzz:3.1-sigrid',
  },
  {
    game: 'zzz',
    name: "Knight's Extolment — Sigrid W-Engine (phase 2)",
    type: 'banner',
    start: '2026-08-19 12:00',
    end: '2026-09-08 14:59',
    sourceKey: 'seed:zzz:3.1-sigrid-engine',
  },
  {
    game: 'zzz',
    name: 'Exclusive Rescreening: Dialyn · Yuzuha · Harumasa (phase 2)',
    type: 'banner',
    start: '2026-08-19 12:00',
    end: '2026-09-08 14:59',
    notes: 'Selectable rerun.',
    sourceKey: 'seed:zzz:3.1-rescreening',
  },
  {
    game: 'zzz',
    name: 'W-Engine Reverberation — selectable rerun (phase 2)',
    type: 'banner',
    start: '2026-08-19 12:00',
    end: '2026-09-08 14:59',
    sourceKey: 'seed:zzz:3.1-engine-reverb',
  },
  // --- maintenance
  {
    game: 'zzz',
    name: 'v3.2 update maintenance',
    type: 'maintenance',
    start: '2026-09-08 23:00',
    end: '2026-09-09 04:00',
    notes: 'The 3.1 notice sets the 23:00 boundary; the reopen time is the usual five hours.',
    sourceKey: 'seed:zzz:3.2-maint',
  },

  /* ================================================== WUTHERING WAVES — v3.5 "Blade of Past
     Resounds" (Jul 10 – Aug 19, Mengzhou region, first SP character). This block used to
     run to Aug 20 off game8's estimate; the version actually ends Aug 19, with events
     closing at 03:59 and convenes at 11:59. v3.6 "Lamplight in Mirage" follows on Aug 20.
     Tower of Adversity and Whimpering Wastes are deliberately NOT seeded — they stay as
     preset tasks, because their cycles are 28-day rotations with no published windows. */
  // --- events
  {
    game: 'wuwa',
    name: 'Gifts of Aftertune (login)',
    type: 'event',
    dailyTouch: true,
    start: '2026-07-10 04:00',
    end: '2026-08-19 03:59',
    sourceKey: 'seed:wuwa:3.5-login',
  },
  {
    game: 'wuwa',
    name: 'Gifts of Starpath — free convenes',
    type: 'event',
    notify: false,
    start: '2026-07-10 04:00',
    end: '2026-08-19 03:59',
    sourceKey: 'seed:wuwa:3.5-gifts-starpath',
  },
  {
    game: 'wuwa',
    name: 'Mingshen Notices — commissions',
    type: 'event',
    notify: false,
    start: '2026-07-10 04:00',
    end: '2026-08-19 03:59',
    sourceKey: 'seed:wuwa:3.5-mingshen',
  },
  {
    game: 'wuwa',
    name: 'A Glimpse of Xuanfang',
    type: 'event',
    notify: false,
    start: '2026-07-10 04:00',
    end: '2026-08-19 03:59',
    notes: 'Exploration campaign — Astrite and materials.',
    sourceKey: 'seed:wuwa:3.5-xuanfang',
  },
  {
    game: 'wuwa',
    name: 'Lament Recon: Tacet Crisis',
    type: 'event',
    notify: false,
    start: '2026-07-11 10:00',
    end: '2026-08-19 11:59',
    notes: '1,200 Astrite plus cosmetics.',
    sourceKey: 'seed:wuwa:3.5-lament',
  },
  {
    game: 'wuwa',
    name: 'Virtual Crisis: Quadrant Trials',
    type: 'event',
    start: '2026-07-30 10:00',
    end: '2026-08-19 03:59',
    sourceKey: 'seed:wuwa:3.5-quadrant',
  },
  {
    game: 'wuwa',
    name: 'Lollo Campaign: New Journey',
    type: 'event',
    dailyTouch: true,
    start: '2026-08-06 04:00',
    end: '2026-08-19 03:59',
    notes: 'Daily commission plus a stamp roulette — Astrite.',
    sourceKey: 'seed:wuwa:3.5-lollo',
  },
  {
    game: 'wuwa',
    name: 'Chord Cleansing — double echo drops',
    type: 'event',
    dailyTouch: true,
    notify: false,
    start: '2026-08-12 04:00',
    end: '2026-08-19 03:59',
    notes:
      'Double echo drops — plan Waveplates. Genuinely contested: game8 lists Aug 12–19, GameLeap lists Aug 6–13. Verify in-game.',
    sourceKey: 'seed:wuwa:3.5-chord',
  },
  // --- banners. Convenes close at 11:59, not at the maintenance hour.
  {
    game: 'wuwa',
    name: 'Starpath Reverbs Convene — selectable 1.x rerun',
    type: 'banner',
    start: '2026-07-10 04:00',
    end: '2026-08-19 11:59',
    notes: 'Jiyan/Yinlin/Jinhsi/Changli/Zhezhi/Xiangli Yao; free first 10-pull.',
    sourceKey: 'seed:wuwa:3.5-starpath',
  },
  {
    game: 'wuwa',
    name: 'Tideforge Reverbs Convene — selectable weapon rerun',
    type: 'banner',
    notify: false,
    start: '2026-07-10 04:00',
    end: '2026-08-19 11:59',
    sourceKey: 'seed:wuwa:3.5-tideforge',
  },
  {
    game: 'wuwa',
    name: 'Suisui + Aemeath rerun (phase 2)',
    type: 'banner',
    start: '2026-07-30 10:00',
    end: '2026-08-19 11:59',
    sourceKey: 'seed:wuwa:3.5-p2',
  },
  {
    game: 'wuwa',
    name: "Absolute Pulsation: Firstlight's Herald + Everbright Polestar (phase 2)",
    type: 'banner',
    start: '2026-07-30 10:00',
    end: '2026-08-19 11:59',
    sourceKey: 'seed:wuwa:3.5-p2-weapons',
  },
  // --- maintenance
  {
    game: 'wuwa',
    name: 'v3.6 "Lamplight in Mirage" update maintenance',
    type: 'maintenance',
    // Official notice now: 2026-08-20 04:00–11:00 (UTC+8), a t_gl-class global
    // window, so -7h. The previously guessed values happened to be right.
    start: '2026-08-19 21:00',
    end: '2026-08-20 04:00',
    notes: 'Official notice. Compensation Astrite ×300 + Crystal Solvent ×2. Kuro says it may end up to ~2h early.',
    sourceKey: 'seed:wuwa:3.6-maint',
  },
  /* --- v3.6 "Lamplight in Mirage" (from Aug 20). The Aug 7 preview named six events with
     no windows, so the 08-18 pass deliberately left them out rather than smear them across
     the version span. That caution paid: the official notice puts them on FIVE different
     start dates (Aug 20, Aug 22, Aug 27, Sep 3, Sep 10, Sep 17), so seeding them at launch
     would have been wrong for five of the six. They are now seeded from the notice.

     Phase 2 (Jingran; Hiyuki and Mornye reruns) is still community-only and stays silent. */
  {
    game: 'wuwa',
    name: 'Qingxiao + Denia rerun (phase 1)',
    type: 'banner',
    start: '2026-08-20 04:00',
    end: '2026-09-10 09:59',
    notes: 'Official convene notice — the estimated close it carried turned out correct.',
    sourceKey: 'seed:wuwa:3.6-p1',
  },
  {
    game: 'wuwa',
    name: 'Glint of Clouds + Forged Dwarf Star (phase 1 weapons)',
    type: 'banner',
    start: '2026-08-20 04:00',
    end: '2026-09-10 09:59',
    notes: 'Official convene notice.',
    sourceKey: 'seed:wuwa:3.6-p1-weapons',
  },
  // --- v3.6 events, all six from the official Kuro notice. Note the five distinct
  // start dates: this slate does NOT open with the version.
  {
    game: 'wuwa',
    name: 'Gifts of Drifting Mist (login)',
    type: 'event',
    dailyTouch: true,
    start: '2026-08-20 04:00',
    end: '2026-09-29 11:59',
    notes: '7-day login — the window is the whole version, the claims are not.',
    sourceKey: 'seed:wuwa:3.6-login',
  },
  {
    game: 'wuwa',
    name: 'Resonance Sim Realm',
    type: 'event',
    start: '2026-08-22 10:00',
    end: '2026-09-29 11:59',
    sourceKey: 'seed:wuwa:3.6-sim-realm',
  },
  {
    game: 'wuwa',
    name: 'Second Coming of Solaris: Coded Deception',
    type: 'event',
    start: '2026-08-27 04:00',
    end: '2026-09-14 03:59',
    sourceKey: 'seed:wuwa:3.6-solaris',
  },
  {
    game: 'wuwa',
    name: 'The Strings Remember',
    type: 'event',
    start: '2026-09-03 04:00',
    end: '2026-09-21 03:59',
    sourceKey: 'seed:wuwa:3.6-strings',
  },
  {
    game: 'wuwa',
    name: 'If Dreams Still Reverberate',
    type: 'event',
    start: '2026-09-10 10:00',
    end: '2026-09-29 03:59',
    sourceKey: 'seed:wuwa:3.6-dreams',
  },
  {
    game: 'wuwa',
    name: 'Wuthering Exploration: Fogveil Pagoda',
    type: 'event',
    start: '2026-09-17 04:00',
    end: '2026-09-29 11:59',
    sourceKey: 'seed:wuwa:3.6-fogveil',
  },
  {
    game: 'wuwa',
    name: 'Jingran + Hiyuki/Mornye reruns (phase 2)',
    type: 'banner',
    notify: false,
    start: '2026-09-10 10:00',
    end: '2026-09-29 11:59',
    notes: 'Community phase-2 calendar — the official convene notice is not published yet.',
    sourceKey: 'seed:wuwa:3.6-p2',
  },
  {
    game: 'wuwa',
    name: 'v3.7 update maintenance',
    type: 'maintenance',
    notify: false,
    start: '2026-09-29 21:00',
    end: '2026-09-30 04:00',
    notes:
      'No notice yet. Inferred from the official 3.6 close (09-29 11:59) and the usual Kuro overnight window.',
    sourceKey: 'seed:wuwa:3.7-maint',
  },

  /* ================================================== NEVERNESS TO EVERNESS — v1.2 "999 Nights"
     ends Aug 18; v1.3 "Rising from the Moonlit Fog" launches Aug 19.

     CONVENTION: MIXED, and Perfect World mixes the two INSIDE ONE NOTICE. The 1.2 patch
     notes contain both of these:
       "999 Nights"        July 8 (after update) – August 19, 05:59 (UTC+8)   ← GLOBAL, -7h
       "Stamina Recharge"  July 13, 05:00 – July 20, 04:59 (server time)      ← LOCAL, as-is
     The rule that separates them: NTE runs four isolated regional servers, each with a
     05:00 local daily reset. So a 05:00 → 04:59 window is pinned to the LOCAL reset and is
     copied unshifted; a window ending :59 past a UTC+8 boundary is GLOBAL and takes -7h.
     Hence 1.2's rewards end 2026-08-18 22:59 EU, not "Aug 19 05:00".

     Keep the 05:00-vs-04:00 distinction: the daily reset is 05:00 local, while version and
     banner flips land at 04:00 because they derive from the 11:00 (UTC+8) maintenance end.
     Two different mechanisms one hour apart — do not collapse them.

     KNOWN RISK, the weakest inference in this block: the Beyond the Rails Special Route
     notices are tagged (UTC+8) yet run 05:00:00 → 04:59:59, which is exactly the LOCAL
     reset boundary and matches the "(server time)"-tagged events. They are treated as LOCAL.
     If that is wrong, every rails row is 7 hours late — worth one in-game countdown check. */
  // --- events
  {
    game: 'nte',
    name: 'Shadow-N-Seek',
    type: 'event',
    notify: false,
    start: '2026-07-17 03:00',
    end: '2026-08-18 22:59',
    notes: 'Prop-hunt multiplayer.',
    sourceKey: 'seed:nte:1.2-shadow',
  },
  {
    game: 'nte',
    name: '999 Nights — version campaign',
    type: 'event',
    start: '2026-07-08 04:00',
    end: '2026-08-18 22:59',
    notes: 'Annulith, Fabricated Dice, Fons and materials.',
    sourceKey: 'seed:nte:1.2-999-nights',
  },
  {
    game: 'nte',
    name: 'Neon Rift',
    type: 'event',
    notify: false,
    start: '2026-07-08 04:00',
    end: '2026-08-18 22:59',
    notes: 'Vehicle, outfits and 10 Fabricated Dice.',
    sourceKey: 'seed:nte:1.2-neon-rift',
  },
  {
    game: 'nte',
    name: 'Summer Special Gift Pack — free S-Class selector',
    type: 'event',
    start: '2026-07-08 04:00',
    end: '2026-08-18 22:59',
    notes: 'Standard S-Class character selector — claim before the version ends.',
    sourceKey: 'seed:nte:1.2-summer-pack',
  },
  {
    game: 'nte',
    name: 'Going, Going, Gone! (auction)',
    type: 'event',
    notify: false,
    start: '2026-07-29 04:00',
    end: '2026-08-18 22:59',
    sourceKey: 'seed:nte:1.2-auction',
  },
  {
    game: 'nte',
    name: 'Fishing Frenzy',
    type: 'event',
    notify: false,
    start: '2026-08-03 05:00',
    end: '2026-08-19 05:59',
    sourceKey: 'seed:nte:1.2-fishing',
  },
  {
    game: 'nte',
    name: 'Warren Lucky Flip',
    type: 'event',
    dailyTouch: true,
    start: '2026-08-05 05:00',
    end: '2026-08-19 04:59',
    sourceKey: 'seed:nte:1.2-luckyflip',
  },
  // --- cycles
  {
    game: 'nte',
    name: 'Circle Bounty',
    type: 'cycle',
    start: '2026-07-08 04:00',
    end: '2026-08-18 16:59',
    notes: '12,000 weekly points. Note it closes SIX hours before the rest of 1.2.',
    sourceKey: 'seed:nte:1.2-circle-bounty',
  },
  // Beyond the Rails rotates a Special Route every 14 days. The group name used to be
  // "Beyond the Rails — Prime Circle", but Prime Circle was a specific one-off route that
  // ENDED 2026-06-04 — a dead route name baked into the connector key. The routes so far
  // are Blazing (Jul 16) → Cresting (Jul 30) → Waxing (Aug 13), so the route belongs in
  // notes and the name stays bare. Note the mode also contains a PERMANENT route,
  // Fractured Circle, which must never be seeded.
  {
    game: 'nte',
    name: 'Beyond the Rails',
    type: 'cycle',
    start: '2026-08-13 05:00',
    end: '2026-08-27 04:59',
    notes: 'Route: Waxing Circle. Now confirmed by an official window, not cadence-derived.',
    sourceKey: 'seed:nte:1.2-rails-3',
  },
  {
    game: 'nte',
    name: 'Beyond the Rails',
    type: 'cycle',
    start: '2026-08-26 22:00',
    end: '2026-09-09 21:59',
    notes: 'Official route window — opens 08-26 22:00, a day earlier than the estimate carried here.',
    sourceKey: 'seed:nte:1.3-rails-4',
  },
  // --- banners
  {
    game: 'nte',
    name: 'Shinku — Before the Dawn (+ Blushing Mirage arc)',
    type: 'banner',
    start: '2026-07-08 04:00',
    end: '2026-07-29 03:59',
    sourceKey: 'seed:nte:1.2-shinku',
  },
  {
    game: 'nte',
    name: 'Iroi — The Lifeline (phase 2)',
    type: 'banner',
    start: '2026-07-29 04:00',
    end: '2026-08-18 22:59',
    sourceKey: 'seed:nte:1.2-iroha',
  },
  {
    game: 'nte',
    name: 'Dreamgate Special — The Wrong Gate (phase 2 arc)',
    type: 'banner',
    start: '2026-07-29 04:00',
    end: '2026-08-18 22:59',
    sourceKey: 'seed:nte:1.2-wrong-gate',
  },
  // --- maintenance
  {
    game: 'nte',
    name: 'v1.3 "Rising from the Moonlit Fog" update maintenance',
    type: 'maintenance',
    notify: false,
    start: '2026-08-18 23:00',
    end: '2026-08-19 04:00',
    notes:
      'Pattern-derived from the 1.2 and 1.3-phase-2 notices, which both run 06:00–11:00 (UTC+8). Perfect World has not published the Aug 19 notice. Expect Annulith ×300 compensation.',
    sourceKey: 'seed:nte:1.3-maint',
  },
  /* --- v1.3 "Rising from the Moonlit Fog" (Aug 19 – Sep 30). Every row below is silent:
     Perfect World's own 1.3 article could not be reached (the site is a JS SPA and the
     article is not indexed yet), so these durations are third-party transcriptions of the
     official notes rather than the notes themselves. The 04:00 starts inherit the assumed
     11:00 (UTC+8) maintenance end. Re-run once the notice is reachable. */
  // --- banners
  {
    game: 'nte',
    name: 'Alluring Shadows — Zankou (phase 1)',
    type: 'banner',
    start: '2026-08-19 04:00',
    end: '2026-09-08 22:59',
    notes: 'Official v1.3 notice — was an estimate, dates confirmed unchanged.',
    sourceKey: 'seed:nte:1.3-zankou',
  },
  {
    game: 'nte',
    name: 'The Ichi-Daime — Nanally rerun (phase 1)',
    type: 'banner',
    start: '2026-08-19 04:00',
    end: '2026-09-08 22:59',
    notes: 'Official v1.3 notice — was an estimate, dates confirmed unchanged.',
    sourceKey: 'seed:nte:1.3-nanally',
  },
  {
    game: 'nte',
    name: 'Spellbound Special — Ravenous Blade',
    type: 'banner',
    start: '2026-08-19 04:00',
    end: '2026-09-08 22:59',
    notes: 'Official v1.3 notice. Weapon-side banner of the phase-1 slate.',
    sourceKey: 'seed:nte:1.3-ravenous-blade',
  },
  {
    game: 'nte',
    name: 'Tiger Special — Ready-Ready',
    type: 'banner',
    start: '2026-08-19 04:00',
    end: '2026-09-08 22:59',
    notes: 'Official v1.3 notice.',
    sourceKey: 'seed:nte:1.3-ready-ready',
  },
  {
    game: 'nte',
    name: 'Surfing All Channels — Linko (phase 2)',
    type: 'banner',
    notify: false,
    start: '2026-09-09 04:00',
    end: '2026-09-29 22:59',
    notes: 'Start is the officially stated 06:00–11:00 (UTC+8) maintenance on Sep 9.',
    sourceKey: 'seed:nte:1.3-linko',
  },
  {
    game: 'nte',
    name: 'Misty Tipsy Style — Hotori rerun (phase 2)',
    type: 'banner',
    notify: false,
    start: '2026-09-09 04:00',
    end: '2026-09-29 22:59',
    sourceKey: 'seed:nte:1.3-hotori',
  },
  // --- events with durations quoted from the 1.3 notes
  {
    game: 'nte',
    name: 'Water Racing',
    type: 'event',
    notify: false,
    start: '2026-08-19 04:00',
    end: '2026-09-29 22:59',
    sourceKey: 'seed:nte:1.3-water-racing',
  },
  {
    game: 'nte',
    name: 'Surf Breaker',
    type: 'event',
    start: '2026-08-19 04:00',
    end: '2026-09-29 22:59',
    notes: 'Official v1.3 notice — was an estimate, dates confirmed unchanged.',
    sourceKey: 'seed:nte:1.3-surf-breaker',
  },
  {
    game: 'nte',
    name: 'Shipwreck Salvage',
    type: 'event',
    start: '2026-08-28 03:00',
    end: '2026-09-29 22:59',
    notes: 'Official v1.3 notice — was an estimate, dates confirmed unchanged.',
    sourceKey: 'seed:nte:1.3-shipwreck',
  },
  {
    game: 'nte',
    name: 'Runaway Echoes',
    type: 'event',
    notify: false,
    start: '2026-09-09 04:00',
    end: '2026-09-29 22:59',
    sourceKey: 'seed:nte:1.3-runaway-echoes',
  },
  {
    game: 'nte',
    name: 'Breezy Tour',
    type: 'event',
    notify: false,
    start: '2026-09-17 03:00',
    end: '2026-09-29 22:59',
    sourceKey: 'seed:nte:1.3-breezy-tour',
  },
  // --- day-level only. Clock times assume the standard 05:00 → 04:59 server-time pattern,
  // which is how the identical 1.2 events ran; the dates themselves are community-sourced.
  {
    game: 'nte',
    name: 'Volley Star',
    type: 'event',
    start: '2026-08-19 04:00',
    end: '2026-09-29 22:59',
    notes: 'Official v1.3 notice — was an estimate, dates confirmed unchanged.',
    sourceKey: 'seed:nte:1.3-volley-star',
  },
  {
    game: 'nte',
    name: "Hunter's Crucible",
    type: 'event',
    start: '2026-08-19 04:00',
    end: '2026-09-29 22:59',
    notes: 'Official v1.3 notice — was an estimate, dates confirmed unchanged.',
    sourceKey: 'seed:nte:1.3-hunters-crucible',
  },
  {
    game: 'nte',
    name: 'Stamina Recharge ×2',
    type: 'event',
    dailyTouch: true,
    start: '2026-08-24 05:00',
    end: '2026-08-31 04:59',
    notes: 'Official v1.3 notice — was an estimate, dates confirmed unchanged.',
    sourceKey: 'seed:nte:1.3-stamina',
  },
  {
    game: 'nte',
    name: 'Gold Clash — 2× Fons in Pink Paws Heist',
    type: 'event',
    dailyTouch: true,
    start: '2026-08-31 05:00',
    end: '2026-09-14 04:59',
    notes: 'Official v1.3 notice — was an estimate, dates confirmed unchanged.',
    sourceKey: 'seed:nte:1.3-goldclash',
  },
  {
    game: 'nte',
    name: 'Pixel Surge',
    type: 'event',
    dailyTouch: true,
    notify: false,
    start: '2026-09-14 05:00',
    end: '2026-09-21 04:59',
    notes: 'Double rewards on Character Pixels — spend them here. Day-level dates only.',
    sourceKey: 'seed:nte:1.3-pixelsurge',
  },
  {
    game: 'nte',
    name: 'Fons Rush',
    type: 'event',
    dailyTouch: true,
    notify: false,
    start: '2026-09-21 05:00',
    end: '2026-09-28 04:59',
    notes: 'Double Fons on City Stamina — spend the weekly pool here. Day-level dates only.',
    sourceKey: 'seed:nte:1.3-fonsrush',
  },
  {
    game: 'nte',
    name: '1.3 login — 10 Solid Dice',
    type: 'event',
    dailyTouch: true,
    start: '2026-08-19 04:00',
    end: '2026-09-29 22:59',
    notes: 'Official v1.3 notice — was an estimate, dates confirmed unchanged.',
    sourceKey: 'seed:nte:1.3-login',
  },
  {
    game: 'nte',
    name: 'Circle Bounty',
    type: 'cycle',
    start: '2026-08-19 04:00',
    end: '2026-09-29 16:59',
    notes: 'Official v1.3 notice — was an estimate, dates confirmed unchanged.',
    sourceKey: 'seed:nte:1.3-circle-bounty',
  },

  /* ================================================== LOVE AND DEEPSPACE — v6.0 "A Shattered
     Quiet" (from Jul 9). Infold runs half-year major versions with rolling banner cycles
     inside them, so there is no patch boundary to hang events off — every row below comes
     from the official global feed or the wiki, dated on its own. The Europe server is
     UTC+2, which is why these clock times do not look like the HoYo ones.

     CONVENTION: LOCAL throughout — no arithmetic anywhere in this game. Infold runs NA on
     UTC-7 and EU on UTC+2 and calls the shared quantity "Server Time", so a "(Server Time)"
     duration is the same wall clock on both. When they mean one absolute instant they say
     so explicitly, switching notation mid-sentence ("from 05:00 on Jul. 2 (server time) to
     04:59 on Jul. 9 (UTC+8)"). Converting a "(Server Time)" value would shift this whole
     game by 6 hours. */
  {
    game: 'lads',
    name: 'Promise: Beachside Victory / Your Voice',
    type: 'event',
    start: '2026-06-27 05:00',
    end: '2026-08-24 04:59',
    notes: 'Free path pays 12 Empyrean Wishes — long-runner, no rush.',
    sourceKey: 'seed:lads:6.0-promise',
  },
  {
    game: 'lads',
    name: 'Po Zhen Zi',
    type: 'event',
    start: '2026-08-17 05:00',
    end: '2026-08-31 04:59',
    notes: "Rafayel's 4th Myth. Free path pays a 4★ Memory pair, a 3★ Memory, 10 Deepspace Wishes and 500 Diamonds.",
    sourceKey: 'seed:lads:po-zhen-zi',
  },
  {
    game: 'lads',
    name: 'Rafayel: Masked Radiance / Masked Dissolution',
    type: 'banner',
    start: '2026-08-17 05:00',
    end: '2026-08-31 04:59',
    notes: 'Limited 5★ Solar-Slot Memory Pair. 150 pulls guarantees both and unlocks the Companion.',
    sourceKey: 'seed:lads:rafayel-masked-radiance',
  },
  {
    game: 'lads',
    name: 'Skyvault Afar',
    type: 'event',
    notify: false,
    start: '2026-08-17 05:00',
    end: '2026-08-31 04:59',
    notes:
      'Free reward track inside the Po Zhen Zi cycle. Window assumed identical to Po Zhen Zi — no standalone duration was published.',
    sourceKey: 'seed:lads:skyvault-afar',
  },
  {
    game: 'lads',
    name: 'Roaming Trails',
    type: 'event',
    start: '2026-08-17 05:00',
    end: '2026-08-31 04:59',
    sourceKey: 'seed:lads:roaming-trails',
  },
  {
    game: 'lads',
    name: 'Companion Rehearsal',
    type: 'event',
    start: '2026-08-17 05:00',
    end: '2026-08-31 04:59',
    sourceKey: 'seed:lads:companion-rehearsal',
  },
  {
    game: 'lads',
    name: 'Yanzhou Market',
    type: 'event',
    start: '2026-08-17 05:00',
    end: '2026-09-01 04:59',
    notes: 'Stays open a day past the parent event — spend before it closes, not before Po Zhen Zi does.',
    sourceKey: 'seed:lads:yanzhou-market',
  },
  {
    game: 'lads',
    name: 'Sylus — No Defense Zone rerun',
    type: 'banner',
    start: '2026-08-24 05:00',
    end: '2026-08-31 04:59',
    sourceKey: 'seed:lads:sylus-no-defense-zone',
  },
  // Seasons run 14 days. The old row claimed a 45-day Season 14 ending Aug 27 — that season
  // actually ended Jul 27, so the stored end looks like a Jul→Aug typo. Name is the bare
  // recurring string now; the season number lives in notes so instances group.
  {
    game: 'lads',
    name: 'Senior Hunter Contest',
    type: 'cycle',
    notify: false,
    start: '2026-08-10 05:00',
    end: '2026-08-24 04:59',
    notes:
      '2026 Season 16. Dates from the wiki season list; the 05:00/04:59 boundary is the standard LADS one and was not published for this season — verify in-game.',
    sourceKey: 'seed:lads:hunter-contest-2026-s16',
  },
  {
    game: 'lads',
    name: 'Senior Hunter Contest',
    type: 'cycle',
    notify: false,
    start: '2026-08-24 05:00',
    end: '2026-09-07 04:59',
    notes: '2026 Season 17. Same caveat — wiki season list, times assumed.',
    sourceKey: 'seed:lads:hunter-contest-2026-s17',
  },

  /* ================================================== UMAMUSUME: PRETTY DERBY — Global.
     Cygames ships named campaigns, not numbered versions, so there is no maintenance row
     to anchor to. Everything below is on the Global UTC+0 clock: content opens at 22:00,
     while daily missions roll at 15:00.

     CONVENTION: GLOBAL, and trivially — there is ONE Global service, so the local/global
     split collapses. The official roadmap quotes SGT (UTC+8) and the official account
     quotes UTC for the same events, so the conversion is SGT - 8h. It self-checks against
     both known boundaries: 06:00 SGT - 8h = 22:00 UTC (content opens) and 22:59 SGT - 8h =
     14:59 UTC (the 15:00 daily-mission roll). Watch which boundary a window closes on —
     assuming the 22:00 one is what put the anniversary end 7 hours late. */
  {
    game: 'uma',
    name: '1.5-Year Anniversary campaign',
    type: 'event',
    dailyTouch: true,
    start: '2026-07-22 22:00',
    // Closes on the 15:00 daily-mission boundary, not the 22:00 content one.
    end: '2026-08-28 14:59',
    notes:
      'Login rewards, free daily 10-pulls, Carats, the Grand Concert scenario. Part 3 (Training the Trainer) closes earlier, 2026-08-24 14:59.',
    sourceKey: 'seed:uma:anniversary-1.5',
  },
  {
    game: 'uma',
    name: 'Days Flying By (story event)',
    type: 'event',
    start: '2026-08-18 22:00',
    end: '2026-08-30 21:59',
    notes: 'Halloween story event. Free Shinko Windy Guts SSR on the free path.',
    sourceKey: 'seed:uma:story-event-18',
  },
  {
    game: 'uma',
    name: 'Legend Races — Sprinters Stakes',
    type: 'event',
    dailyTouch: true,
    start: '2026-08-13 22:00',
    end: '2026-08-20 14:59',
    notes: 'Nishino Flower and Hishi Akebono.',
    sourceKey: 'seed:uma:legend-races-2026-08',
  },
  {
    game: 'uma',
    name: 'Spotlight Scout — Seeking the Pearl (+ Daiichi Ruby, K.S. Miracle supports)',
    type: 'banner',
    start: '2026-08-12 22:00',
    end: '2026-08-21 21:59',
    sourceKey: 'seed:uma:scout-2026-08-12',
  },
  {
    game: 'uma',
    name: 'Spotlight Scout — Halloween Agnes Digital / Meisho Doto (+ Shinko Windy, Daitaku Helios, Mejiro Palmer supports)',
    type: 'banner',
    start: '2026-08-18 22:00',
    end: '2026-08-30 21:59',
    notes:
      'Runs with the Days Flying By story event. The window is from the official roadmap; the Halloween trainee pairing is community-sourced.',
    sourceKey: 'seed:uma:scout-2026-08-18',
  },
  {
    game: 'uma',
    name: 'Spotlight Scout — Aston Machan (+ Fine Motion, Maruzensky supports)',
    type: 'banner',
    start: '2026-08-25 22:00',
    end: '2026-09-01 21:59',
    sourceKey: 'seed:uma:scout-2026-08-25',
  },
  // Champions Meeting is monthly and recurring, so instances share the bare name and carry
  // the cup in notes — otherwise every cup groups alone and no connector is ever drawn.
  {
    game: 'uma',
    name: 'Champions Meeting',
    type: 'cycle',
    start: '2026-08-24 22:00',
    end: '2026-09-02 21:59',
    notes: 'Libra Cup — 1600m Mile, Hanshin Racecourse.',
    sourceKey: 'seed:uma:cm-libra-2026-08',
  },

  /* ================================================== GODDESS OF VICTORY: NIKKE — the
     PERSONA ON FRONTLINE collab, Aug 13 – Sep 10. Shift Up ships an update roughly every
     2–3 weeks and does not publish client version numbers, so updates are named here.

     CONVENTION: GLOBAL and trivial — every region runs on ONE UTC+9 clock and every notice
     is already stamped (UTC+9), so nothing below is converted. Daily reset is 05:00, which
     is why almost every window opens 05:00 and closes 04:59; the 07:00 starts are the Aug 13
     maintenance END, not a reset.

     The Aug 13 maintenance was stored as 15:00–18:00 "copied from the PROJECT MATIS
     downtime". It was actually 00:00–07:00 — seven hours from midnight. That row is gone,
     but the 07:00 it establishes is the start every collab row below inherits. */
  {
    game: 'nikke',
    name: 'Maxwell: Ordinary Mechanic Pick Up',
    type: 'banner',
    start: '2026-07-30 05:00',
    end: '2026-08-20 04:59',
    sourceKey: 'seed:nikke:maxwell-pickup',
  },
  {
    game: 'nikke',
    name: 'August Mission Pass',
    type: 'event',
    start: '2026-08-01 00:00',
    end: '2026-08-31 23:59',
    notes: 'The pass refreshes on the first of every month — a published rule, not a guess.',
    sourceKey: 'seed:nikke:mission-pass-aug',
  },
  {
    game: 'nikke',
    name: 'September Mission Pass',
    type: 'event',
    start: '2026-09-01 00:00',
    end: '2026-09-30 23:59',
    notes: 'Reward: Flora – Fairy Rabbit costume.',
    sourceKey: 'seed:nikke:mission-pass-sep',
  },
  // --- PERSONA ON FRONTLINE collab
  {
    game: 'nikke',
    name: 'PERSONA ON FRONTLINE',
    type: 'event',
    start: '2026-08-13 07:00',
    end: '2026-09-10 04:59',
    notes:
      'Collab story event. Memory Films unlock Archive stories; includes the MIDNIGHT PHANTOM RUNNER minigame. Free SR Aigis.',
    sourceKey: 'seed:nikke:persona-on-frontline',
  },
  {
    game: 'nikke',
    name: 'PERSONA ON FRONTLINE — Story Part 2',
    type: 'event',
    start: '2026-08-20 05:00',
    end: '2026-09-10 04:59',
    sourceKey: 'seed:nikke:persona-story-2',
  },
  {
    game: 'nikke',
    name: 'Queen (Makoto Niijima) Pick Up',
    type: 'banner',
    start: '2026-08-13 07:00',
    end: '2026-09-10 04:59',
    notes: 'SSR Fire. Collab limited.',
    sourceKey: 'seed:nikke:queen-pickup',
  },
  {
    game: 'nikke',
    name: 'Yukiko Amagi Pick Up',
    type: 'banner',
    start: '2026-08-20 05:00',
    end: '2026-09-10 04:59',
    sourceKey: 'seed:nikke:yukiko-pickup',
  },
  {
    game: 'nikke',
    name: 'Phantom – Saint Thief costume gacha',
    type: 'banner',
    start: '2026-08-13 07:00',
    end: '2026-09-10 04:59',
    sourceKey: 'seed:nikke:phantom-saint-thief-costume',
  },
  {
    game: 'nikke',
    name: "Phantom Thieves' Calling Card — 14-day login",
    type: 'event',
    dailyTouch: true,
    start: '2026-08-13 07:00',
    end: '2026-09-10 04:59',
    notes: 'Pays SR Aigis, Advanced Recruit Vouchers and development materials over 14 claims.',
    sourceKey: 'seed:nikke:phantom-thieves-login',
  },
  {
    game: 'nikke',
    name: 'THIEF QUEEN PASS',
    type: 'event',
    start: '2026-08-13 07:00',
    end: '2026-09-10 04:59',
    notes: "Reward: Queen's Pajamas costume.",
    sourceKey: 'seed:nikke:thief-queen-pass',
  },
  {
    game: 'nikke',
    name: 'SNOW FLAKES PASS',
    type: 'event',
    start: '2026-08-20 05:00',
    end: '2026-09-10 04:59',
    notes: 'Reward: Winter Roomwear costume.',
    sourceKey: 'seed:nikke:snow-flakes-pass',
  },
  {
    game: 'nikke',
    name: 'Trail Marker',
    type: 'event',
    start: '2026-08-13 07:00',
    end: '2026-10-08 04:59',
    notes: 'Clear all Main Scenarios for rewards, with a bonus for Story Difficulty. Long-runner.',
    sourceKey: 'seed:nikke:trail-marker-2026-08',
  },
  {
    game: 'nikke',
    name: 'Solo Raid Season 40',
    type: 'event',
    start: '2026-08-20 12:00',
    end: '2026-08-27 04:59',
    sourceKey: 'seed:nikke:solo-raid-40',
  },
  {
    game: 'nikke',
    name: 'FULL BURST DAY',
    type: 'event',
    dailyTouch: true,
    start: '2026-08-22 05:00',
    end: '2026-08-24 04:59',
    notes: 'One extra Interception and one extra Simulation Room reward set.',
    sourceKey: 'seed:nikke:full-burst-2026-08-22',
  },
  {
    game: 'nikke',
    name: 'FULL BURST DAY',
    type: 'event',
    dailyTouch: true,
    start: '2026-08-29 05:00',
    end: '2026-08-31 04:59',
    notes: 'One extra Interception and one extra Simulation Room reward set.',
    sourceKey: 'seed:nikke:full-burst-2026-08-29',
  },
  {
    game: 'nikke',
    name: 'Coordinated Operation: Gatekeeper',
    type: 'cycle',
    start: '2026-08-21 12:00',
    end: '2026-08-23 23:59',
    notes: 'Second of three weekends. Five-Commander raid; Broken Cores exchange in the Recycling Shop.',
    sourceKey: 'seed:nikke:coop-gatekeeper-2',
  },
  {
    game: 'nikke',
    name: 'Coordinated Operation: Gatekeeper',
    type: 'cycle',
    start: '2026-08-28 12:00',
    end: '2026-08-30 23:59',
    notes: 'Third of three weekends.',
    sourceKey: 'seed:nikke:coop-gatekeeper-3',
  },
  // Season 9 runs 2026-06-30 05:00 to 2026-09-22 04:59 and the reward record resets every
  // 14 days at the Tuesday 05:00 reset. Chaining from the published start lands exactly on
  // the published season end, which is what makes the derivation trustworthy.
  {
    game: 'nikke',
    name: 'Simulation Room: Overclock — reward cycle',
    type: 'cycle',
    start: '2026-08-11 05:00',
    end: '2026-08-25 04:59',
    notes: 'Season 9. Live cycle — observable in-game.',
    sourceKey: 'seed:nikke:overclock-2026-08-11',
  },
  {
    game: 'nikke',
    name: 'Simulation Room: Overclock — reward cycle',
    type: 'cycle',
    notify: false,
    start: '2026-08-25 05:00',
    end: '2026-09-08 04:59',
    notes:
      'Season 9. Computed from the published season start and the published 14-day reset rule — no per-cycle notice exists. Verify in-game.',
    sourceKey: 'seed:nikke:overclock-2026-08-25',
  },
  {
    game: 'nikke',
    name: 'Simulation Room: Overclock — reward cycle',
    type: 'cycle',
    notify: false,
    start: '2026-09-08 05:00',
    end: '2026-09-22 04:59',
    notes: 'Final Season 9 cycle; closes on the published season end. Same derivation caveat.',
    sourceKey: 'seed:nikke:overclock-2026-09-08',
  },

  /* ================================================== ARKNIGHTS: ENDFIELD — v1.4 "Homecoming"
     (from Jul 15/16). GRYPHLINE runs ONE combined Americas/Europe server on UTC-5, so these
     clock times are the AM/EU ones, not the Asia UTC+8 figures in the notices.

     CONVENTION: SPLIT, and the split happens INSIDE a single notice line. Endfield prints
     dual server columns, and the same row shows a 0-hour gap on the start and a 13-hour gap
     on the end:
       The Rooted Realm  Asia 2026/08/09 12:00 – 2026/09/02 06:00 (UTC+8)
                         AmEu 2026/08/09 12:00 – 2026/09/01 17:00 (UTC-5)
     So event/banner OPENS are LOCAL (copy unshifted) and version-boundary ENDS are GLOBAL
     (Asia -13h, which moves the date back a day). Blind-converting the 12:00 opens would
     have dragged every phase-2 row to 2026-08-08 23:00 and broken the game.

     The version end is no longer inferred: the official notes print the second Sanity Supply
     window's AmEu close directly as Sept. 1, 2026 at 17:00 (UTC-5). v1.4 ends there, and the
     "verify in-game" hedges are gone from the rows that hang off it.

     Known upstream defect: GRYPHLINE's own two columns disagree by 2h on that boundary
     (Asia says Sept. 2 04:00 UTC+8 = Sept. 1 15:00 UTC-5). The printed AmEu 17:00 is used
     throughout, corroborated by the wiki's dual tables.

     v1.5 DOES have a date now. The developer preview aired 2026-08-21 and GRYPHLINE has
     announced v1.5 "Dreamscape of Wind and Snow" for September 2 — which is the Asia-column
     date. On this block's UTC-5 clock that is the evening of Sept 1, immediately after the
     1.4 boundary, so the maintenance row below reads 09-01 17:00 → 23:00. The hour is the
     1.4 window's shape, not a published one, so the row stays silent. */
  {
    game: 'endfield',
    name: 'Monumental Etching: Beastly Howl',
    type: 'event',
    start: '2026-08-06 12:00',
    // Was 2026-08-20 04:00 — an unshifted copy of a daily-reset time, ~11h late. The
    // notice's Americas/Europe column prints 2026/08/19 17:00 (UTC-5).
    end: '2026-08-19 17:00',
    sourceKey: 'seed:endfield:1.4-etching',
  },
  {
    game: 'endfield',
    name: 'Like a Star Streaking Through the Boundaries',
    type: 'event',
    start: '2026-08-09 12:00',
    end: '2026-09-01 17:00',
    notes: 'Phase 2 narrative event.',
    sourceKey: 'seed:endfield:1.4-like-a-star',
  },
  {
    game: 'endfield',
    name: 'Good Morning from Your Dawnstar — Liino',
    type: 'banner',
    start: '2026-08-09 12:00',
    end: '2026-09-01 17:00',
    notes:
      'Runs to the 1.4 end. The banner notice says only "before version update and maintenance"; the boundary comes from the Sanity Supply second window in the same notes.',
    sourceKey: 'seed:endfield:1.4-liino',
  },
  {
    game: 'endfield',
    name: 'Combat Drills: Liino',
    type: 'event',
    start: '2026-08-09 12:00',
    end: '2026-09-01 17:00',
    notes: 'Combat Drills run for the duration of each Chartered Headhunting banner.',
    sourceKey: 'seed:endfield:1.4-drills-liino',
  },
  {
    game: 'endfield',
    name: 'Bedazzling Dawnstar — 7-day sign-in',
    type: 'event',
    dailyTouch: true,
    start: '2026-08-09 12:00',
    end: '2026-09-01 17:00',
    notes: 'Five event Headhunting Permits over seven sign-ins.',
    sourceKey: 'seed:endfield:1.4-bedazzling-signin',
  },
  {
    game: 'endfield',
    name: 'The Rooted Realm',
    type: 'event',
    start: '2026-08-09 12:00',
    end: '2026-09-01 17:00',
    notes: '1,600 Oroberyl.',
    sourceKey: 'seed:endfield:1.4-rooted-realm',
  },
  {
    game: 'endfield',
    name: 'Sanity Supply (second window)',
    type: 'event',
    dailyTouch: true,
    start: '2026-08-26 04:00',
    end: '2026-09-01 17:00',
    notes:
      'Daily missions pay Sanity Usage Permits and Emergency Sanity Boosters. This is the row that pins the 1.4 boundary.',
    sourceKey: 'seed:endfield:1.4-sanity-2',
  },
  {
    game: 'endfield',
    name: 'v1.5 "Dreamscape of Wind and Snow" update maintenance',
    type: 'maintenance',
    notify: false,
    // Announced for "September 2" — the Asia column. This block runs on the ONE
    // combined AmEu server at UTC-5, where that is the evening of Sept 1, landing
    // exactly on the 1.4 boundary. The 6h length copies the 1.4 window; GRYPHLINE
    // has not published this one.
    start: '2026-09-01 17:00',
    end: '2026-09-01 23:00',
    notes: 'Date announced, window not — the 6h length is copied from the v1.4 maintenance.',
    sourceKey: 'seed:endfield:1.5-maint',
  },
  // Echoes of War is now fully sourced, not community-derived: Recalling I/II/III ran
  // 7/7/10 days and Delirating I/II/III run 7/7/10, the third of each season stretching to
  // the version boundary. Instances share the bare name so the connectors group.
  {
    game: 'endfield',
    name: 'Echoes of War',
    type: 'cycle',
    start: '2026-08-16 04:00',
    end: '2026-08-23 03:59',
    notes: 'Season of Delirating — Cycle II. 7-day cycle.',
    sourceKey: 'seed:endfield:eow-delirating-2',
  },
  {
    game: 'endfield',
    name: 'Echoes of War',
    type: 'cycle',
    start: '2026-08-23 04:00',
    end: '2026-09-01 17:00',
    notes: 'Season of Delirating — Cycle III. Runs 10 days, to the 1.4 end.',
    sourceKey: 'seed:endfield:eow-delirating-3',
  },

  /* ================================================== NEXT PATCH LIVESTREAMS
     The broadcast that reveals the next version, and therefore the cue to refresh
     this whole file. An announced stream is stored as the broadcast itself; an
     unannounced one is stored as the plausible RANGE its history implies, with
     the offsets it came from in `notes` so the next refresh can re-derive it
     instead of trusting this row. All times are the Europe (UTC+1) wall clock.

     Offsets observed on 2026-08-27: Genshin 12-13 days before release, Fridays
     13:00. HSR 6-12 (one outlier at 6), Fridays 12:30. WuWa 6-14, Fridays 12:00.
     NTE exactly 11 every time, Saturdays 12:30.

     LADS, Uma and NIKKE are absent on purpose: none of the three runs a
     recurring patch broadcast, only news posts. Endfield's 1.5 preview already
     aired on 2026-08-21 and there is not enough 1.6 history to predict one. */
  {
    game: 'zzz',
    name: 'ZZZ 3.2 Special Program',
    type: 'livestream',
    start: '2026-08-28 12:30',
    end: '2026-08-28 14:30',
    notes:
      'Officially announced: 19:30 UTC+8. Reveals the v3.2 slate — refresh this file after it airs.',
    sourceKey: 'seed:zzz:3.2-livestream',
  },
  {
    game: 'genshin',
    name: 'Genshin 7.1 Special Program — predicted window',
    type: 'livestream',
    start: '2026-09-09 13:00',
    end: '2026-09-13 15:00',
    notes:
      'Not announced. Last five programs ran 12-13 days before release, Fridays 13:00; 7.1 is expected 09-23, so 09-11 is the single most likely date.',
    sourceKey: 'seed:genshin:7.1-livestream',
  },
  {
    game: 'hsr',
    name: 'HSR 4.6 Special Program — predicted window',
    type: 'livestream',
    start: '2026-09-16 12:30',
    end: '2026-09-18 14:30',
    notes:
      'Not announced. v4.6 goes live 09-28 04:00, and the usual offset is 10-12 days on a Friday 12:30 — which lands on 09-18 almost exactly.',
    sourceKey: 'seed:hsr:4.6-livestream',
  },
  {
    game: 'wuwa',
    name: 'WuWa 3.7 livestream — predicted window',
    type: 'livestream',
    start: '2026-09-16 12:00',
    end: '2026-09-24 14:00',
    notes:
      'Not announced. Recent offsets cluster at 10-14 days, Fridays 12:00, against an expected 09-30 release. Most likely 09-18.',
    sourceKey: 'seed:wuwa:3.7-livestream',
  },
  {
    game: 'nte',
    name: 'NTE 1.4 Preview Special Program — predicted window',
    type: 'livestream',
    start: '2026-09-16 12:30',
    end: '2026-09-22 14:30',
    notes:
      'Not announced. Every preview so far landed exactly 11 days before release, Saturdays 12:30 — the tightest pattern of the nine. Most likely 09-19.',
    sourceKey: 'seed:nte:1.4-livestream',
  },
];

export interface PlannedSeed {
  /** 'stamp' records the fingerprint on an existing row WITHOUT rewriting it. */
  kind: 'add' | 'update' | 'stamp' | 'remove';
  /** Set for updates and removals — the id of the already-imported event. */
  eventId?: string;
  gameId: string;
  /** Absent on removals: the row is gone from the bundle, so there is no seed. */
  seed?: SeedEvent;
  start?: number;
  end?: number;
  /** The fingerprint to stamp on the event — set for adds and updates. */
  hash?: string;
}

/**
 * A short, stable digest of exactly the fields the bundle owns.
 *
 * This is the whole mechanism behind "refresh my dates, keep my edits". The
 * importer stamps this on every row it writes; on the next refresh it hashes
 * the row again and compares. Equal means untouched since the feed wrote it, so
 * a correction is safe. Unequal means a human edited the row, and the feed
 * stops touching it — permanently, and for every field, because it cannot tell
 * WHICH field you meant to own.
 *
 * `done` is deliberately excluded: ticking something off is not an edit to the
 * event, and a done row should still get a corrected end date.
 */
function fingerprint(fields: {
  name: string;
  type: EventType;
  start: number;
  end: number;
  dailyTouch: boolean;
  notify: boolean;
  notes: string;
}): string {
  const payload = [
    fields.name,
    fields.type,
    String(fields.start),
    String(fields.end),
    fields.dailyTouch ? '1' : '0',
    fields.notify ? '1' : '0',
    fields.notes,
  ].join('\u0000');
  // FNV-1a. Not cryptographic and does not need to be: it guards against
  // accidental collision between two versions of the same row, not an attacker.
  let h = 0x811c9dc5;
  for (let i = 0; i < payload.length; i++) {
    h ^= payload.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/** What the bundle says this row should be. */
function seedFingerprint(seed: SeedEvent, start: number, end: number): string {
  return fingerprint({
    name: seed.name,
    type: seed.type,
    start,
    end,
    dailyTouch: seed.dailyTouch ?? false,
    notify: seed.notify ?? true,
    notes: seed.notes ?? '',
  });
}

/**
 * What the stored row actually is right now, edits included. Exported because it
 * IS the contract: a row whose `seedHash` still equals this is the bundle's to
 * correct, and a row where it does not is yours.
 */
export function eventFingerprint(event: GameEvent): string {
  return fingerprint({
    name: event.name,
    type: event.type,
    start: event.start,
    end: event.end,
    dailyTouch: event.dailyTouch,
    notify: event.notify,
    notes: event.notes,
  });
}

/** True when nobody has edited the row since the bundle stamped it. */
function isPristine(event: GameEvent): boolean {
  return event.seedHash !== undefined && event.seedHash === eventFingerprint(event);
}

function parseServerTime(s: string, tz: string): number | null {
  const dt = DateTime.fromFormat(s, 'yyyy-LL-dd HH:mm', { zone: tz });
  return dt.isValid ? dt.toMillis() : null;
}

/** Find every live account attached to a preset, including legacy games. */
function gamesForPreset(games: Game[], key: string): Game[] {
  // Badge text changes over time. Using the shared matcher here keeps a stored
  // preset key or legacy alias from losing its bundled Timeline events.
  return games.filter((game) => !game.deleted && presetForGame(game)?.key === key);
}

function sourceIdentity(gameId: string, sourceKey: string): string {
  return `${gameId}\u0000${sourceKey}`;
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
  // Built from ALL events, tombstones included. Filtering to live events makes a
  // deleted seed invisible here, so the add branch below re-creates it — which
  // was survivable while importing was a button you pressed, and would mean
  // resurrecting everything you deleted on every launch now that it is automatic.
  // Keep sourceKey unchanged on the event: HoYoLAB dedupes against that value.
  // Only this lookup needs an account scope, or one account hides another's seed.
  const byKey = new Map(
    state.events
      .filter((event) => event.sourceKey)
      .map((event) => [sourceIdentity(event.gameId, event.sourceKey!), event]),
  );
  const refreshSeeds = state.settings.seedImportedVersion !== SEED_UPDATED;
  // Ids the current bundle still accounts for; anything stamped and missing from
  // this set has been dropped upstream.
  const seenKeys = new Set<string>();
  for (const seed of SEED_EVENTS) {
    for (const game of gamesForPreset(state.games, seed.game)) {
      const start = parseServerTime(seed.start, game.tz);
      const end = parseServerTime(seed.end, game.tz);
      if (start == null || end == null || end <= start) continue;
      const hash = seedFingerprint(seed, start, end);
      const existing = byKey.get(sourceIdentity(game.id, seed.sourceKey));
      if (existing) {
        seenKeys.add(existing.id);
        if (!refreshSeeds || existing.deleted) continue;
        if (existing.seedHash === undefined) {
          // Imported before fingerprints existed, so there is no baseline to
          // compare against and no way to tell an edit from an older bundle.
          // Apply the rule that was in force when the row was written — dates and
          // name only, the objective facts — and stamp it either way, so this is
          // the LAST refresh that has to guess about this row.
          if (existing.start !== start || existing.end !== end || existing.name !== seed.name) {
            out.push({ kind: 'update', eventId: existing.id, gameId: game.id, seed, start, end, hash });
          } else {
            // Values already agree, so record the baseline without touching the
            // row: any note or muted alert the user added here survives, and is
            // what marks the row as theirs from the next refresh on.
            out.push({ kind: 'stamp', eventId: existing.id, gameId: game.id, hash });
          }
          continue;
        }
        // Dates and name are not all a refresh corrects: a row promoted from
        // community estimate to official notice keeps its window and changes only
        // `notify`. So the comparison is the whole fingerprint — but it is gated
        // on the row being untouched, or that same breadth would overwrite the
        // edits it is meant to protect.
        if (existing.seedHash !== hash && isPristine(existing)) {
          out.push({ kind: 'update', eventId: existing.id, gameId: game.id, seed, start, end, hash });
        }
        continue;
      }
      if (end <= now) continue;
      const name = seed.name.trim().toLowerCase();
      const twin = live.some(
        (event) =>
          event.gameId === game.id &&
          event.name.trim().toLowerCase() === name &&
          event.start <= end &&
          start <= event.end,
      );
      if (twin) continue;
      out.push({ kind: 'add', gameId: game.id, seed, start, end, hash });
    }
  }

  // Rows the bundle used to carry and no longer does — a cancelled event, or one
  // that was simply wrong. Left alone they would sit on the timeline forever,
  // because nothing else ever deletes them.
  //
  // Only rows the bundle demonstrably wrote (they carry a stamp) and that nobody
  // has since edited or ticked off are withdrawn. A ⤓ HoYoLAB import has no
  // stamp and is never touched; neither is anything you changed.
  //
  // One-cycle warm-up: a row already orphaned BEFORE fingerprints shipped never
  // gets stamped, so it can never be withdrawn here. Everything still in the
  // bundle today is stamped by the pass above, so from the next bundle onward
  // withdrawal is complete. The gap is bounded and shrinks to nothing.
  if (refreshSeeds) {
    for (const event of state.events) {
      if (event.deleted || event.done || seenKeys.has(event.id)) continue;
      if (!isPristine(event)) continue;
      out.push({ kind: 'remove', eventId: event.id, gameId: event.gameId });
    }
  }
  return out;
}
