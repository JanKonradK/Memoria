# Event feed notes

Research notes for the bundled event feed in `app/src/data/feed/current.json`.
They were comments in `seed-feed.ts` until Beta 0.4 moved the events to JSON.
Read the rules at the top before changing any dates.

## How to read publisher notices

Bundled event feed — banners/events per game, reviewed against publisher
announcements and patch notes. Each refresh records verified facts and source
gaps in docs; forecasts remain labelled. The store imports missing entries
automatically whenever local state loads.

Times are strings in the game's SERVER time and converted with the game's
configured tz at import, so they stay correct on any server region.
HoYo feed items reuse the ⤓ HoYoLAB sourceKey (`genshin:<ann_id>`) so the
two import paths dedupe against each other.

READING A HOYO NOTICE — the rule earlier refreshes got half right. The
announcement API answers the same date strings for every region but reports
a different `data.timezone` (os_euro → 1, os_asia → 8, os_usa → -5), and the
bodies tag each time with its own class:

- `t_lc` (LOCAL) wraps event, banner and BP durations. Every server sees
  that same wall clock, which is why these end at 03:59 — one minute
  before the 04:00 daily reset, itself server-local. Copy `t_lc` values
  STRAIGHT ACROSS to the Europe rows. Do not shift them.
- `t_gl` (GLOBAL) wraps the maintenance schedule, one absolute moment
  quoted in UTC+8. That one DOES need -7h for a UTC+1 row.
  Subtracting 7h from a `t_lc` value was the bug that put the whole 7.0 banner
  slate three hours early. When in doubt, check which class the notice used.

Rebuilt from scratch 2026-07-12, cross-checked against the official HoYo
announcement feeds, game8's per-game event calendars, nte.wiki and the
fandom wikis. Refreshed 2026-07-20: added the ZZZ v3.1 slate revealed in the
3.1 livestream (releases Jul 29) and corrected the NTE phase-2 name to Iroi;
Genshin 6.7 / HSR 4.4 / WuWa 3.5 were mid-patch with no new announcements.

Refreshed 2026-08-07 against the official feeds, one game at a time. What
that pass changed, beyond adding four games:

- There is no Genshin 6.8. The next version is 7.0 "Everwinter Without
  Mercy", on 2026-08-12.
- Spiral Abyss resets on the 16th, not the 15th, and only once a month
  (the twice-monthly schedule ended in June 2024).
- ZZZ's whole v3.1 slate is now published, so the game8 estimates are gone.
- WuWa 3.5 ends on Aug 19, not Aug 20.
- Several HSR and WuWa windows close at 14:59/11:59, not at the
  maintenance hour; a banner shuts before the servers do.

Refreshed 2026-08-09 against the official HoYo announcement APIs (the same
feeds the `<game>:<ann_id>` sourceKeys come from). What that pass changed:

- Stygian Onslaught opened 2026-07-06 12:00, not 07-08 10:00, and is an
  official notice rather than an estimate.
- "When We Look Up at the Moon" is ann 21750 opening 06-29 12:00 (it was
  filed under 21741 / 07-01), and "To Temper Thyself" Cycle 5 is ann 21761
  opening 08-08 12:00 — both were placeholder guesses.
- Every recurring cycle now reuses ONE name per mode, with the rotation's
  own title in `notes`. Names like "— current phase" both went stale on
  their own and broke buildCycleConnectorPaths, which groups instances by
  exact name: no two HSR or ZZZ windows were ever being connected.
- There is still no Genshin 7.0 slate: the feed has not published one.

Refreshed 2026-08-17/18, one game at a time, against each publisher's own
feed. All nine games rebuilt.

PUBLISHERS DO NOT SHARE A CONVENTION. Per-game notes live in each block, but
the shape of the problem is: HoYo tags times `t_lc`/`t_gl`; ZZZ spells the
same split `(server time)` vs `(UTC+8)`; Kuro splits it by notice TYPE
(maintenance global, convenes local); Perfect World mixes both inside ONE
notice; Endfield splits it inside a single LINE (opens local, ends global);
LADS is local throughout; Uma and NIKKE are single-service so the question
does not arise. Never carry one game's rule to another.

Two failure modes produced most of the errors found on this pass, and both
are easy to repeat:

