import type { BannerKind, EventType } from '@memoria/shared';

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
 * Refreshed 2026-09-02, mid-patch for six of the nine games and across a version
 * boundary for three. What changed:
 *   - ENDFIELD had NO v1.5 content at all — the version went live on 09-01 23:00
 *     (Americas clock) the day before this pass and the block still ended at the
 *     1.4 maintenance. Twelve rows added. Its close is genuinely unpublished, so
 *     every row that depends on it says so.
 *   - UMA ran dry on 09-02 and NIKKE on 09-10. Both blocks now reach into
 *     October.
 *   - ZZZ's 3.2 Special Program aired on 08-28 as scheduled, so the 3.2 banner
 *     slate exists — as press rows, because the in-game notices do not publish
 *     until the 09-09 update. The 3.1 block was re-checked against the feed
 *     line by line and needed nothing: all twenty-two rows already matched.
 *   - GENSHIN gained the four 7.0 rows the feed carries and this file did not
 *     (TCG Heated Battle, Spooky Summer Adventures, the timed Archon Quest
 *     reward, and the 09-16 Spiral Abyss), and the phase-2 banner guess became
 *     three real ann rows — 21805 / 21806 / 21808, opening 09-01 18:00 exactly
 *     as predicted. The 7.0 notice also states the Abyss dates outright
 *     ("Phase 1 ... on August 16", "Phase 2 ... on September 16"), which settles
 *     the once-a-month-on-the-16th reading for good.
 *   - HSR needed almost nothing: the 4.5 slate this file shipped on 08-27 from
 *     the update notice is still exactly what the feed says. Phase 1's warp
 *     notice (ann 1330) has since published and confirms the estimated
 *     boundaries, and Anomaly Arbitration's 4.5 theme is now named.
 *   - LADS remains the one game with no reachable feed. It gets the two rows
 *     that could be sourced and nothing else.
 *
 * SOURCE KEYS ARE NOT UPGRADED IN PLACE. Several rows now have an ann_id that
 * they did not have when they were written under a `seed:` key. Rewriting the
 * key would withdraw the installed row and re-add it as a new one, losing its
 * tick mark for no gain, so an ann_id is used only for a row this file has never
 * shipped. The id goes in `notes` instead when it is worth recording.
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
export const SEED_UPDATED = '2026-09-17';
/** Invalid source windows withdrawn even from an earlier build on the same day. */
export const SEED_WITHDRAWN_KEYS = ['seed:endfield:1.5-deep-cold-issue'];

/**
 * How long a finished event is worth keeping. Two months.
 *
 * This is one rule with two halves that have to agree. The bundle above ships no
 * row that ended longer ago than this (there is a test), and the importer drops
 * imported rows once they pass it, so a document cannot accumulate years of dead
 * banners. The timeline only draws about thirteen days of history anyway
 * (RANGE_DAYS / 3), so everything this removes has been invisible for weeks.
 *
 * Only rows the feed created are swept: they carry a `seedHash`. Anything you
 * wrote yourself, and anything pulled in through ⤓ HoYoLAB, is never touched by
 * age — those are your records, and their lifetime is your call.
 */
export const SEED_RETENTION_MS = 60 * 86_400_000;

export interface SeedEvent {
  bannerKind?: BannerKind;
  category?: 'teyvat' | 'miliastra';
  /** Preset key — matched against the stored preset id, with legacy name/short fallbacks. */
  game: string;
  name: string;
  type: EventType;
  /** 'yyyy-MM-dd HH:mm' in the game's server timezone. */
  start: string;
  end: string;
  /** A global broadcast uses one instant across every server. */
  timezone?: string;
  /** A global maintenance finish can open an event whose close is server-local. */
  startTimezone?: string;
  /** A global close may follow a server-local opening. */
  endTimezone?: string;
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
    start: '2026-07-16 04:00',
    end: '2026-08-16 04:00',
    notes: 'Resets the 16th, monthly.',
    sourceKey: 'seed:genshin:abyss-2026-07',
  },
  {
    game: 'genshin',
    name: 'Spiral Abyss',
    type: 'cycle',
    notify: false,
    start: '2026-08-16 04:00',
    end: '2026-09-16 04:00',
    notes: 'Resets the 16th, monthly.',
    sourceKey: 'seed:genshin:abyss-2026-08',
  },
  {
    game: 'genshin',
    name: 'Imaginarium Theater',
    type: 'cycle',
    start: '2026-07-01 04:00',
    end: '2026-08-01 04:00',
    notes: 'Resets the 1st, monthly.',
    sourceKey: 'seed:genshin:theater-2026-07',
  },
  {
    game: 'genshin',
    name: 'Imaginarium Theater',
    type: 'cycle',
    notify: false,
    start: '2026-08-01 04:00',
    end: '2026-09-01 04:00',
    notes: 'Resets the 1st, monthly.',
    sourceKey: 'seed:genshin:theater-2026-08',
  },
  // --- banners
  {
    game: 'genshin',
    name: 'Sandrone — To the Looking-Glass the Mademoiselle Said',
    type: 'banner',
    bannerKind: 'character',
    start: '2026-07-01 04:00',
    end: '2026-07-21 17:59',
    sourceKey: 'genshin:21743',
  },
  {
    game: 'genshin',
    name: "Citlali — Starry Night's Whispers",
    type: 'banner',
    bannerKind: 'character',
    start: '2026-07-01 04:00',
    end: '2026-07-21 17:59',
    sourceKey: 'genshin:21744',
  },
  {
    game: 'genshin',
    name: 'Epitome Invocation — Sandrone/Citlali weapons',
    type: 'banner',
    bannerKind: 'weapon',
    start: '2026-07-01 04:00',
    end: '2026-07-21 17:59',
    sourceKey: 'genshin:21745',
  },
  {
    game: 'genshin',
    name: 'Lightrace Wish — Heavenlit Prophecy',
    type: 'banner',
    bannerKind: 'character',
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
    bannerKind: 'character',
    start: '2026-07-21 18:00',
    end: '2026-08-11 14:59',
    sourceKey: 'seed:genshin:6.7-columbina',
  },
  {
    game: 'genshin',
    name: 'Raiden Shogun — Reign of Serenity (phase 2)',
    type: 'banner',
    bannerKind: 'character',
    start: '2026-07-21 18:00',
    end: '2026-08-11 14:59',
    sourceKey: 'seed:genshin:6.7-raiden',
  },
  {
    game: 'genshin',
    name: "Epitome Invocation — Nocturne's Curtain Call / Engulfing Lightning (phase 2)",
    type: 'banner',
    bannerKind: 'weapon',
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
    bannerKind: 'character',
    start: '2026-08-12 04:00',
    end: '2026-09-01 17:59',
    sourceKey: 'seed:genshin:7.0-p1',
  },
  {
    game: 'genshin',
    name: "Arlecchino — The Hearth's Ashen Shadow (phase 1)",
    type: 'banner',
    bannerKind: 'character',
    start: '2026-08-12 04:00',
    end: '2026-09-01 17:59',
    sourceKey: 'genshin:21804',
  },
  {
    game: 'genshin',
    name: 'Epitome Invocation — Whitelake Frostfeather / Crimson Moon’s Semblance (phase 1)',
    type: 'banner',
    bannerKind: 'weapon',
    start: '2026-08-12 04:00',
    end: '2026-09-01 17:59',
    sourceKey: 'genshin:21807',
  },
  /* Phase 2 published on 08-27 and the estimate this file carried was right to
     the minute: 09-01 18:00 - 09-22 14:59, both t_lc. The single combined guess
     is retired in favour of the three rows the feed actually ships. */
  {
    game: 'genshin',
    name: 'Flins — The Lone Light Knocks at Night (phase 2)',
    type: 'banner',
    bannerKind: 'character',
    start: '2026-09-01 18:00',
    end: '2026-09-22 14:59',
    sourceKey: 'genshin:21805',
  },
  {
    game: 'genshin',
    name: 'Ineffa — Astral Actuation (phase 2)',
    type: 'banner',
    bannerKind: 'character',
    start: '2026-09-01 18:00',
    end: '2026-09-22 14:59',
    sourceKey: 'genshin:21806',
  },
  {
    game: 'genshin',
    name: 'Epitome Invocation — Bloodsoaked Ruins / Fractured Halo (phase 2)',
    type: 'banner',
    bannerKind: 'weapon',
    start: '2026-09-01 18:00',
    end: '2026-09-22 14:59',
    sourceKey: 'genshin:21808',
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
    start: '2026-08-28 10:00',
    end: '2026-09-14 03:59',
    notes:
      'Official now (ann 21813) — the estimated dates were right. Four minigames; rank high enough to invite Diona. Phases II and III unlock 08-30 and 09-01 at 04:00.',
    sourceKey: 'seed:genshin:7.0-expeditionist',
  },
  {
    game: 'genshin',
    name: 'Overflowing Abundance — double drops',
    type: 'event',
    dailyTouch: true,
    start: '2026-09-14 04:00',
    end: '2026-09-21 03:59',
    notes:
      'Official announcement 20888: server-local times. Three double talent-book or weapon-material claims per day.',
    sourceKey: 'seed:genshin:7.0-abundance',
  },
  {
    game: 'genshin',
    name: 'Trial of the Bastion',
    type: 'event',
    start: '2026-09-07 10:00',
    end: '2026-09-17 03:59',
    notes:
      'Official announcement 21816: both boundaries are server-local. Five defense trials; each requires the previous trial. Requires AR20, Prologue Act III and Gunfire in the Silent Lands.',
    sourceKey: 'genshin:21816',
  },
  {
    game: 'genshin',
    name: 'Starlight Voyage: Joyous Moment — quests',
    type: 'event',
    start: '2026-09-07 10:00',
    end: '2026-09-17 04:00',
    notes:
      'Official announcement 21831: quest completion ends before the reward claim window. Requires an awakened Miliastra Wonderland Manekin. Times are server-local.',
    category: 'miliastra',
    sourceKey: 'seed:genshin:7.0-starlight-voyage-quests',
  },
  {
    game: 'genshin',
    name: 'Starlight Voyage: Joyous Moment — claim rewards',
    type: 'event',
    start: '2026-09-07 10:00',
    end: '2026-09-21 03:59',
    notes:
      'Official announcement 21831: claim Prismatic Crystals before this deadline. Quests close September 17 at 04:00 server time; this later close does not extend gameplay.',
    category: 'miliastra',
    sourceKey: 'genshin:21831',
  },
  {
    game: 'genshin',
    name: 'Event Ode: Phantasmagoric Discourse',
    type: 'event',
    start: '2026-08-12 04:00',
    end: '2026-09-22 14:59',
    notes: 'Runs the whole of 7.0.',
    category: 'miliastra',
    sourceKey: 'seed:genshin:7.0-event-ode',
  },
  {
    game: 'genshin',
    name: 'Raiment Collection: Gentle Warmth',
    type: 'event',
    start: '2026-08-12 04:00',
    end: '2026-09-23 05:59',
    notes: 'Outfit campaign — closes an hour past the version boundary.',
    category: 'miliastra',
    sourceKey: 'seed:genshin:7.0-raiment',
  },
  {
    game: 'genshin',
    name: 'Miliastra Wonderland: Chronicle',
    type: 'event',
    start: '2026-08-12 04:00',
    end: '2026-09-21 03:59',
    category: 'miliastra',
    sourceKey: 'seed:genshin:7.0-miliastra-chronicle',
  },
  {
    game: 'genshin',
    name: 'Miliastra Wonderland: Phantasmagoric Season — Play Phase',
    type: 'event',
    start: '2026-08-13 10:00',
    end: '2026-09-22 03:59',
    notes: 'Play phase; the showcase phase follows it.',
    category: 'miliastra',
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
    end: '2026-10-01 04:00',
    notes: 'Resets the 1st, monthly. September season confirmed open; close is the monthly cadence.',
    sourceKey: 'seed:genshin:theater-2026-09',
  },
  {
    game: 'genshin',
    name: 'Imaginarium Theater',
    type: 'cycle',
    notify: false,
    start: '2026-10-01 04:00',
    end: '2026-11-01 04:00',
    notes: 'Resets the 1st, monthly. Cadence, not a notice — the October season has not been announced.',
    sourceKey: 'seed:genshin:theater-2026-10',
  },
  {
    game: 'genshin',
    name: 'Spiral Abyss',
    type: 'cycle',
    start: '2026-09-16 04:00',
    end: '2026-10-16 04:00',
    notes:
      'The 7.0 notice states this one outright: "Phase 2 of the Spiral Abyss will be updated on September 16." Resets the 16th, once a month.',
    sourceKey: 'seed:genshin:abyss-2026-09',
  },
  /* --- 7.0 rows the feed carries that this file did not, found on the 09-02 pass.
     All three are t_lc and copy across unshifted. */
  {
    game: 'genshin',
    name: 'Genius Invokation TCG: Tactical Formation',
    type: 'event',
    start: '2026-08-29 10:00',
    end: '2026-09-14 03:59',
    notes: 'Heated Battle Mode. Deck-building rules change for the run — worth a look before it closes.',
    sourceKey: 'genshin:20748',
  },
  {
    game: 'genshin',
    name: 'Spooky Summer Adventures — Spooky Boo Hat',
    type: 'event',
    start: '2026-08-17 12:00',
    end: '2026-09-04 03:59',
    notes: 'Miliastra Wonderland cosmetic. The QUESTS close first, on 08-31 03:59; only the claim runs to 09-04.',
    category: 'miliastra',
    sourceKey: 'genshin:21829',
  },
  {
    game: 'genshin',
    name: 'Archon Quest "Everwinter Without Mercy" — timed reward',
    type: 'event',
    start: '2026-08-12 04:00',
    end: '2026-09-22 14:59',
    notes: 'Extra Primogems and ascension materials for finishing Chapter VII within 7.0. Closes with the version.',
    sourceKey: 'genshin:21809',
  },
  {
    game: 'genshin',
    name: 'v7.1 update maintenance',
    type: 'maintenance',
    start: '2026-09-22 23:00',
    end: '2026-09-23 04:00',
    notes:
      'Derived the same way 7.0 was and from the same feed: every 7.0 notice expires 2026-09-22 23:00 on the Europe clock, and HoYo prints "estimated to take 5 hours" for every version update. The 7.1 notice itself is not out.',
    sourceKey: 'seed:genshin:7.1-maint',
  },
  // Official 7.1 calendar gives dates in UTC+8, without hours. These display
  // whole calendar days until timed notices publish; they must not send alerts.
  {
    game: 'genshin',
    name: 'Silverwing in Pursuit of the Moon',
    type: 'event',
    start: '2026-09-24 00:00',
    end: '2026-10-12 23:59',
    timezone: 'UTC+8',
    notify: false,
    notes:
      'Official calendar dates only; displayed hours are placeholders. Exact server schedule awaits its notice. Source: https://www.hoyolab.com/article/46673425',
    sourceKey: 'seed:genshin:7.1-silverwing',
  },
  {
    game: 'genshin',
    name: 'Predictive Victory Dynamics',
    type: 'event',
    start: '2026-10-12 00:00',
    end: '2026-10-20 23:59',
    timezone: 'UTC+8',
    notify: false,
    notes:
      'Official calendar dates only; displayed hours are placeholders. Announcement period continues to October 23. Exact server schedule awaits its notice. Source: https://www.hoyolab.com/article/46673425',
    sourceKey: 'seed:genshin:7.1-predictive-victory',
  },
  {
    game: 'genshin',
    name: 'Carefree Snowball Fight',
    type: 'event',
    start: '2026-10-21 00:00',
    end: '2026-11-02 23:59',
    timezone: 'UTC+8',
    notify: false,
    notes:
      'Official calendar dates only; displayed hours are placeholders. Exact server schedule awaits its notice. Source: https://www.hoyolab.com/article/46673425',
    sourceKey: 'seed:genshin:7.1-snowball',
  },
  {
    game: 'genshin',
    name: 'Overflowing Favor',
    type: 'event',
    start: '2026-10-26 00:00',
    end: '2026-11-02 23:59',
    timezone: 'UTC+8',
    dailyTouch: true,
    notify: false,
    notes:
      'Official calendar dates only; displayed hours are placeholders. Exact server schedule awaits its notice. Source: https://www.hoyolab.com/article/46673425',
    sourceKey: 'seed:genshin:7.1-overflowing-favor',
  },
  {
    game: 'genshin',
    name: 'Stygian Onslaught',
    type: 'cycle',
    start: '2026-09-30 00:00',
    end: '2026-11-03 23:59',
    timezone: 'UTC+8',
    notify: false,
    notes:
      'v7.1 rotation. Official calendar dates only; displayed hours are placeholders. Exact server schedule awaits its notice. Source: https://www.hoyolab.com/article/46673425',
    sourceKey: 'seed:genshin:7.1-stygian',
  },

  /* ================================================== HONKAI: STAR RAIL — v4.4 "In Ravages
     Does the Whistle Sound" (Fate collab, Jul 15 – Aug 25), then v4.5 "To Roll the Stars in Astropolis" on
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
    bannerKind: 'character',
    start: '2026-07-15 04:00',
    end: '2026-08-25 15:00',
    sourceKey: 'seed:hsr:4.4-himeko-nova',
  },
  {
    game: 'hsr',
    name: 'A Star That Lights the Night — Light Cone Warp',
    type: 'banner',
    bannerKind: 'weapon',
    start: '2026-07-15 04:00',
    end: '2026-08-25 15:00',
    sourceKey: 'seed:hsr:4.4-himeko-lc',
  },
  {
    game: 'hsr',
    name: 'Cerydra · Anaxa · Aventurine reruns (phase 2)',
    type: 'banner',
    bannerKind: 'character',
    start: '2026-08-05 12:00',
    end: '2026-08-25 15:00',
    sourceKey: 'seed:hsr:4.4-p2-reruns',
  },
  {
    game: 'hsr',
    name: 'Phase 2 Light Cone Warps — Golden Blood · Cast to Flames · Unjust Destiny',
    type: 'banner',
    bannerKind: 'weapon',
    start: '2026-08-05 12:00',
    end: '2026-08-25 15:00',
    sourceKey: 'seed:hsr:4.4-p2-lc',
  },
  // --- maintenance
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
  /* --- v4.5 "To Roll the Stars in Astropolis" (Aug 26 – Sep 27). The update notice has published, so the
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
    notes: 'Flagship 4.5 event, on an official notice. Closes 2h01 before maintenance, not at it.',
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
    notes:
      'Version-aligned. This period’s theme is "Return of the Legion" — named in the 4.5 notice, which as always prints no boundaries for it.',
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
    notes: 'Domain Genesis. Officially SHORTENED to 5 weeks alongside Apocalyptic Shadow; both run on into v4.6.',
    sourceKey: 'seed:hsr:pf-4.5',
  },
  // Phase 1 and phase 2 use their published local times. The phase 2 close
  // conflicts with the global maintenance boundary; those rows remain silent.
  {
    game: 'hsr',
    name: 'Robin • Summeretto · Hyacine rerun (phase 1)',
    type: 'banner',
    bannerKind: 'character',
    start: '2026-08-26 04:00',
    end: '2026-09-12 11:59',
    notes:
      'Warps "Summer Chorus" and "A Rainbow onto Twilight". The phase-1 notice (ann 1330) has published and gives t_lc 09-12 11:59, exactly the estimate this row already carried.',
    sourceKey: 'seed:hsr:4.5-p1-robin',
  },
  {
    game: 'hsr',
    name: 'Rise and Sing · Long May Rainbows Adorn the Sky — phase 1 Light Cone Warps',
    type: 'banner',
    bannerKind: 'weapon',
    start: '2026-08-26 04:00',
    end: '2026-09-12 11:59',
    notes:
      'Warps "Brilliant Fixation: Rise and Sing" and "Bygone Reminiscence: Long May Rainbows Adorn the Sky", both closing t_lc 09-12 11:59 per ann 1330.',
    sourceKey: 'seed:hsr:4.5-p1-lc',
  },
  {
    game: 'hsr',
    name: 'Aventurine • Waveflair · Ashveil rerun (phase 2)',
    type: 'banner',
    bannerKind: 'character',
    notify: false,
    start: '2026-09-12 12:00',
    end: '2026-09-28 03:59',
    notes:
      'Official announcement 1331 prints September 28 03:59 server time. This conflicts with the earlier global maintenance start for Europe/America; verify in-game and finish before maintenance. Alerts remain off while the conflict is unresolved.',
    sourceKey: 'seed:hsr:4.5-p2-aventurine',
  },
  {
    game: 'hsr',
    name: 'Summer Rides the Surf · The Finale of a Lie — phase 2 Light Cone Warps',
    type: 'banner',
    bannerKind: 'weapon',
    notify: false,
    start: '2026-09-12 12:00',
    end: '2026-09-28 03:59',
    notes:
      'Official announcement 1331 prints September 28 03:59 server time. This conflicts with the earlier global maintenance start for Europe/America; verify in-game and finish before maintenance. Alerts remain off while the conflict is unresolved.',
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
    bannerKind: 'character',
    start: '2026-07-29 04:00',
    end: '2026-09-08 14:59',
    notes: 'Runs both phases of 3.1.',
    sourceKey: 'seed:zzz:3.1-remielle',
  },
  {
    game: 'zzz',
    name: 'Ode of Resurrected Wings — W-Engine (flagship)',
    type: 'banner',
    bannerKind: 'weapon',
    start: '2026-07-29 04:00',
    end: '2026-09-08 14:59',
    sourceKey: 'seed:zzz:3.1-remielle-engine',
  },
  {
    game: 'zzz',
    name: 'Aria — Neon Angel rerun (phase 1)',
    type: 'banner',
    bannerKind: 'character',
    start: '2026-07-29 04:00',
    end: '2026-08-19 11:59',
    sourceKey: 'seed:zzz:3.1-aria',
  },
  {
    game: 'zzz',
    name: 'Angel in the Shell — W-Engine (phase 1)',
    type: 'banner',
    bannerKind: 'weapon',
    start: '2026-07-29 04:00',
    end: '2026-08-19 11:59',
    sourceKey: 'seed:zzz:3.1-aria-engine',
  },
  {
    game: 'zzz',
    name: 'Sigrid — Till the Ends of the Sky (phase 2)',
    type: 'banner',
    bannerKind: 'character',
    start: '2026-08-19 12:00',
    end: '2026-09-08 14:59',
    sourceKey: 'seed:zzz:3.1-sigrid',
  },
  {
    game: 'zzz',
    name: "Knight's Extolment — Sigrid W-Engine (phase 2)",
    type: 'banner',
    bannerKind: 'weapon',
    start: '2026-08-19 12:00',
    end: '2026-09-08 14:59',
    sourceKey: 'seed:zzz:3.1-sigrid-engine',
  },
  {
    game: 'zzz',
    name: 'Exclusive Rescreening: Dialyn · Yuzuha · Harumasa (phase 2)',
    type: 'banner',
    bannerKind: 'character',
    start: '2026-08-19 12:00',
    end: '2026-09-08 14:59',
    notes: 'Selectable rerun.',
    sourceKey: 'seed:zzz:3.1-rescreening',
  },
  {
    game: 'zzz',
    name: 'W-Engine Reverberation — selectable rerun (phase 2)',
    type: 'banner',
    bannerKind: 'weapon',
    start: '2026-08-19 12:00',
    end: '2026-09-08 14:59',
    sourceKey: 'seed:zzz:3.1-engine-reverb',
  },
  // --- maintenance
  {
    game: 'zzz',
    name: 'v3.2 update maintenance',
    type: 'maintenance',
    start: '2026-09-08 22:00',
    end: '2026-09-09 03:00',
    timezone: 'UTC',
    notes:
      'Publisher pre-download notice: maintenance starts Sep 9 at 06:00 UTC+8 and is estimated to last five hours. Reopen is planned, not a confirmed actual finish. https://www.hoyolab.com/accountcenter/postlist?id=219270333',
    sourceKey: 'seed:zzz:3.2-maint',
  },
  /* --- v3.2 "Their Secret Histories". Sep 7–8 publisher notices confirm phase 1
     and the dated events below. After-update openings use the scheduled global
     maintenance finish; phase 2 remains provisional until its own notice. */
  {
    game: 'zzz',
    name: 'Claret — Bloodmoon Rising (phase 1)',
    type: 'banner',
    bannerKind: 'character',
    start: '2026-09-09 03:00',
    startTimezone: 'UTC',
    end: '2026-09-30 11:59',
    notes:
      'Official Sep 7 phase-1 notice. Opens after the update (scheduled maintenance finish shown); closes Sep 30 at 11:59 server time. https://zenless.hoyoverse.com/m/en-us/news/165979',
    sourceKey: 'seed:zzz:3.2-claret',
  },
  {
    game: 'zzz',
    name: 'Nangong Yu — Axiom of Captivation rerun (phase 1)',
    type: 'banner',
    bannerKind: 'character',
    start: '2026-09-09 03:00',
    startTimezone: 'UTC',
    end: '2026-09-30 11:59',
    notes:
      'Official Sep 7 phase-1 notice. Opens after the update (scheduled maintenance finish shown); closes Sep 30 at 11:59 server time. https://zenless.hoyoverse.com/m/en-us/news/165979',
    sourceKey: 'seed:zzz:3.2-nangong-yu',
  },
  {
    game: 'zzz',
    name: 'Crimson Thirst / Neon Fantasies — W-Engines (phase 1)',
    type: 'banner',
    bannerKind: 'weapon',
    start: '2026-09-09 03:00',
    startTimezone: 'UTC',
    end: '2026-09-30 11:59',
    notes:
      'Official Sep 7 phase-1 notice. Opens after the update (scheduled maintenance finish shown); closes Sep 30 at 11:59 server time. https://zenless.hoyoverse.com/m/en-us/news/165979',
    sourceKey: 'seed:zzz:3.2-p1-engines',
  },
  {
    game: 'zzz',
    name: 'Roxy — Cindernight Respite (phase 2)',
    type: 'banner',
    bannerKind: 'character',
    notify: false,
    start: '2026-09-30 12:00',
    end: '2026-10-20 14:59',
    notes: 'From the 3.2 Special Program — no notice yet.',
    sourceKey: 'seed:zzz:3.2-roxy',
  },
  {
    game: 'zzz',
    name: 'Promeia — Cold Rain Wanes in the Night rerun (phase 2)',
    type: 'banner',
    bannerKind: 'character',
    notify: false,
    start: '2026-09-30 12:00',
    end: '2026-10-20 14:59',
    notes: 'First rerun. From the 3.2 Special Program — no notice yet.',
    sourceKey: 'seed:zzz:3.2-promeia',
  },
  {
    game: 'zzz',
    name: 'Crimson Moon Casket / Frostfall Sickle — W-Engines (phase 2)',
    type: 'banner',
    bannerKind: 'weapon',
    notify: false,
    start: '2026-09-30 12:00',
    end: '2026-10-20 14:59',
    notes: 'From the 3.2 Special Program — no notice yet.',
    sourceKey: 'seed:zzz:3.2-p2-engines',
  },
  /* --- endgame windows past the 3.1 boundary. Fourteen days each, unbroken since
     the 08-14 realignment to Fridays. Cadence only: ZZZ never announces these, and
     the 09-08 version update can cut one short exactly as 3.1's did. */
  {
    game: 'zzz',
    name: 'Shiyu Defense: Critical',
    type: 'cycle',
    notify: false,
    start: '2026-09-04 04:00',
    end: '2026-09-18 03:59',
    notes: 'Cadence, not a notice. Provisional; verify in-game.',
    sourceKey: 'seed:zzz:shiyu-2026-09-04',
  },
  {
    game: 'zzz',
    name: 'Deadly Assault',
    type: 'cycle',
    notify: false,
    start: '2026-09-11 04:00',
    end: '2026-09-25 03:59',
    notes: 'Cadence, not a notice. Opens two days after the 3.2 update. Provisional; verify in-game.',
    sourceKey: 'seed:zzz:da-2026-09-11',
  },
  {
    game: 'zzz',
    name: 'Shiyu Defense: Critical',
    type: 'cycle',
    notify: false,
    start: '2026-09-18 04:00',
    end: '2026-10-02 03:59',
    notes: 'Cadence, not a notice. Provisional; verify in-game.',
    sourceKey: 'seed:zzz:shiyu-2026-09-18',
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
    bannerKind: 'character',
    start: '2026-07-10 04:00',
    end: '2026-08-19 11:59',
    notes: 'Jiyan/Yinlin/Jinhsi/Changli/Zhezhi/Xiangli Yao; free first 10-pull.',
    sourceKey: 'seed:wuwa:3.5-starpath',
  },
  {
    game: 'wuwa',
    name: 'Tideforge Reverbs Convene — selectable weapon rerun',
    type: 'banner',
    bannerKind: 'weapon',
    notify: false,
    start: '2026-07-10 04:00',
    end: '2026-08-19 11:59',
    sourceKey: 'seed:wuwa:3.5-tideforge',
  },
  {
    game: 'wuwa',
    name: 'Suisui + Aemeath rerun (phase 2)',
    type: 'banner',
    bannerKind: 'character',
    start: '2026-07-30 10:00',
    end: '2026-08-19 11:59',
    sourceKey: 'seed:wuwa:3.5-p2',
  },
  {
    game: 'wuwa',
    name: "Absolute Pulsation: Firstlight's Herald + Everbright Polestar (phase 2)",
    type: 'banner',
    bannerKind: 'weapon',
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

     Phase 2 is confirmed by the publisher convene notice 5431. */
  {
    game: 'wuwa',
    name: 'Qingxiao + Denia rerun (phase 1)',
    type: 'banner',
    bannerKind: 'character',
    start: '2026-08-20 04:00',
    end: '2026-09-10 09:59',
    notes: 'Official convene notice — the estimated close it carried turned out correct.',
    sourceKey: 'seed:wuwa:3.6-p1',
  },
  {
    game: 'wuwa',
    name: 'Glint of Clouds + Forged Dwarf Star (phase 1 weapons)',
    type: 'banner',
    bannerKind: 'weapon',
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
    end: '2026-09-29 03:59',
    notes:
      'Kuro patch-note transcription confirms the server-local close. Source: https://wutheringwaves.gg/patch-notes-for-version-3-6-lamplight-in-mirage-swords-resolve-in-heart/',
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
    end: '2026-09-29 03:59',
    notes:
      'Kuro patch-note transcription confirms the server-local close. Source: https://wutheringwaves.gg/patch-notes-for-version-3-6-lamplight-in-mirage-swords-resolve-in-heart/',
    sourceKey: 'seed:wuwa:3.6-fogveil',
  },
  {
    game: 'wuwa',
    name: 'Jingran + Hiyuki/Mornye reruns (phase 2)',
    type: 'banner',
    bannerKind: 'character',
    start: '2026-09-10 10:00',
    end: '2026-09-29 11:59',
    notes:
      'Publisher phase-2 convene notice: September 10 10:00 through September 29 11:59 server time. Source: https://wutheringwaves.kurogames.com/en/main/news/detail/5431 ; full notice transcription: https://wutheringwaves.gg/version-3-6-featured-resonator-weapon-convene-phase-%E2%85%B1/',
    sourceKey: 'seed:wuwa:3.6-p2',
  },
  {
    game: 'wuwa',
    name: 'Thousandfold Deliverance / Frostburn / Starfield Calibrator — weapons',
    type: 'banner',
    bannerKind: 'weapon',
    start: '2026-09-10 10:00',
    end: '2026-09-29 11:59',
    notes:
      'Publisher phase-2 convenes share these server-local dates. Source: https://wutheringwaves.kurogames.com/en/main/news/detail/5431 ; full publisher post transcript: https://www6.twstalker.com/Wuthering_Waves',
    sourceKey: 'seed:wuwa:3.6-p2-weapons',
  },
  {
    game: 'wuwa',
    name: 'v3.7 update maintenance',
    type: 'maintenance',
    notify: false,
    start: '2026-09-29 21:00',
    end: '2026-09-30 04:00',
    notes: 'No notice yet. Inferred from the official 3.6 close (09-29 11:59) and the usual Kuro overnight window.',
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
    name: 'Shinku — Before the Dawn',
    type: 'banner',
    bannerKind: 'character',
    start: '2026-07-08 04:00',
    end: '2026-07-29 03:59',
    sourceKey: 'seed:nte:1.2-shinku',
  },
  {
    game: 'nte',
    name: 'Blushing Mirage — Arc banner',
    type: 'banner',
    bannerKind: 'weapon',
    start: '2026-07-08 04:00',
    end: '2026-07-29 03:59',
    sourceKey: 'seed:nte:1.2-blushing-mirage',
  },
  {
    game: 'nte',
    name: 'Iroi — The Lifeline (phase 2)',
    type: 'banner',
    bannerKind: 'character',
    start: '2026-07-29 04:00',
    end: '2026-08-18 22:59',
    sourceKey: 'seed:nte:1.2-iroha',
  },
  {
    game: 'nte',
    name: 'Dreamgate Special — The Wrong Gate (phase 2 arc)',
    type: 'banner',
    bannerKind: 'weapon',
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
    bannerKind: 'character',
    start: '2026-08-19 04:00',
    end: '2026-09-08 22:59',
    notes: 'Official v1.3 notice — was an estimate, dates confirmed unchanged.',
    sourceKey: 'seed:nte:1.3-zankou',
  },
  {
    game: 'nte',
    name: 'The Ichi-Daime — Nanally rerun (phase 1)',
    type: 'banner',
    bannerKind: 'character',
    start: '2026-08-19 04:00',
    end: '2026-09-08 22:59',
    notes: 'Official v1.3 notice — was an estimate, dates confirmed unchanged.',
    sourceKey: 'seed:nte:1.3-nanally',
  },
  {
    game: 'nte',
    name: 'Spellbound Special — Ravenous Blade',
    type: 'banner',
    bannerKind: 'weapon',
    start: '2026-08-19 04:00',
    end: '2026-09-08 22:59',
    notes: 'Official v1.3 notice. Weapon-side banner of the phase-1 slate.',
    sourceKey: 'seed:nte:1.3-ravenous-blade',
  },
  {
    game: 'nte',
    name: 'Tiger Special — Ready-Ready',
    type: 'banner',
    bannerKind: 'weapon',
    start: '2026-08-19 04:00',
    end: '2026-09-08 22:59',
    notes: 'Official v1.3 notice.',
    sourceKey: 'seed:nte:1.3-ready-ready',
  },
  {
    game: 'nte',
    name: 'Surfing All Channels — Linko (phase 2)',
    type: 'banner',
    bannerKind: 'character',
    start: '2026-09-09 11:00',
    end: '2026-09-30 05:59',
    notes:
      'Official global window. Opening uses the scheduled maintenance finish. Source: https://nte.perfectworld.com/en/article/news/gamenews/20260908/263947.html',
    timezone: 'UTC+8',
    sourceKey: 'seed:nte:1.3-linko',
  },
  {
    game: 'nte',
    name: 'Misty Tipsy Style — Hotori rerun (phase 2)',
    type: 'banner',
    bannerKind: 'character',
    start: '2026-09-09 11:00',
    end: '2026-09-30 05:59',
    timezone: 'UTC+8',
    notes:
      'Official global window. Opening uses the scheduled maintenance finish. Source: https://nte.perfectworld.com/en/article/news/gamenews/20260908/263947.html',
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
    start: '2026-09-09 11:00',
    end: '2026-09-30 05:59',
    timezone: 'UTC+8',
    notes:
      'Official global window. Opening uses the scheduled maintenance finish. Source: https://nte.perfectworld.com/en/article/news/gamenews/20260908/263947.html',
    sourceKey: 'seed:nte:1.3-runaway-echoes',
  },
  {
    game: 'nte',
    name: 'Breezy Tour',
    type: 'event',
    start: '2026-09-17 10:00',
    end: '2026-09-30 05:59',
    timezone: 'UTC+8',
    notes:
      'Limited rewards end at this global deadline. Cycling Invitations remain permanent. Source: https://nte.perfectworld.com/en/article/news/gamenews/20260908/263947.html',
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
    start: '2026-09-14 05:00',
    end: '2026-09-21 04:59',
    notes:
      'Official server-local window. Source: https://nte.perfectworld.com/en/article/news/gamenews/20260908/263947.html',
    sourceKey: 'seed:nte:1.3-pixelsurge',
  },
  {
    game: 'nte',
    name: 'Fons Rush',
    type: 'event',
    dailyTouch: true,
    start: '2026-09-21 05:00',
    end: '2026-09-28 04:59',
    notes:
      'Official server-local window. Source: https://nte.perfectworld.com/en/article/news/gamenews/20260908/263947.html',
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
    bannerKind: 'memory',
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
    bannerKind: 'memory',
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
  {
    game: 'lads',
    name: 'Senior Hunter Contest',
    type: 'cycle',
    notify: false,
    start: '2026-09-07 05:00',
    end: '2026-09-21 04:59',
    notes: '2026 Season 18. Same caveat again — 14-day cadence, times assumed, nothing published.',
    sourceKey: 'seed:lads:hunter-contest-2026-s18',
  },
  {
    game: 'lads',
    name: "Zayne's Birthday Event",
    type: 'event',
    notify: false,
    start: '2026-08-31 05:00',
    end: '2026-09-07 04:59',
    notes:
      'Announced on the official account: 05:00 08-31 to 04:59 09-07 server time, with a birthday-limited 5-star Memory and a login gift of 10 limited wishes. Reported title "When Embers Rise" — the dates are firmer than the name.',
    sourceKey: 'seed:lads:zayne-birthday-2026',
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
    name: 'Spotlight Scout — Seeking the Pearl',
    type: 'banner',
    bannerKind: 'character',
    start: '2026-08-12 22:00',
    end: '2026-08-21 21:59',
    sourceKey: 'seed:uma:scout-2026-08-12',
  },
  {
    game: 'uma',
    name: 'Spotlight Support Card Scout — Daiichi Ruby, K.S. Miracle',
    type: 'banner',
    bannerKind: 'support',
    start: '2026-08-12 22:00',
    end: '2026-08-21 21:59',
    sourceKey: 'seed:uma:scout-2026-08-12:supports',
  },
  {
    game: 'uma',
    name: 'Spotlight Scout — Halloween Agnes Digital / Meisho Doto',
    type: 'banner',
    bannerKind: 'character',
    start: '2026-08-18 22:00',
    end: '2026-08-30 21:59',
    notes:
      'Runs with the Days Flying By story event. The window is from the official roadmap; the Halloween trainee pairing is community-sourced.',
    sourceKey: 'seed:uma:scout-2026-08-18',
  },
  {
    game: 'uma',
    name: 'Spotlight Support Card Scout — Shinko Windy, Daitaku Helios, Mejiro Palmer',
    type: 'banner',
    bannerKind: 'support',
    start: '2026-08-18 22:00',
    end: '2026-08-30 21:59',
    notes:
      'Runs with the Days Flying By story event. The window is from the official roadmap; the Halloween trainee pairing is community-sourced.',
    sourceKey: 'seed:uma:scout-2026-08-18:supports',
  },
  {
    game: 'uma',
    name: 'Spotlight Scout — Aston Machan',
    type: 'banner',
    bannerKind: 'character',
    start: '2026-08-25 22:00',
    end: '2026-09-01 21:59',
    sourceKey: 'seed:uma:scout-2026-08-25',
  },
  {
    game: 'uma',
    name: 'Spotlight Support Card Scout — Fine Motion, Maruzensky',
    type: 'banner',
    bannerKind: 'support',
    start: '2026-08-25 22:00',
    end: '2026-09-01 21:59',
    sourceKey: 'seed:uma:scout-2026-08-25:supports',
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
  /* --- September. Uma publishes DATES and not times, so every row below uses the
     block's established 22:00 open / 21:59 close (and 14:59 for Legend Races), the
     same convention the August rows were verified against. The dates are the
     game's own schedule; the clock is inference, which is why these stay silent. */
  {
    game: 'uma',
    name: 'Spotlight Scout — Yamanin Zephyr',
    type: 'banner',
    bannerKind: 'character',
    notify: false,
    start: '2026-09-01 22:00',
    end: '2026-09-10 21:59',
    sourceKey: 'seed:uma:scout-2026-09-01',
  },
  {
    game: 'uma',
    name: 'Spotlight Support Card Scout — Symboli Kris S, Tsurumaru Tsuyoshi',
    type: 'banner',
    bannerKind: 'support',
    notify: false,
    start: '2026-09-01 22:00',
    end: '2026-09-10 21:59',
    sourceKey: 'seed:uma:scout-2026-09-01:supports',
  },
  {
    game: 'uma',
    name: "Let's Go! Uma Outing!",
    type: 'event',
    notify: false,
    dailyTouch: true,
    start: '2026-09-01 22:00',
    end: '2026-09-10 14:59',
    timezone: 'UTC',
    notes:
      'Close corrected from the Cygames notice transcription: https://umamusume.gg/lets-go-uma-outing-now-available/',
    sourceKey: 'seed:uma:outing-2026-09',
  },
  {
    game: 'uma',
    name: 'Legend Races — Shuka Sho',
    type: 'event',
    notify: false,
    dailyTouch: true,
    start: '2026-09-03 22:00',
    end: '2026-09-09 14:59',
    notes: 'Kawakami Princess and Fine Motion. The 14:59 close copies the Sprinters Stakes run, which was verified.',
    sourceKey: 'seed:uma:legend-races-2026-09',
  },
  {
    game: 'uma',
    name: 'Hark Back, Run Forward (Autumn Festival story event)',
    type: 'event',
    start: '2026-09-07 22:00',
    end: '2026-09-19 21:59',
    notes:
      'Cygames notice transcription confirms both boundaries: https://umamusume.gg/check-out-all-the-latest-updates-3/',
    timezone: 'UTC',
    sourceKey: 'seed:uma:story-event-19',
  },
  {
    game: 'uma',
    name: 'Spotlight Scout — Tamamo Cross / Inari One',
    type: 'banner',
    bannerKind: 'character',
    notify: false,
    start: '2026-09-07 22:00',
    end: '2026-09-19 21:59',
    sourceKey: 'seed:uma:scout-2026-09-07',
  },
  {
    game: 'uma',
    name: 'Spotlight Support Card Scout — Yaeno Muteki, Oguri Cap',
    type: 'banner',
    bannerKind: 'support',
    notify: false,
    start: '2026-09-07 22:00',
    end: '2026-09-19 21:59',
    sourceKey: 'seed:uma:scout-2026-09-07:supports',
  },
  {
    game: 'uma',
    name: 'Spotlight Scout — Nakayama Festa',
    type: 'banner',
    bannerKind: 'character',
    notify: false,
    start: '2026-09-15 22:00',
    end: '2026-09-23 21:59',
    sourceKey: 'seed:uma:scout-2026-09-15',
  },
  {
    game: 'uma',
    name: 'Spotlight Support Card Scout — Super Creek, Mr. C.B. reruns',
    type: 'banner',
    bannerKind: 'support',
    notify: false,
    start: '2026-09-15 22:00',
    end: '2026-09-23 21:59',
    sourceKey: 'seed:uma:scout-2026-09-15:supports',
  },
  {
    game: 'uma',
    name: 'Champions Meeting',
    type: 'cycle',
    start: '2026-09-15 22:00',
    end: '2026-09-25 21:59',
    notes:
      'Scorpio Cup. League selection starts Sep 15; races run Sep 19–25. Registration closes Sep 23 at 21:59 UTC. Cygames notice transcription: https://umamusume.gg/the-league-selection-period-for-the-champions-meeting-scorpio-cup-has-begun/',
    timezone: 'UTC',
    sourceKey: 'seed:uma:cm-scorpio-2026-09',
  },
  {
    game: 'uma',
    name: 'Spotlight Scout — Wonder Acute',
    type: 'banner',
    bannerKind: 'character',
    notify: false,
    start: '2026-09-23 22:00',
    end: '2026-10-04 21:59',
    sourceKey: 'seed:uma:scout-2026-09-23',
  },
  {
    game: 'uma',
    name: 'Spotlight Support Card Scout — Eishin Flash, Narita Top Road',
    type: 'banner',
    bannerKind: 'support',
    notify: false,
    start: '2026-09-23 22:00',
    end: '2026-10-04 21:59',
    sourceKey: 'seed:uma:scout-2026-09-23:supports',
  },
  {
    game: 'uma',
    name: 'Spotlight Scout — Christmas Vodka / Daiwa Scarlet',
    type: 'banner',
    bannerKind: 'character',
    notify: false,
    start: '2026-09-28 22:00',
    end: '2026-10-12 21:59',
    sourceKey: 'seed:uma:scout-2026-09-28',
  },
  {
    game: 'uma',
    name: 'Spotlight Support Card Scout — Air Groove, Narita Brian',
    type: 'banner',
    bannerKind: 'support',
    notify: false,
    start: '2026-09-28 22:00',
    end: '2026-10-12 21:59',
    sourceKey: 'seed:uma:scout-2026-09-28:supports',
  },
  {
    game: 'uma',
    name: 'Illuminate the Heart (story event)',
    type: 'event',
    notify: false,
    start: '2026-09-28 22:00',
    end: '2026-10-12 21:59',
    notes: 'Holiday Celebration Part 1 opens alongside it; that campaign has no published close.',
    sourceKey: 'seed:uma:story-event-20',
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
    bannerKind: 'character',
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
    bannerKind: 'character',
    start: '2026-08-13 07:00',
    end: '2026-09-10 04:59',
    notes: 'SSR Fire. Collab limited.',
    sourceKey: 'seed:nikke:queen-pickup',
  },
  {
    game: 'nikke',
    name: 'Yukiko Amagi Pick Up',
    type: 'banner',
    bannerKind: 'character',
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
  // September 3 notice: all times are UTC+9. Opening after maintenance
  // uses its scheduled finish; the actual finish can change.
  {
    game: 'nikke',
    name: 'GREAT VILLAIN UNION',
    type: 'event',
    start: '2026-09-03 18:00',
    end: '2026-09-17 04:59',
    notes:
      'Opening uses the scheduled maintenance finish, not a confirmed actual finish. Publisher notice transcription: https://nikke.gg/september-3-patch-notes/',
    timezone: 'UTC+9',
    sourceKey: 'seed:nikke:great-villain-union',
  },
  {
    game: 'nikke',
    name: 'Drake: Great Villain Pick Up',
    type: 'banner',
    bannerKind: 'character',
    start: '2026-09-03 18:00',
    end: '2026-09-17 04:59',
    notes:
      'Opening uses the scheduled maintenance finish, not a confirmed actual finish. Publisher notice transcription: https://nikke.gg/september-3-patch-notes/',
    timezone: 'UTC+9',
    sourceKey: 'seed:nikke:drake-great-villain-pickup',
  },
  {
    game: 'nikke',
    name: 'DAILY EVIL DEED — 7-day login',
    type: 'event',
    dailyTouch: true,
    start: '2026-09-03 18:00',
    end: '2026-09-17 04:59',
    notes:
      'Opening uses the scheduled maintenance finish, not a confirmed actual finish. Publisher notice transcription: https://nikke.gg/september-3-patch-notes/',
    timezone: 'UTC+9',
    sourceKey: 'seed:nikke:daily-evil-deed',
  },
  {
    game: 'nikke',
    name: 'Union Raid',
    type: 'cycle',
    start: '2026-09-04 05:00',
    end: '2026-09-10 04:59',
    notes: 'Printed in the 09-03 patch notes to the second.',
    sourceKey: 'seed:nikke:union-raid-2026-09',
  },
  {
    game: 'nikke',
    name: 'October Mission Pass',
    type: 'event',
    dailyTouch: true,
    start: '2026-10-01 00:00',
    end: '2026-10-31 23:59',
    notes:
      'Crust: Treat Chef. Dates confirmed by publisher notice transcription: https://nikke.gg/september-17-patch-notes/',
    timezone: 'UTC+9',
    sourceKey: 'seed:nikke:mission-pass-oct',
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
    bannerKind: 'character',
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
    // Announced for "September 2" — the Asia column. This block runs on the ONE
    // combined AmEu server at UTC-5, where that is the evening of Sept 1, landing
    // exactly on the 1.4 boundary. Confirmed after the fact on 09-02: the wiki
    // records the AmEu version opening at 2026/09/01 23:00, which is the end below.
    start: '2026-09-01 17:00',
    end: '2026-09-01 23:00',
    notes:
      'It ran. The 23:00 reopen is the recorded AmEu version start; the 17:00 close is the 1.4 boundary every 1.4 row ends on.',
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
  /* v1.5 update notice 5208: event dates below use server time unless a
     timezone override is set. The next maintenance has no confirmed date.
     Rows with an estimated end remain silent. See the September 17 audit. */
  {
    game: 'endfield',
    name: 'Winter Hunt — Typhoeus',
    type: 'banner',
    bannerKind: 'character',
    start: '2026-09-02 04:00',
    end: '2026-09-30 11:59',
    notes:
      'Update notes explicitly label the close server time. Opening uses the global scheduled maintenance finish. Source: https://endfield.gryphline.com/en-us/news/5208',
    startTimezone: 'UTC',
    sourceKey: 'seed:endfield:1.5-typhoeus',
  },
  {
    game: 'endfield',
    name: 'Combat Drills: Typhoeus',
    type: 'event',
    start: '2026-09-02 04:00',
    startTimezone: 'UTC',
    end: '2026-09-30 11:59',
    notes:
      'Official Winter Hunt notice: trial runs during the banner. Close is server time; opening is scheduled global maintenance finish. Source: https://endfield.gryphline.com/en-us/news/6172',
    sourceKey: 'seed:endfield:1.5-drills-typhoeus',
  },
  {
    game: 'endfield',
    name: 'Fletched Irontip — sign-in',
    type: 'event',
    dailyTouch: true,
    start: '2026-09-02 04:00',
    startTimezone: 'UTC',
    end: '2026-09-30 11:59',
    notes:
      'Official Winter Hunt notice: sign-in runs during the banner. Close is server time; opening is scheduled global maintenance finish. Source: https://endfield.gryphline.com/en-us/news/6172',
    sourceKey: 'seed:endfield:1.5-fletched-irontip',
  },
  {
    game: 'endfield',
    name: 'Snow Over Deep Woods',
    type: 'event',
    start: '2026-09-02 04:00',
    end: '2026-09-30 12:00',
    notes: 'Official server-local window. Source: https://endfield.gryphline.com/en-us/news/5208',
    startTimezone: 'UTC',
    sourceKey: 'seed:endfield:1.5-snow-over-deep-woods',
  },
  {
    game: 'endfield',
    name: 'Trial of the Bow',
    type: 'event',
    notify: false,
    start: '2026-09-09 12:00',
    end: '2026-10-14 17:00',
    notes:
      'Official server-local opening. Ends at next version maintenance, whose date is not confirmed here. Displayed close is a placeholder aligned to the last Sanity Supply close on Americas/Europe. Source: https://endfield.gryphline.com/en-us/news/5208',
    sourceKey: 'seed:endfield:1.5-trial-of-the-bow',
  },
  {
    game: 'endfield',
    name: 'AIC Support: Chubby Lung Attacks',
    type: 'event',
    start: '2026-09-16 12:00',
    end: '2026-09-30 16:00',
    notes:
      'Production deadline. Goods exchange remains open until October 7 at 04:00 server time. Source: https://endfield.gryphline.com/en-us/news/5208',
    sourceKey: 'seed:endfield:1.5-aic-chubby-lung',
  },
  {
    game: 'endfield',
    name: 'Sanity Supply (first window)',
    type: 'event',
    start: '2026-09-17 04:00',
    end: '2026-09-24 04:00',
    notes: 'Official server-local window. Source: https://endfield.gryphline.com/en-us/news/5208',
    dailyTouch: true,
    sourceKey: 'seed:endfield:1.5-sanity-1',
  },
  {
    game: 'endfield',
    name: 'Resplendent Spectrum — Yvonne rerun (phase 2)',
    type: 'banner',
    bannerKind: 'character',
    notify: false,
    start: '2026-09-24 12:00',
    end: '2026-10-14 17:00',
    notes:
      'Official server-local opening. Ends at next version maintenance, whose date is not confirmed here. Displayed close is a placeholder aligned to the last Sanity Supply close on Americas/Europe. Source: https://endfield.gryphline.com/en-us/news/5208',
    sourceKey: 'seed:endfield:1.5-yvonne',
  },
  {
    game: 'endfield',
    name: 'Tag Artist Issue — Artzy Tyrannical rerun (phase 2)',
    type: 'banner',
    bannerKind: 'weapon',
    notify: false,
    start: '2026-09-24 12:00',
    end: '2026-10-14 17:00',
    notes:
      'Official server-local opening. Ends at next version maintenance, whose date is not confirmed here. Displayed close is a placeholder aligned to the last Sanity Supply close on Americas/Europe. Source: https://endfield.gryphline.com/en-us/news/5208',
    sourceKey: 'seed:endfield:1.5-tag-artist',
  },
  {
    game: 'endfield',
    name: 'Purry Big Feline! RAWR! — free Purrchena',
    type: 'event',
    notify: false,
    start: '2026-09-24 12:00',
    end: '2026-10-14 17:00',
    notes:
      'Official server-local opening. Ends at next version maintenance, whose date is not confirmed here. Displayed close is a placeholder aligned to the last Sanity Supply close on Americas/Europe. Source: https://endfield.gryphline.com/en-us/news/5208',
    sourceKey: 'seed:endfield:1.5-purrchena',
  },
  {
    game: 'endfield',
    name: 'Echoing Bell of an Old City',
    type: 'event',
    notify: false,
    start: '2026-09-24 12:00',
    end: '2026-10-14 17:00',
    notes:
      'Official server-local opening. Ends at next version maintenance, whose date is not confirmed here. Displayed close is a placeholder aligned to the last Sanity Supply close on Americas/Europe. Source: https://endfield.gryphline.com/en-us/news/5208',
    sourceKey: 'seed:endfield:1.5-echoing-bell',
  },
  {
    game: 'endfield',
    name: 'Echoes of War',
    type: 'cycle',
    start: '2026-09-02 04:00',
    end: '2026-09-24 11:59',
    notes:
      'Season of Virtuality. Three internal cycles, but their individual boundaries are not published. This row tracks the full season. Source: https://endfield.gryphline.com/en-us/news/5208',
    startTimezone: 'UTC',
    sourceKey: 'seed:endfield:eow-1.5-1',
  },
  {
    game: 'endfield',
    name: 'Echoes of War',
    type: 'cycle',
    notify: false,
    start: '2026-09-24 12:00',
    end: '2026-10-14 17:00',
    notes:
      'Season of Illusion. Three internal cycles. Ends at next maintenance; displayed close is an unconfirmed placeholder aligned to the final Americas/Europe Sanity Supply close. Source: https://endfield.gryphline.com/en-us/news/5208',
    sourceKey: 'seed:endfield:eow-1.5-4',
  },

  /* ================================================== NEXT PATCH LIVESTREAMS
     The broadcast that reveals the next version, and therefore the cue to refresh
     this whole file. An announced stream is stored as the broadcast itself; an
     unannounced one is stored as the plausible RANGE its history implies, with
     the offsets it came from in `notes` so the next refresh can re-derive it
     instead of trusting this row. All times are the Europe (UTC+1) wall clock.

     Offsets observed on 2026-08-27 and unchanged on 09-02: Genshin 12-13 days
     before release, Fridays 13:00. HSR 6-12 (one outlier at 6), Fridays 12:30.
     WuWa 6-14, Fridays 12:00 — the 3.6 broadcast on 08-07 sat 13 days out and
     fits. NTE exactly 11 every time, Saturdays 12:30. ZZZ 12, Fridays 12:30.

     A broadcast is also the one free-reward deadline this file can carry: each
     one gives away three redemption codes worth roughly 300 of the game's pull
     currency, and they expire within a day or two, so the codes are named in
     `notes` for the four games whose practice is documented. NTE's row says
     nothing about codes because Perfect World's has not been confirmed — an
     unverified promise of free pulls is worse than none.

     LADS, Uma and NIKKE are absent on purpose: none of the three runs a
     recurring patch broadcast, only news posts. Endfield stays absent too, but
     for a different reason and not for much longer: its 1.5 preview aired
     2026-08-21, twelve days before release, which is now TWO datapoints. One
     more and it earns a predicted row like the rest. */
  {
    game: 'zzz',
    name: 'ZZZ 3.3 Special Program — predicted window',
    type: 'livestream',
    start: '2026-10-07 12:30',
    end: '2026-10-11 14:30',
    notes:
      'Not announced. This remains only a forecast window, not a confirmed broadcast. The official 3.2 broadcast was August 28 at 19:30 UTC+8 and offered one exclusive code; neither the next date nor code details are confirmed. Source: https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=4162040&count=30&maxlength=0',
    sourceKey: 'seed:zzz:3.3-livestream',
  },
  {
    game: 'genshin',
    name: 'Genshin 7.1 Special Program',
    type: 'livestream',
    start: '2026-09-12 12:00',
    end: '2026-09-12 13:00',
    timezone: 'UTC',
    notes:
      'Official premiere: September 12 at 08:00 UTC-4 (12:00 UTC / 13:00 UK). The one-hour display window is an estimate; the end time was not announced. Source: https://www.reddit.com/r/Genshin_Impact/comments/1w9hdpk/genshin_impact_version_71_special_program_preview/',
    sourceKey: 'seed:genshin:7.1-livestream',
  },
  {
    game: 'hsr',
    name: 'HSR 4.6 Special Program',
    type: 'livestream',
    start: '2026-09-20 11:30',
    end: '2026-09-20 12:30',
    notes:
      'Official English program: September 20 at 19:30 UTC+8 (11:30 UTC / 12:30 BST). The one-hour display duration is estimated. Source: https://www.youtube.com/watch?v=drFgtruoPe8',
    timezone: 'UTC',
    sourceKey: 'seed:hsr:4.6-livestream',
  },
  {
    game: 'wuwa',
    name: 'WuWa 3.7 Special Broadcast',
    type: 'livestream',
    start: '2026-09-19 11:00',
    end: '2026-09-19 12:00',
    timezone: 'UTC',
    notes:
      'Official English broadcast: September 19 at 19:00 UTC+8 (11:00 UTC / noon BST). One-hour display duration is estimated; no end was announced. Source: https://www.youtube.com/watch?v=nMa_e5ChL6w',
    sourceKey: 'seed:wuwa:3.7-livestream',
  },
  {
    game: 'nte',
    name: 'NTE 1.4 Preview Special Program',
    type: 'livestream',
    start: '2026-09-16 11:30',
    end: '2026-09-16 12:30',
    timezone: 'UTC',
    notes:
      'Aired September 16 at 19:30 UTC+8 (11:30 UTC). The one-hour display duration is estimated. Version 1.4 launches September 30. Replay: https://www.youtube.com/watch?v=zrDTlGF6Pg8 . Recap and official artwork are in Livestreams.',
    sourceKey: 'seed:nte:1.4-livestream',
  },
  // Dated Sep 7–8 notices; research and fetch gaps are recorded in docs/event-feed-2026-09-08.md.
  {
    game: 'zzz',
    name: 'All-New Program — 7-day login',
    type: 'event',
    start: '2026-09-09 03:00',
    end: '2026-10-20 03:59',
    startTimezone: 'UTC',
    dailyTouch: true,
    notes:
      'Opens after the update; scheduled global maintenance finish shown. Close is server-local. Publisher notice: https://zenless.hoyoverse.com/m/en-us/news/165997',
    sourceKey: 'seed:zzz:3.2-all-new-program',
  },
  {
    game: 'zzz',
    name: 'Clink, Clank, Pinball Knight!',
    type: 'event',
    start: '2026-09-10 10:00',
    end: '2026-10-19 03:59',
    notes: 'Publisher notice: https://www.hoyolab.com/accountcenter/postlist?id=219270333',
    sourceKey: 'seed:zzz:3.2-pinball-knight',
  },
  {
    game: 'zzz',
    name: 'Angels Support Operation',
    type: 'event',
    start: '2026-09-09 03:00',
    end: '2026-11-30 03:59',
    startTimezone: 'UTC',
    notes:
      'Opens after the update; scheduled global maintenance finish shown. Close is server-local. Publisher notice: https://www.hoyolab.com/accountcenter/postlist?id=219270333',
    sourceKey: 'seed:zzz:3.2-angels-support',
  },
  {
    game: 'zzz',
    name: 'New Eridu City Fund',
    type: 'event',
    start: '2026-09-09 03:00',
    end: '2026-10-19 03:59',
    startTimezone: 'UTC',
    dailyTouch: true,
    notes:
      'Opens after the update; scheduled global maintenance finish shown. Close is server-local. Publisher notice: https://www.hoyolab.com/accountcenter/postlist?id=219270333',
    sourceKey: 'seed:zzz:3.2-city-fund',
  },
  {
    game: 'zzz',
    name: 'Final Callback — phase 1 auditions',
    type: 'event',
    start: '2026-09-09 03:00',
    end: '2026-09-30 11:59',
    startTimezone: 'UTC',
    notes:
      'Opens after the update; scheduled global maintenance finish shown. Close is server-local. Publisher phase-1 notice: https://zenless.hoyoverse.com/m/en-us/news/165979',
    sourceKey: 'seed:zzz:3.2-final-callback',
  },
  {
    game: 'lads',
    name: 'Shared Bloom',
    type: 'event',
    start: '2026-09-08 05:00',
    end: '2026-09-17 04:59',
    dailyTouch: true,
    notes:
      'Dated publisher repost; original social post could not be fetched: https://www.reddit.com/r/CalebMains/comments/1w9hpg9/love_and_deepspace_shared_bloom/',
    sourceKey: 'seed:lads:shared-bloom-2026-09',
  },
  {
    game: 'lads',
    name: 'Where Silverwings Rest — Sylus rerun',
    type: 'banner',
    bannerKind: 'memory',
    start: '2026-09-08 05:00',
    end: '2026-09-15 04:59',
    notes:
      'Publisher update repost; original social post could not be fetched: https://www.reddit.com/r/LADS_OG/comments/1w9zfkr/love_and_deepspace_update_on_sept_7/',
    sourceKey: 'seed:lads:where-silverwings-rest-2026-09',
  },
  {
    game: 'uma',
    name: 'Bonus Daily Race Entry Tickets',
    type: 'event',
    start: '2026-09-03 15:00',
    end: '2026-09-17 14:59',
    timezone: 'UTC',
    dailyTouch: true,
    notes: 'Cygames notice transcription: https://umamusume.gg/increased-daily-race-tickets-event-coming-soon/',
    sourceKey: 'seed:uma:daily-race-tickets-2026-09',
  },
  {
    game: 'uma',
    name: 'Bonus Star Pieces — Kikuka Sho',
    type: 'event',
    start: '2026-09-06 15:00',
    end: '2026-09-08 14:59',
    timezone: 'UTC',
    notes: 'Cygames notice transcription: https://umamusume.gg/bonus-star-piece-rewards-in-career-4/',
    sourceKey: 'seed:uma:kikuka-star-pieces-2026-09',
  },
  {
    game: 'nikke',
    name: 'Coordinated Operation: Storm Bringer',
    type: 'event',
    start: '2026-09-11 12:00',
    end: '2026-09-13 23:59',
    timezone: 'UTC+9',
    dailyTouch: true,
    notes:
      'Publisher patch-note transcription, section 5 (notice body takes precedence over editorial summary): https://nikke.gg/september-3-patch-notes/',
    sourceKey: 'seed:nikke:coop-storm-bringer-2026-09',
  },
  // September 17 audit. Source coverage: docs/event-feed-2026-09-17.md.
  {
    game: 'nte',
    name: 'Soundscape Special — Voice of the Voyager',
    type: 'banner',
    bannerKind: 'weapon',
    start: '2026-09-09 11:00',
    end: '2026-09-30 05:59',
    timezone: 'UTC+8',
    notes:
      'Official global window. Opening uses the scheduled maintenance finish. Source: https://nte.perfectworld.com/en/article/news/gamenews/20260908/263947.html',
    sourceKey: 'seed:nte:1.3-voyager',
  },
  {
    game: 'nte',
    name: 'Bright Moon Special — Marching Beyond Time',
    type: 'banner',
    bannerKind: 'weapon',
    start: '2026-09-09 11:00',
    end: '2026-09-30 05:59',
    timezone: 'UTC+8',
    notes:
      'Official global window. Opening uses the scheduled maintenance finish. Source: https://nte.perfectworld.com/en/article/news/gamenews/20260908/263947.html',
    sourceKey: 'seed:nte:1.3-marching',
  },
  {
    game: 'lads',
    name: 'Voyage Anew — free Caleb memory',
    type: 'event',
    start: '2026-09-17 05:00',
    end: '2026-09-27 04:59',
    dailyTouch: false,
    notes:
      'Server-local schedule from a publisher notice repost; original social notice not fetched. Source: https://www.reddit.com/r/RafayelMains/comments/1whykrf/love_and_deepspace_update_on_sept_16/',
    sourceKey: 'seed:lads:voyage-anew-2026-09',
  },
  {
    game: 'lads',
    name: 'Fragrant Sachets',
    type: 'event',
    start: '2026-09-17 05:00',
    end: '2026-10-01 04:59',
    dailyTouch: false,
    notes:
      'Server-local schedule from a publisher notice repost; original social notice not fetched. Source: https://www.reddit.com/r/RafayelMains/comments/1whykrf/love_and_deepspace_update_on_sept_16/',
    sourceKey: 'seed:lads:fragrant-sachets-2026-09',
  },
  {
    game: 'lads',
    name: 'Blooming Osmanthus — daily check-in',
    type: 'event',
    start: '2026-09-17 05:00',
    end: '2026-10-01 04:59',
    dailyTouch: true,
    notes:
      'Server-local schedule from a publisher notice repost; original social notice not fetched. Source: https://www.reddit.com/r/RafayelMains/comments/1whykrf/love_and_deepspace_update_on_sept_16/',
    sourceKey: 'seed:lads:blooming-osmanthus-2026-09',
  },
  {
    game: 'uma',
    name: 'JBC Series — limited missions',
    type: 'event',
    start: '2026-09-10 15:00',
    end: '2026-09-17 14:59',
    timezone: 'UTC',
    notes: 'Cygames notice transcription: https://umamusume.gg/fall-g1-celebration-part-2-now-available-2/',
    sourceKey: 'seed:uma:fall-g1-jbc-2026',
  },
  {
    game: 'uma',
    name: 'Queen Elizabeth II Cup — limited missions',
    type: 'event',
    start: '2026-09-23 15:00',
    end: '2026-09-30 14:59',
    timezone: 'UTC',
    notes: 'Cygames notice transcription: https://umamusume.gg/fall-g1-celebration-part-2-now-available-2/',
    sourceKey: 'seed:uma:fall-g1-queen-2026',
  },
  {
    game: 'uma',
    name: 'Mile Championship — limited missions',
    type: 'event',
    start: '2026-09-29 22:00',
    end: '2026-10-06 14:59',
    timezone: 'UTC',
    notes: 'Cygames notice transcription: https://umamusume.gg/fall-g1-celebration-part-2-now-available-2/',
    sourceKey: 'seed:uma:fall-g1-mile-2026',
  },
  {
    game: 'uma',
    name: 'Japan Cup — limited missions',
    type: 'event',
    start: '2026-10-01 15:00',
    end: '2026-10-08 14:59',
    timezone: 'UTC',
    notes: 'Cygames notice transcription: https://umamusume.gg/fall-g1-celebration-part-2-now-available-2/',
    sourceKey: 'seed:uma:fall-g1-japan-2026',
  },
  {
    game: 'uma',
    name: 'Champions Cup — limited missions',
    type: 'event',
    start: '2026-10-08 15:00',
    end: '2026-10-15 14:59',
    timezone: 'UTC',
    notes: 'Cygames notice transcription: https://umamusume.gg/fall-g1-celebration-part-2-now-available-2/',
    sourceKey: 'seed:uma:fall-g1-champions-2026',
  },
  {
    game: 'uma',
    name: 'Bonus Star Pieces — JBC races',
    type: 'event',
    start: '2026-09-15 15:00',
    end: '2026-09-17 14:59',
    timezone: 'UTC',
    dailyTouch: true,
    notes:
      'Daily race bonus. Cygames notice transcription: https://umamusume.gg/fall-g1-celebration-part-2-now-available-2/',
    sourceKey: 'seed:uma:star-pieces-jbc-2026',
  },
  {
    game: 'uma',
    name: 'Bonus Star Pieces — Queen Elizabeth II Cup',
    type: 'event',
    start: '2026-09-28 15:00',
    end: '2026-09-30 14:59',
    timezone: 'UTC',
    dailyTouch: true,
    notes:
      'Daily race bonus. Cygames notice transcription: https://umamusume.gg/fall-g1-celebration-part-2-now-available-2/',
    sourceKey: 'seed:uma:star-pieces-queen-2026',
  },
  {
    game: 'uma',
    name: 'Bonus Star Pieces — Mile Championship',
    type: 'event',
    start: '2026-10-04 15:00',
    end: '2026-10-06 14:59',
    timezone: 'UTC',
    dailyTouch: true,
    notes:
      'Daily race bonus. Cygames notice transcription: https://umamusume.gg/fall-g1-celebration-part-2-now-available-2/',
    sourceKey: 'seed:uma:star-pieces-mile-2026',
  },
  {
    game: 'uma',
    name: 'Bonus Star Pieces — Japan Cup',
    type: 'event',
    start: '2026-10-06 15:00',
    end: '2026-10-08 14:59',
    timezone: 'UTC',
    dailyTouch: true,
    notes:
      'Daily race bonus. Cygames notice transcription: https://umamusume.gg/fall-g1-celebration-part-2-now-available-2/',
    sourceKey: 'seed:uma:star-pieces-japan-2026',
  },
  {
    game: 'uma',
    name: 'Bonus Star Pieces — Champions Cup',
    type: 'event',
    start: '2026-10-13 15:00',
    end: '2026-10-15 14:59',
    timezone: 'UTC',
    dailyTouch: true,
    notes:
      'Daily race bonus. Cygames notice transcription: https://umamusume.gg/fall-g1-celebration-part-2-now-available-2/',
    sourceKey: 'seed:uma:star-pieces-champions-2026',
  },
  {
    game: 'uma',
    name: 'Scorpio Cup — registration',
    type: 'event',
    start: '2026-09-15 22:00',
    end: '2026-09-23 21:59',
    timezone: 'UTC',
    notes:
      'Registration ends before the final race. Cygames notice transcription: https://umamusume.gg/the-league-selection-period-for-the-champions-meeting-scorpio-cup-has-begun/',
    sourceKey: 'seed:uma:scorpio-registration-2026-09',
  },
  {
    game: 'nikke',
    name: 'COIN RUSH SHOWDOWN',
    type: 'event',
    start: '2026-09-17 18:00',
    end: '2026-10-08 04:59',
    timezone: 'UTC+9',
    dailyTouch: true,
    notes:
      'After maintenance; opening uses its planned finish. Publisher notice transcription: https://nikke.gg/september-17-patch-notes/',
    sourceKey: 'seed:nikke:2026-09-17-coin-rush',
  },
  {
    game: 'nikke',
    name: 'THREE COMPANY RUMBLE',
    type: 'event',
    start: '2026-09-17 18:00',
    end: '2026-10-08 04:59',
    timezone: 'UTC+9',
    dailyTouch: true,
    notes:
      'After maintenance; opening uses its planned finish. Publisher notice transcription: https://nikke.gg/september-17-patch-notes/',
    sourceKey: 'seed:nikke:2026-09-17-three-company',
  },
  {
    game: 'nikke',
    name: 'EXPO CHECK-IN — 14-day login',
    type: 'event',
    start: '2026-09-17 18:00',
    end: '2026-10-08 04:59',
    timezone: 'UTC+9',
    dailyTouch: true,
    notes:
      'After maintenance; opening uses its planned finish. Publisher notice transcription: https://nikke.gg/september-17-patch-notes/',
    sourceKey: 'seed:nikke:2026-09-17-expo-check-in',
  },
  {
    game: 'nikke',
    name: 'Guilty: Mighty Bunny Pick Up',
    type: 'banner',
    bannerKind: 'character',
    start: '2026-09-17 18:00',
    end: '2026-10-08 04:59',
    timezone: 'UTC+9',
    dailyTouch: false,
    notes:
      'After maintenance; opening uses its planned finish. Publisher notice transcription: https://nikke.gg/september-17-patch-notes/',
    sourceKey: 'seed:nikke:2026-09-17-guilty',
  },
  {
    game: 'nikke',
    name: 'Winter Limited Select Recruit',
    type: 'banner',
    bannerKind: 'character',
    start: '2026-09-17 18:00',
    end: '2026-10-08 04:59',
    timezone: 'UTC+9',
    dailyTouch: false,
    notes:
      'After maintenance; opening uses its planned finish. Publisher notice transcription: https://nikke.gg/september-17-patch-notes/',
    sourceKey: 'seed:nikke:2026-09-17-winter-select',
  },
  {
    game: 'nikke',
    name: 'Sugar: Killer Rabbit — Costume Gacha',
    type: 'banner',
    start: '2026-09-17 18:00',
    end: '2026-10-08 04:59',
    timezone: 'UTC+9',
    dailyTouch: false,
    notes:
      'After maintenance; opening uses its planned finish. Publisher notice transcription: https://nikke.gg/september-17-patch-notes/',
    sourceKey: 'seed:nikke:2026-09-17-sugar',
  },
  {
    game: 'nikke',
    name: 'LET’S DRINK PASS',
    type: 'event',
    start: '2026-09-17 18:00',
    end: '2026-10-08 04:59',
    timezone: 'UTC+9',
    dailyTouch: true,
    notes:
      'After maintenance; opening uses its planned finish. Publisher notice transcription: https://nikke.gg/september-17-patch-notes/',
    sourceKey: 'seed:nikke:2026-09-17-lets-drink',
  },
  {
    game: 'nikke',
    name: 'Bunny costume reruns',
    type: 'event',
    start: '2026-09-17 18:00',
    end: '2026-10-08 04:59',
    timezone: 'UTC+9',
    dailyTouch: false,
    notes:
      'After maintenance; opening uses its planned finish. Publisher notice transcription: https://nikke.gg/september-17-patch-notes/',
    sourceKey: 'seed:nikke:2026-09-17-costume-reruns',
  },
  {
    game: 'nikke',
    name: 'September 17 update maintenance',
    type: 'maintenance',
    start: '2026-09-17 11:00',
    end: '2026-09-17 18:00',
    timezone: 'UTC+9',
    notes:
      'Scheduled window; actual finish may vary. Publisher notice transcription: https://nikke.gg/september-17-patch-notes/',
    sourceKey: 'seed:nikke:2026-09-17-maint',
  },
  {
    game: 'nikke',
    name: 'Sin: Swift Bunny Pick Up',
    type: 'banner',
    bannerKind: 'character',
    start: '2026-09-24 05:00',
    end: '2026-10-15 04:59',
    timezone: 'UTC+9',
    dailyTouch: false,
    notes: 'Publisher notice transcription: https://nikke.gg/september-17-patch-notes/',
    sourceKey: 'seed:nikke:2026-09-sin',
  },
  {
    game: 'nikke',
    name: 'COIN RUSH SHOWDOWN — Story II',
    type: 'event',
    start: '2026-09-24 05:00',
    end: '2026-10-08 04:59',
    timezone: 'UTC+9',
    dailyTouch: false,
    notes: 'Publisher notice transcription: https://nikke.gg/september-17-patch-notes/',
    sourceKey: 'seed:nikke:2026-09-story-2',
  },
  {
    game: 'nikke',
    name: 'Full Burst Day',
    type: 'event',
    start: '2026-09-26 05:00',
    end: '2026-09-28 04:59',
    timezone: 'UTC+9',
    dailyTouch: true,
    notes: 'Publisher notice transcription: https://nikke.gg/september-17-patch-notes/',
    sourceKey: 'seed:nikke:2026-09-full-burst-1',
  },
  {
    game: 'nikke',
    name: 'Full Burst Day',
    type: 'event',
    start: '2026-10-03 05:00',
    end: '2026-10-05 04:59',
    timezone: 'UTC+9',
    dailyTouch: true,
    notes: 'Publisher notice transcription: https://nikke.gg/september-17-patch-notes/',
    sourceKey: 'seed:nikke:2026-09-full-burst-2',
  },
  {
    game: 'nikke',
    name: 'Solo Raid',
    type: 'cycle',
    start: '2026-09-24 12:00',
    end: '2026-10-01 04:59',
    timezone: 'UTC+9',
    dailyTouch: true,
    notes: 'Publisher notice transcription: https://nikke.gg/september-17-patch-notes/',
    sourceKey: 'seed:nikke:2026-09-solo-41',
  },
  {
    game: 'nikke',
    name: 'Coordinated Operation — Land Eater',
    type: 'cycle',
    start: '2026-09-25 12:00',
    end: '2026-09-27 23:59',
    timezone: 'UTC+9',
    dailyTouch: true,
    notes: 'Publisher notice transcription: https://nikke.gg/september-17-patch-notes/',
    sourceKey: 'seed:nikke:2026-09-land-eater',
  },
  {
    game: 'nikke',
    name: 'Simulation Room: Overclock — reward cycle',
    type: 'cycle',
    start: '2026-09-22 05:00',
    end: '2026-10-06 04:59',
    timezone: 'UTC+9',
    notes:
      'Season 10. Reward window follows the stated two-week reset rule. Source: https://nikke.gg/september-17-patch-notes/',
    sourceKey: 'seed:nikke:overclock-2026-09-22',
  },
  {
    game: 'nikke',
    name: 'Simulation Room: Overclock — reward cycle',
    type: 'cycle',
    start: '2026-10-06 05:00',
    end: '2026-10-20 04:59',
    timezone: 'UTC+9',
    notes:
      'Season 10. Reward window follows the stated two-week reset rule. Source: https://nikke.gg/september-17-patch-notes/',
    sourceKey: 'seed:nikke:overclock-2026-10-06',
  },
  {
    game: 'nikke',
    name: 'Simulation Room: Overclock — reward cycle',
    type: 'cycle',
    start: '2026-10-20 05:00',
    end: '2026-11-03 04:59',
    timezone: 'UTC+9',
    notes:
      'Season 10. Reward window follows the stated two-week reset rule. Source: https://nikke.gg/september-17-patch-notes/',
    sourceKey: 'seed:nikke:overclock-2026-10-20',
  },
  {
    game: 'nikke',
    name: 'Simulation Room: Overclock — reward cycle',
    type: 'cycle',
    start: '2026-11-03 05:00',
    end: '2026-11-17 04:59',
    timezone: 'UTC+9',
    notes:
      'Season 10. Reward window follows the stated two-week reset rule. Source: https://nikke.gg/september-17-patch-notes/',
    sourceKey: 'seed:nikke:overclock-2026-11-03',
  },
  {
    game: 'nikke',
    name: 'Simulation Room: Overclock — reward cycle',
    type: 'cycle',
    start: '2026-11-17 05:00',
    end: '2026-12-01 04:59',
    timezone: 'UTC+9',
    notes:
      'Season 10. Reward window follows the stated two-week reset rule. Source: https://nikke.gg/september-17-patch-notes/',
    sourceKey: 'seed:nikke:overclock-2026-11-17',
  },
  {
    game: 'nikke',
    name: 'Simulation Room: Overclock — reward cycle',
    type: 'cycle',
    start: '2026-12-01 05:00',
    end: '2026-12-15 04:59',
    timezone: 'UTC+9',
    notes:
      'Season 10. Reward window follows the stated two-week reset rule. Source: https://nikke.gg/september-17-patch-notes/',
    sourceKey: 'seed:nikke:overclock-2026-12-01',
  },
  {
    game: 'zzz',
    name: 'Shadow Chase Showdown',
    type: 'event',
    start: '2026-09-16 10:00',
    end: '2026-10-05 03:59',
    notes:
      'Publisher notice transcription. Server-local window: https://zenless.gg/shadow-chase-showdown-event-details/',
    sourceKey: 'seed:zzz:3.2-shadow-chase',
  },
  {
    game: 'endfield',
    name: 'Chubby Lung Attacks — goods exchange',
    type: 'event',
    start: '2026-09-16 12:00',
    end: '2026-10-07 04:00',
    notes:
      'Exchange closes after production ends. Official server-local window. Source: https://endfield.gryphline.com/en-us/news/5208',
    sourceKey: 'seed:endfield:1.5-aic-exchange',
  },
  {
    game: 'endfield',
    name: 'Sanity Supply (second window)',
    type: 'event',
    start: '2026-10-08 04:00',
    end: '2026-10-14 17:00',
    dailyTouch: true,
    notify: false,
    notes:
      'Americas/Europe close shown. Asia closes October 15 at 04:00 server time. This regional end difference is not represented by one shared row. Source: https://endfield.gryphline.com/en-us/news/5208',
    sourceKey: 'seed:endfield:1.5-sanity-2',
  },
  {
    game: 'endfield',
    name: 'Monumental Etching: Shadow Marked',
    type: 'event',
    start: '2026-10-05 12:00',
    end: '2026-10-19 04:00',
    notes: 'Official server-local window. Source: https://endfield.gryphline.com/en-us/news/5208',
    sourceKey: 'seed:endfield:1.5-monument-shadow',
  },
  {
    game: 'endfield',
    name: 'Ridgeline Flows of Autumn — sign-in',
    type: 'event',
    start: '2026-10-01 12:00',
    end: '2026-10-14 17:00',
    dailyTouch: true,
    notify: false,
    notes:
      'Official server-local opening. Ends at next maintenance; displayed close is an unconfirmed placeholder aligned to the final Americas/Europe Sanity Supply close. Source: https://endfield.gryphline.com/en-us/news/5208',
    sourceKey: 'seed:endfield:1.5-ridgeline',
  },
  {
    game: 'endfield',
    name: 'Runners’ Steeplechase',
    type: 'event',
    start: '2026-10-01 12:00',
    end: '2026-10-14 17:00',
    dailyTouch: false,
    notify: false,
    notes:
      'Official server-local opening. Ends at next maintenance; displayed close is an unconfirmed placeholder aligned to the final Americas/Europe Sanity Supply close. Source: https://endfield.gryphline.com/en-us/news/5208',
    sourceKey: 'seed:endfield:1.5-steeplechase',
  },
  {
    game: 'zzz',
    name: 'Surprise Screening Plan',
    type: 'event',
    start: '2026-09-23 10:00',
    end: '2026-10-20 03:59',
    dailyTouch: true,
    notes:
      'Server-local schedule in the publisher Steam announcement, mirrored at https://steamdb.info/patchnotes/24927009/',
    sourceKey: 'seed:zzz:3.2-screening',
  },
  {
    game: 'zzz',
    name: 'Advanced Bounty: Area Patrol',
    type: 'event',
    start: '2026-09-23 04:00',
    end: '2026-09-28 03:59',
    dailyTouch: true,
    notes:
      'Server-local schedule in the publisher Steam announcement, mirrored at https://steamdb.info/patchnotes/24927009/',
    sourceKey: 'seed:zzz:3.2-area-bounty',
  },
  {
    game: 'zzz',
    name: 'Diary of an Orbie Parent',
    type: 'event',
    start: '2026-09-30 10:00',
    end: '2026-10-19 03:59',
    dailyTouch: true,
    notes:
      'Server-local schedule in the publisher Steam announcement, mirrored at https://steamdb.info/patchnotes/24927009/',
    sourceKey: 'seed:zzz:3.2-orbie-parent',
  },
  {
    game: 'zzz',
    name: 'En-Nah Into Your Lap',
    type: 'event',
    start: '2026-09-30 10:00',
    end: '2026-10-20 03:59',
    dailyTouch: true,
    notes:
      'Server-local schedule in the publisher Steam announcement, mirrored at https://steamdb.info/patchnotes/24927009/',
    sourceKey: 'seed:zzz:3.2-en-nah',
  },
  {
    game: 'zzz',
    name: 'Chronicles of the Hobbling Crow',
    type: 'event',
    start: '2026-10-03 10:00',
    end: '2026-10-19 03:59',
    dailyTouch: false,
    notes:
      'Server-local schedule in the publisher Steam announcement, mirrored at https://steamdb.info/patchnotes/24927009/',
    sourceKey: 'seed:zzz:3.2-hobbling-crow',
  },
  {
    game: 'zzz',
    name: 'Data Bounty: Combat Simulation',
    type: 'event',
    start: '2026-10-14 04:00',
    end: '2026-10-19 03:59',
    dailyTouch: true,
    notes:
      'Server-local schedule in the publisher Steam announcement, mirrored at https://steamdb.info/patchnotes/24927009/',
    sourceKey: 'seed:zzz:3.2-data-bounty',
  },
  {
    game: 'zzz',
    name: 'Potential Hypothesis: Reforged in Fire',
    type: 'event',
    start: '2026-09-09 03:00',
    end: '2026-10-20 22:00',
    timezone: 'UTC',
    notes:
      'Ends with Version 3.2: October 21 at 06:00 UTC+8. Opening uses the planned maintenance finish. Publisher announcement mirror: https://steamdb.info/patchnotes/24927009/',
    sourceKey: 'seed:zzz:3.2-reforged',
  },
  {
    game: 'hsr',
    name: 'Planar Fissure',
    type: 'event',
    start: '2026-09-07 04:00',
    end: '2026-09-21 03:59',
    notes: 'Official announcement 1391. Both times use t_lc (server time). Double Planar Ornament drops.',
    sourceKey: 'hsr:1391',
  },
  {
    game: 'hsr',
    name: 'Nameless Honor — Battle Pass',
    type: 'event',
    start: '2026-08-26 03:00',
    end: '2026-09-27 19:59',
    timezone: 'UTC',
    notes:
      'Official announcement 1361. Global close: September 28 at 03:59 UTC+8. Purchase deadline is one hour earlier. Opening uses the planned maintenance finish.',
    sourceKey: 'hsr:1361',
  },
  {
    game: 'hsr',
    name: 'Realm of the Strange',
    type: 'event',
    start: '2026-09-19 04:00',
    end: '2026-09-28 03:59',
    endTimezone: 'UTC+8',
    notes:
      'Official announcement 1392: opening is t_lc (server time); closing is t_gl (UTC+8). Double Cavern Relic drops. Source: https://sg-hkrpg-api.hoyoverse.com/common/hkrpg_global/announcement/api/getAnnContent?game=hkrpg&game_biz=hkrpg_global&lang=en&bundle_id=hkrpg_global&platform=pc&region=prod_official_eur&level=70',
    sourceKey: 'hsr:1392',
  },
  {
    game: 'lads',
    name: 'Bounty Hunt — double drops',
    type: 'event',
    dailyTouch: true,
    start: '2026-09-21 05:00',
    end: '2026-09-28 04:59',
    notes:
      'First 30 Bounty Hunts each day give double drops; allowance resets at 05:00 server time. Full publisher-notice repost: https://www.reddit.com/r/RafayelMains/comments/1whykrf/love_and_deepspace_update_on_sept_16/',
    sourceKey: 'seed:lads:2026-09-bounty-double',
  },
  {
    game: 'nte',
    name: 'Pukaland Travelogue — after update',
    type: 'event',
    notify: false,
    start: '2026-09-30 05:00',
    end: '2026-11-11 05:59',
    timezone: 'UTC+8',
    notes:
      'Broadcast slide prints after update, September 30 05:00 through November 11 05:59 UTC+8. Opening depends on the update; this is not a verified maintenance finish. Alerts off pending the dated notice. Source slide: https://www.ntebuild.com/images/articles/nte-1-4-livestream-summary/pukaland-travelogue-event-dates.webp',
    sourceKey: 'seed:nte:1.4-pukaland-travelogue',
  },
  ...[
    ['coal-lump', 'Coal Lump’s Treasure', '2026-10-08', '2026-11-11'],
    ['golden-crackshot', 'Snap! Golden Crackshot', '2026-10-21', '2026-11-11'],
    ['puka-lucky-flip', 'Puka Lucky Flip', '2026-10-29', '2026-11-11'],
    ['stamina-recharge', 'Stamina Recharge', '2026-10-05', '2026-10-19'],
    ['pixel-surge', 'Pixel Surge', '2026-10-19', '2026-10-26'],
    ['gold-crash', 'Gold Crash', '2026-10-26', '2026-11-09'],
    ['sunset-circle', 'Beyond the Rails: Sunset Circle', '2026-10-08', '2026-10-22'],
  ].map(([key, name, start, end]): SeedEvent => ({
    game: 'nte',
    name: `${name} — time TBC`,
    type: key === 'sunset-circle' ? 'cycle' : 'event',
    start: `${start} 00:00`,
    end: `${end} 23:59`,
    notify: false,
    notes:
      'Announced calendar dates only. Hours and timezone are not confirmed; full-day server-local placeholders are shown without alerts. Publisher overview: https://www.gematsu.com/2026/09/neverness-to-everness-version-1-4-update-for-whom-the-verses-mourn-launches-september-30',
    sourceKey: `seed:nte:1.4-${key}`,
  })),
  ...[
    [
      'limited-selector',
      'Anniversary limited character selection',
      'Complete the Version 7.1 Archon Quest. Choose one of Tartaglia, Nilou, Baizhu, Chiori, Clorinde or Varesa.',
    ],
    [
      'standard-selector',
      'Anniversary standard character selection',
      'Log in to choose one of eight standard five-star characters.',
    ],
  ].map(([key, name, requirement]): SeedEvent => ({
    game: 'genshin',
    category: 'teyvat',
    name: `${name} — time TBC`,
    type: 'event',
    start: '2026-09-23 00:00',
    end: '2026-11-03 23:59',
    notify: false,
    notes: `${requirement} Official 7.1 Benefits Overview: after update through November 3, server time. Exact hours are not supplied; full-day placeholders shown without alerts. Source: https://sdk.hoyoverse.com/upload/ann/2026/09/12/503dbdabd59d6ff5aebd151d5011b7f7_3634289702927936987_transformed.jpg`,
    sourceKey: `seed:genshin:7.1-${key}`,
  })),
];