1. Inventing an end date for content that has none. HSR's Fate collab warp
   is explicitly permanent and was carrying a fabricated close.
2. Copying a previous season's LENGTH onto a new one. That produced Uma's
   Virgo Cup (4 days late), LADS' phantom 45-day Hunter Contest season, and
   ZZZ's Deadly Assault close (2 days early — it ran a 16-day stretch
   season to re-align to Fridays).
   If a notice does not state a boundary, say so with notify:false. Do not
   derive one from last time.

The headline finding is the t_lc/t_gl rule above. It is not cosmetic: it was
silently shifting whole slates. What else this pass changed:

- GENSHIN: the v7.0 slate is published, so the placeholder guesses became
  real rows with ann_ids. Phase 1 runs to 09-01 17:59, NOT the 14:59 that
  was extrapolated from the old (wrong) blanket -7h rule.
- getAnnList `start_time` is when the NOTICE appears, up to two days ahead
  of the window itself. Trust the 〓Duration〓 line in the BODY. That alone
  fixed Genshin's "To Temper Thyself" (opens 08-10 04:00, not 08-08 12:00)
  and HSR's Fate Gift (opens with the collab on 07-24, not with 4.4).
- HSR: the old note here claimed HSR has no public feed. It does. Anomaly
  Arbitration turned out to be VERSION-ALIGNED, not a 6-week cycle, and the
  Fate collab warp is PERMANENT — its invented end date is gone.
- Shipping an invented end for permanent content, and copying a previous
  season's length onto a new one, were the two recurring failure modes.
  They produced: HSR's Fate warp, LADS' phantom "45-day" Hunter Contest
  season, and Uma's Virgo Cup close (4 days late, copied from the 2025 cup).
- Recurring cycles now share ONE bare name with the season in `notes`, in
  LADS, Uma, NIKKE and Endfield too. Season-suffixed names never grouped,
  so no connector was ever drawn for those four.

Refreshed 2026-08-27 (gpt-5.6-luna, web research) against each publisher's
feed again, and this pass ADDS THE LIVESTREAM ROW. What changed:

- GENSHIN: the 7.0 phase-1 slate verified clean — Odette, Arlecchino and
  the Epitome rerun all confirmed against the notice. Stygian Onslaught's
  v7.0 rotation actually opens 08-19 10:00, not the 08-17 12:00 carried
  here. Five 7.0 events were missing entirely (Raiment Collection, Event
  Ode, both Miliastra Wonderland phases, Forge Realm's Temper).
- HSR: the whole 4.5 slate stops being an estimate. v4.5 is a SHORT 33-day
  version, not the usual 42, and the notice shortens Apocalyptic Shadow and
  Pure Fiction to 5 weeks with it: they close 10-05 and 10-19, not 10-12 and
  10-26. Minuscule Great Adventure opens 09-12 12:00, not with the version.
  The 4.6 boundary carried here (09-27 23:00) was already right — a first
  research pass called it wrong by reading a t_gl time as t_lc, which is the
  same seven-hour trap this header has warned about since July.
- WUWA / NTE: 3.6 and 1.3 both have full official notices now, so almost
  every estimated row in those two blocks became fact.
- ZZZ: six 3.1 events were missing, and the 3.2 Special Program has an
  official date.

Refreshed 2026-09-02, mid-patch for six of the nine games and across a version
boundary for three. What changed:

- ENDFIELD had NO v1.5 content at all — the version went live on 09-01 23:00
  (Americas clock) the day before this pass and the block still ended at the
  1.4 maintenance. Twelve rows added. Its close is genuinely unpublished, so
  every row that depends on it says so.
- UMA ran dry on 09-02 and NIKKE on 09-10. Both blocks now reach into
  October.
- ZZZ's 3.2 Special Program aired on 08-28 as scheduled, so the 3.2 banner
  slate exists — as press rows, because the in-game notices do not publish
  until the 09-09 update. The 3.1 block was re-checked against the feed
  line by line and needed nothing: all twenty-two rows already matched.
- GENSHIN gained the four 7.0 rows the feed carries and this file did not
  (TCG Heated Battle, Spooky Summer Adventures, the timed Archon Quest
  reward, and the 09-16 Spiral Abyss), and the phase-2 banner guess became
  three real ann rows — 21805 / 21806 / 21808, opening 09-01 18:00 exactly
  as predicted. The 7.0 notice also states the Abyss dates outright
  ("Phase 1 ... on August 16", "Phase 2 ... on September 16"), which settles
  the once-a-month-on-the-16th reading for good.
- HSR needed almost nothing: the 4.5 slate this file shipped on 08-27 from
  the update notice is still exactly what the feed says. Phase 1's warp
  notice (ann 1330) has since published and confirms the estimated
  boundaries, and Anomaly Arbitration's 4.5 theme is now named.
- LADS remains the one game with no reachable feed. It gets the two rows
  that could be sourced and nothing else.

SOURCE KEYS ARE NOT UPGRADED IN PLACE. Several rows now have an ann_id that
they did not have when they were written under a `seed:` key. Rewriting the
key would withdraw the installed row and re-add it as a new one, losing its
tick mark for no gain, so an ann_id is used only for a row this file has never
shipped. The id goes in the docs review file when it is worth recording.

THE LIVESTREAM ROW. Every one of these games reveals its next version in a
broadcast a week or two before the patch, and that broadcast is the cue to
refresh this file. So each game that HAS one now carries a 'livestream' row.

- When the date is announced, the row is the broadcast itself.
- When it is not, the row is the PLAUSIBLE RANGE, derived from where the
  last 4-6 streams sat relative to their releases — start = earliest, end =
  latest. The name says "predicted window" so the bar cannot be mistaken
  for a fixture. The docs review file records the derived offsets.
  This is the one deliberate exception to the notify rule below: a predicted
  livestream keeps notify:true even though its date is an estimate, because a
  reminder that never fires is the one thing it cannot afford to be. The name
  carries the uncertainty instead of the flag.
  LADS, Uma and NIKKE have NO recurring patch broadcast — news posts only — so
  they get no livestream row rather than an invented one.

A livestream is a single global moment, like `t_gl` maintenance, and is
stored here as the Europe (UTC+1) wall clock. Per-account tz conversion at
import will shift it for a non-EU server, exactly as it already does for
maintenance; that is a known limit of the one-clock-per-row model, not a
per-row error.

Categories: 'event' (play these), 'cycle' (recurring endgame
windows — Abyss/Theater, MoC/PF/AS/AA, Shiyu/DA), 'banner' (pulls),
'maintenance' (patch downtime), 'livestream' (the next-version broadcast).
Web-only and permanent content is excluded.

`notify: false` is the honesty valve. Anything whose date came from a
community estimate rather than an official notice carries it, plus a note
saying so, so an approximate window never fires an alert as if it were fact.

`notes` is shown to players. Write only what helps them play: rewards,
requirements, phase dates, or an "Estimated dates." marker. Provenance
(notice ids, URLs, time-zone reasoning, corrections) goes in the docs review
file, never in `notes`.
/

/** Last bundle refresh, not a claim that every publisher supplied new dates.
The per-game evidence and remaining gaps are in docs/game-news-review-2026-10-03.md,
docs/game-news-review-2026-10-11.md, docs/game-news-review-2026-10-17.md,
docs/game-news-review-2026-10-25.md, and docs/game-news-review-2026-11-03.md.

## genshin

### When We Look Up at the Moon (`genshin:21750`)

================================================== GENSHIN IMPACT — v6.7 "Luna VIII"
Jul 1 – Aug 12, then v7.0 "Everwinter Without Mercy". There is no 6.8: HoYoverse
skipped from 6.7 straight to 7.0, announced in the Jul 31 Special Program.
Events/banners from the official announcement feed (exact server times); Abyss and
Theater from the fandom wiki. Both run permanently and reset ONCE a month — Abyss on
the 16th, Theater on the 1st. The twice-monthly Abyss ended in June 2024.
--- events

### To Temper Thyself and Journey Far — Cycle 5 (`genshin:21761`)

〓Event Duration〓 in ann 21761 reads 2026/08/10 04:00 - 2026/11/02 03:59.
The old 08-08 12:00 was getAnnList's start_time — when the NOTICE went up.

### Stygian Onslaught (`genshin:21847`)

--- cycles

### Spiral Abyss (`seed:genshin:abyss-2026-08`)

Abyss and Theater BOTH run permanently. Abyss resets the 16th, Theater the 1st.

### Flins — The Lone Light Knocks at Night (phase 2) (`genshin:21805`)

--- banners
Wishes close at 14:59, hours before the servers go down — an end set to the
maintenance hour would quietly promise pulls that are no longer buyable.
--- v7.0 (Aug 12 onward). The slate is published now, so these rows carry
real ann_ids and real times instead of the reset-aligned guesses they had
on 08-09. Everything below opens "After the Version 7.0 update", i.e. when
the t_gl maintenance above finishes: 08-12 04:00 on the Europe clock.
Phase 2 published on 08-27 and the estimate this file carried was right to
the minute: 09-01 18:00 - 09-22 14:59, both t_lc. The single combined guess
is retired in favour of the three rows the feed actually ships.

### Genius Invokation TCG: Tactical Formation (`genshin:20748`)

--- 7.0 rows the feed carries that this file did not, found on the 09-02 pass.
All three are t_lc and copy across unshifted.

### Silverwing in Pursuit of the Moon (`seed:genshin:7.1-silverwing`)

Timed notices replace calendar-only placeholders under their existing keys.
Later events still have calendar dates only and must not send alerts.

### When Warm Winds Cavort — Vesna (`genshin:21876`)

October 3 review. Exact windows and source gaps: docs/game-news-review-2026-10-03.md.

### Void Star’s Advent — Skirk (`genshin:21888`)

October 11 review. Evidence and remaining gaps: docs/game-news-review-2026-10-11.md.

### Starlight Voyage: Heart Unbound (`genshin:21901`)

October 17 review. Evidence and remaining gaps: docs/game-news-review-2026-10-17.md.

### The Forge Realm's Temper: Clever Stratagems (`genshin:20508`)

October 25 review. Evidence and remaining gaps: docs/game-news-review-2026-10-25.md.
--- Genshin Impact

### Epitome Invocation — Starsealed Edict / Splendor of Tranquil Waters (`genshin:21977`)

November 3 review. Version 7.2 notices: docs/game-news-review-2026-11-03.md.

## hsr

### Fate Contract: Renewal — free Gilgamesh or Archer (`seed:hsr:4.4-free-servant`)

================================================== HONKAI: STAR RAIL — v4.4 "In Ravages
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
after 08-26 to replace them with first-party times.
--- events
--- events (4.4)

### Pure Fiction (`seed:hsr:pf-4.4`)

--- cycles (staggered 6-week endgame windows)

### v4.6 update maintenance (`seed:hsr:4.6-maint`)

--- banners
Warps close at 15:00, eight hours before the 4.5 maintenance.
--- maintenance

### Overdrive: Whirlwind Grand Prix (flagship) (`seed:hsr:4.5-overdrive`)

--- v4.5 "To Roll the Stars in Astropolis" (Aug 26 – Sep 27). The update notice has published, so the
phase-1 rows below are no longer estimates.

v4.5 IS A SHORT VERSION — 33 days between maintenance handoffs, not the 42 that 4.4→4.5
ran. The notice says so outright: "Due to the duration adjustment of Version 4.5, the
duration of Apocalyptic Shadow and Pure Fiction for this period will be shortened to 5
weeks." Do not "fix" this back to a 6-week cadence on the next pass.

The version line is t_gl — "until 2026/09/28 06:00 (UTC+8)" = 09-27 23:00 here. The
Apocalyptic Shadow and Pure Fiction lines are t_lc and copy across unshifted, which is
why they outlive the version and run on into 4.6. Overdrive's "2026/09/28 03:59 (UTC+8)"
is likewise t_gl and lands at 09-27 20:59, NOT 09-28 03:59: reading that one as t_lc is
the exact mistake that would push the whole 4.5 slate seven hours late.

### Robin • Summeretto · Hyacine rerun (phase 1) (`seed:hsr:4.5-p1-robin`)

Phase 1 and phase 2 use their published local times. The phase 2 close
conflicts with the global maintenance boundary; those rows remain silent.

### Now I Am Become Blade — Mortenax Blade rerun (`seed:hsr:4.6-mortenax-blade`)

--- Honkai: Star Rail

## zzz

### Deadly Assault (`seed:zzz:da-2026-08-28`)

================================================== ZENLESS ZONE ZERO — v3.1 "The Long
Goodbye" (Jul 29 – Sep 8). The dead v3.0 block was dropped on the 08-17 pass: all 15
rows had ended and none still appear in the live feed.

ZZZ's notices carry NO t_lc/t_gl markup — the class rides in the text suffix instead,
`(server time)` for LOCAL and `(UTC+8)` for GLOBAL. Same rule, different spelling.

The version boundary is no longer a guess: ann 1234 states "Version 3.1 will run for
42 days, ending on 2026/09/09 06:00 (UTC+8)" — GLOBAL, so -7h → 2026-09-08 23:00.
Rows dated "End of Version 3.1" were already numerically right; what was wrong was
calling them unsourced. They now notify.

One trap for the next refresh: ZZZ files its BANNERS under `data.pic_list`, not
`data.list`. A rebuild that reads only `list` silently loses every banner row.
--- cycles. Both modes reset every 14 days. The 3.1 update forced Deadly Assault into
an early start, and it has since re-aligned to the Friday cadence via one 16-day
stretch season — so the two now alternate WEEKLY (Shiyu Aug 7/21, DA Aug 14/28)
rather than colliding. No official notice publishes either window: ann 1234 gives the
rotations and buff sets but no schedule, which is why every cycle row stays silent.

### Summer Waves Roll In — Fantasy Resort summer event (`seed:zzz:3.1-summer-waves`)

--- banners
--- maintenance
--- v3.1 "The Long Goodbye" (Jul 29 – Sep 8). The full update notice is out,
so the game8 estimates this block used to carry are gone: 3.1 opened at
04:00 on Jul 29 and the version ends 2026-09-08 23:00. Phase 2 flips Aug 19.
Several events are dated only "end of version" in the notice; those carry
the version boundary and stay silent.
--- events

### Remielle — Paradise Regained (flagship) (`seed:zzz:3.1-remielle`)

--- banners

### v3.2 update maintenance (`seed:zzz:3.2-maint`)

--- maintenance

### Claret — Bloodmoon Rising (phase 1) (`seed:zzz:3.2-claret`)

--- v3.2 "Their Secret Histories". Sep 7–8 publisher notices confirm phase 1
and the dated events below. After-update openings use the scheduled global
maintenance finish; phase 2 remains provisional until its own notice.

### Shiyu Defense: Critical (`seed:zzz:shiyu-2026-09-04`)

--- endgame windows past the 3.1 boundary. Fourteen days each, unbroken since
the 08-14 realignment to Fridays. Cadence only: ZZZ never announces these, and
the 09-08 version update can cut one short exactly as 3.1's did.

### All-New Program — 7-day login (`seed:zzz:3.2-all-new-program`)

================================================== NEXT PATCH LIVESTREAMS
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
more and it earns a predicted row like the rest.
Dated Sep 7–8 notices; research and fetch gaps are recorded in docs/event-feed-2026-09-08.md.

### Phoenix — Into the Flames of Life (phase 1) (`seed:zzz:3.3-phoenix`)

--- Zenless Zone Zero v3.3 "Journey to the Sky" (Oct 21 – Dec 2)

### ZZZ 3.4 Special Program — predicted window (`seed:zzz:3.4-livestream`)

3.3 aired 9 October, 12 days before its update; 3.4 lands 2 December.

## wuwa

### Qingxiao + Denia rerun (phase 1) (`seed:wuwa:3.6-p1`)

================================================== WUTHERING WAVES — v3.5 "Blade of Past
Resounds" (Jul 10 – Aug 19, Mengzhou region, first SP character). This block used to
run to Aug 20 off game8's estimate; the version actually ends Aug 19, with events
closing at 03:59 and convenes at 11:59. v3.6 "Lamplight in Mirage" follows on Aug 20.
Tower of Adversity and Whimpering Wastes are deliberately NOT seeded — they stay as
preset tasks, because their cycles are 28-day rotations with no published windows.
--- events
--- banners. Convenes close at 11:59, not at the maintenance hour.
--- maintenance
--- v3.6 "Lamplight in Mirage" (from Aug 20). The Aug 7 preview named six events with
no windows, so the 08-18 pass deliberately left them out rather than smear them across
the version span. That caution paid: the official notice puts them on FIVE different
start dates (Aug 20, Aug 22, Aug 27, Sep 3, Sep 10, Sep 17), so seeding them at launch
would have been wrong for five of the six. They are now seeded from the notice.

Phase 2 is confirmed by the publisher convene notice 5431.

### Gifts of Drifting Mist (login) (`seed:wuwa:3.6-login`)

--- v3.6 events, all six from the official Kuro notice. Note the five distinct
start dates: this slate does NOT open with the version.

### Suoming (phase 2) (`seed:wuwa:3.7-suoming`)

--- Wuthering Waves v3.7 phase 2

## nte

### Beyond the Rails (`seed:nte:1.3-rails-4`)

================================================== NEVERNESS TO EVERNESS — v1.2 "999 Nights"
ends Aug 18; v1.3 "Rising from the Moonlit Fog" launches Aug 19.

CONVENTION: MIXED, and Perfect World mixes the two INSIDE ONE NOTICE. The 1.2 patch
notes contain both of these:
"999 Nights" July 8 (after update) – August 19, 05:59 (UTC+8) ← GLOBAL, -7h
"Stamina Recharge" July 13, 05:00 – July 20, 04:59 (server time) ← LOCAL, as-is
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
If that is wrong, every rails row is 7 hours late — worth one in-game countdown check.
--- events
--- cycles
Beyond the Rails rotates a Special Route every 14 days. The group name used to be
"Beyond the Rails — Prime Circle", but Prime Circle was a specific one-off route that
ENDED 2026-06-04 — a dead route name baked into the connector key. The routes so far
are Blazing (Jul 16) → Cresting (Jul 30) → Waxing (Aug 13), so the route belongs in
notes and the name stays bare. Note the mode also contains a PERMANENT route,
Fractured Circle, which must never be seeded.

### Alluring Shadows — Zankou (phase 1) (`seed:nte:1.3-zankou`)

--- banners
--- maintenance
--- v1.3 "Rising from the Moonlit Fog" (Aug 19 – Sep 30). Every row below is silent:
Perfect World's own 1.3 article could not be reached (the site is a JS SPA and the
article is not indexed yet), so these durations are third-party transcriptions of the
official notes rather than the notes themselves. The 04:00 starts inherit the assumed
11:00 (UTC+8) maintenance end. Re-run once the notice is reachable.
--- banners

### Water Racing (`seed:nte:1.3-water-racing`)

--- events with durations quoted from the 1.3 notes

### Volley Star (`seed:nte:1.3-volley-star`)

--- day-level only. Clock times assume the standard 05:00 → 04:59 server-time pattern,
which is how the identical 1.2 events ran; the dates themselves are community-sourced.

### Soundscape Special — Voice of the Voyager (`seed:nte:1.3-voyager`)

September 17 audit. Source coverage: docs/event-feed-2026-09-17.md.

### October 21 update maintenance (`seed:nte:1.4-oct21-maint`)

--- Neverness to Everness v1.4 second half

### NTE 1.6 Preview Special Program — predicted window (`seed:nte:1.6-livestream`)

The last two programs aired 14 days before release; 1.6 is expected 23 December.

## lads

### Senior Hunter Contest (`seed:lads:hunter-contest-2026-s17`)

================================================== LOVE AND DEEPSPACE — v6.0 "A Shattered
Quiet" (from Jul 9). Infold runs half-year major versions with rolling banner cycles
inside them, so there is no patch boundary to hang events off — every row below comes
from the official global feed or the wiki, dated on its own. The Europe server is
UTC+2, which is why these clock times do not look like the HoYo ones.

CONVENTION: LOCAL throughout — no arithmetic anywhere in this game. Infold runs NA on
UTC-7 and EU on UTC+2 and calls the shared quantity "Server Time", so a "(Server Time)"
duration is the same wall clock on both. When they mean one absolute instant they say
so explicitly, switching notation mid-sentence ("from 05:00 on Jul. 2 (server time) to
04:59 on Jul. 9 (UTC+8)"). Converting a "(Server Time)" value would shift this whole
game by 6 hours.
Seasons run 14 days. The old row claimed a 45-day Season 14 ending Aug 27 — that season
actually ended Jul 27, so the stored end looks like a Jul→Aug typo. Name is the bare
recurring string now; the season number lives in notes so instances group.

### Misty Invasion rerun (`seed:lads:2026-10-misty-invasion`)

--- Love and Deepspace

## uma

### Spotlight Scout — Yamanin Zephyr (`seed:uma:scout-2026-09-01`)

================================================== UMAMUSUME: PRETTY DERBY — Global.
Cygames ships named campaigns, not numbered versions, so there is no maintenance row
to anchor to. Everything below is on the Global UTC+0 clock: content opens at 22:00,
while daily missions roll at 15:00.

CONVENTION: GLOBAL, and trivially — there is ONE Global service, so the local/global
split collapses. The official roadmap quotes SGT (UTC+8) and the official account
quotes UTC for the same events, so the conversion is SGT - 8h. It self-checks against
both known boundaries: 06:00 SGT - 8h = 22:00 UTC (content opens) and 22:59 SGT - 8h =
14:59 UTC (the 15:00 daily-mission roll). Watch which boundary a window closes on —
assuming the 22:00 one is what put the anniversary end 7 hours late.
Champions Meeting is monthly and recurring, so instances share the bare name and carry
the cup in notes — otherwise every cup groups alone and no connector is ever drawn.
--- September. Uma publishes DATES and not times, so every row below uses the
block's established 22:00 open / 21:59 close (and 14:59 for Legend Races), the
same convention the August rows were verified against. The dates are the
game's own schedule; the clock is inference, which is why these stay silent.

### New Year Guaranteed Scouts — 3★ / SSR (`seed:uma:guaranteed-new-year-2026`)

--- Umamusume New Beginnings Part 1

## nikke

### September Mission Pass (`seed:nikke:mission-pass-sep`)

================================================== GODDESS OF VICTORY: NIKKE — the
PERSONA ON FRONTLINE collab, Aug 13 – Sep 10. Shift Up ships an update roughly every
2–3 weeks and does not publish client version numbers, so updates are named here.

CONVENTION: GLOBAL and trivial — every region runs on ONE UTC+9 clock and every notice
is already stamped (UTC+9), so nothing below is converted. Daily reset is 05:00, which
is why almost every window opens 05:00 and closes 04:59; the 07:00 starts are the Aug 13
maintenance END, not a reset.

The Aug 13 maintenance was stored as 15:00–18:00 "copied from the PROJECT MATIS
downtime". It was actually 00:00–07:00 — seven hours from midnight. That row is gone,
but the 07:00 it establishes is the start every collab row below inherits.

### PERSONA ON FRONTLINE (`seed:nikke:persona-on-frontline`)

--- PERSONA ON FRONTLINE collab

### Simulation Room: Overclock — reward cycle (`seed:nikke:overclock-2026-08-25`)

Season 9 runs 2026-06-30 05:00 to 2026-09-22 04:59 and the reward record resets every
14 days at the Tuesday 05:00 reset. Chaining from the published start lands exactly on
the published season end, which is what makes the derivation trustworthy.

### GREAT VILLAIN UNION (`seed:nikke:great-villain-union`)

September 3 notice: all times are UTC+9. Opening after maintenance
uses its scheduled finish; the actual finish can change.

### Marian: Queen Pick Up (`seed:nikke:2026-10-marian-queen`)

--- NIKKE 4th anniversary (update October 29)

## endfield

### Winter Hunt — Typhoeus (`seed:endfield:1.5-typhoeus`)

================================================== ARKNIGHTS: ENDFIELD — v1.4 "Homecoming"
(from Jul 15/16). GRYPHLINE runs ONE combined Americas/Europe server on UTC-5, so these
clock times are the AM/EU ones, not the Asia UTC+8 figures in the notices.

CONVENTION: SPLIT, and the split happens INSIDE a single notice line. Endfield prints
dual server columns, and the same row shows a 0-hour gap on the start and a 13-hour gap
on the end:
The Rooted Realm Asia 2026/08/09 12:00 – 2026/09/02 06:00 (UTC+8)
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
1.4 window's shape, not a published one, so the row stays silent.
Echoes of War is now fully sourced, not community-derived: Recalling I/II/III ran
7/7/10 days and Delirating I/II/III run 7/7/10, the third of each season stretching to
the version boundary. Instances share the bare name so the connectors group.
v1.5 update notice 5208: event dates below use server time unless a
timezone override is set. The next maintenance has no confirmed date.
Rows with an estimated end remain silent. See the September 17 audit.
