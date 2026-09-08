# Event feed check — 8 September 2026

Added five dated ZZZ entries: All-New Program, Clink, Clank, Pinball Knight!, Angels Support Operation, New Eridu City Fund, and phase-1 Final Callback auditions. Updated the three existing phase-1 banner rows in place. Maintenance starts at 22:00 UTC on 8 September; the publisher estimates five hours. After-update openings use that planned finish and retain server-local closing times.

Sources:

- [Publisher phase-1 notice, 7 September](https://zenless.hoyoverse.com/m/en-us/news/165979): closes 30 September at 11:59 server time. This newer notice takes precedence over an older weapon showcase with a conflicting date.
- [Publisher All-New Program notice, 8 September](https://zenless.hoyoverse.com/m/en-us/news/165997): after update through 20 October at 03:59 server time.
- [ZZZ publisher account](https://www.hoyolab.com/accountcenter/postlist?id=219270333): Pinball Knight runs 10 September 10:00 through 19 October 03:59; Angels Support runs after update through 30 November 03:59; City Fund closes 19 October 03:59. All closes are server-local. These notice bodies were available through web search extraction; direct pages returned empty JavaScript shells.

No dates were invented for the remaining announced events. Surprise Screening Plan, Diary of an Orbie Parent, Shadow Chase Showdown, Chronicles of the Hobbling Crow, En-Nah Into Your Lap, and the bounty events still need complete dated notices. Potential Hypothesis gives only “End of Version 3.2”. Existing phase-2 banner estimates remain silent.

## Search Summary

Used webcmd 0.5.2 fetch-first, then built-in web search/open after the official article returned an empty body and the announcement API request was cancelled. No browser fallback, installations, or permission changes. Official ZZZ article and publisher-account notice bodies supplied the dates above. Publisher reposts supplied the other-game additions below and are labelled in event notes.

# Other-game schedule check — 2026-09-08

No seed or UI files edited. Compared with app/src/data/seed-events.ts. The items below use fetched notice bodies, not search snippets. A publisher repost is marked explicitly when the original could not be fetched. Keep all existing source keys when correcting an installed row.

## Concrete additions

| Game       | Entry                                | Start            | End              | Clock          | Evidence                                                                                                                                                                                                                                                                                                              |
| ---------- | ------------------------------------ | ---------------- | ---------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LADS       | Shared Bloom                         | 2026-09-08 05:00 | 2026-09-17 04:59 | Server local   | [Dated automated publisher repost](https://www.reddit.com/r/CalebMains/comments/1w9hpg9/love_and_deepspace_shared_bloom/), links [official post](https://x.com/Love_Deepspace/status/2096810765009535038), original returns 403                                                                                       |
| LADS       | Where Silverwings Rest — Sylus rerun | 2026-09-08 05:00 | 2026-09-15 04:59 | Server local   | [Sept 7 update repost](https://www.reddit.com/r/LADS_OG/comments/1w9zfkr/love_and_deepspace_update_on_sept_7/), corroborated by [publisher Instagram mirror](https://imginn.com/p/Dc_AzwtCWJe/). [Original Instagram](https://www.instagram.com/p/Dc_AzwtCWJe/) throttled. Pair: Crimson Rapture / Crimson Departure. |
| Uma Global | Bonus Daily Race Entry Tickets       | 2026-09-03 15:00 | 2026-09-17 14:59 | UTC absolute   | [Cygames notice transcription, Sep 2](https://umamusume.gg/increased-daily-race-tickets-event-coming-soon/). Three extra daily tickets.                                                                                                                                                                               |
| Uma Global | Bonus Star Pieces — Kikuka Sho       | 2026-09-06 15:00 | 2026-09-08 14:59 | UTC absolute   | [Cygames notice transcription, Sep 6](https://umamusume.gg/bonus-star-piece-rewards-in-career-4/). Satono Diamond pieces. Ends today; may already be over at import.                                                                                                                                                  |
| NIKKE      | Coordinated Operation: Storm Bringer | 2026-09-11 12:00 | 2026-09-13 23:59 | UTC+9 absolute | [Publisher patch-note transcription](https://nikke.gg/september-3-patch-notes/), section 5. Printed close is 23:59:59. IMPORTANT: editorial TL;DR says 11:00, but actual notice body says 12:00. Use body.                                                                                                            |

Suggested new keys: seed:lads:shared-bloom-2026-09, seed:lads:where-silverwings-rest-2026-09, seed:uma:daily-race-tickets-2026-09, seed:uma:kikuka-star-pieces-2026-09, seed:nikke:coop-storm-bringer-2026-09. Explicitly label mirror/repost evidence in notes. Do not call these directly fetched publisher notices.

## Concrete corrections / confirmations

- Uma `seed:uma:outing-2026-09`: close is **2026-09-10 14:59 UTC**, not 21:59. Start remains Sep 1 22:00 UTC. [Cygames notice transcription](https://umamusume.gg/lets-go-uma-outing-now-available/) states both boundaries outright and the 15:00 daily reset. Keep key.
- Uma `seed:uma:legend-races-2026-09`: exact current combined window Sep 3 22:00 to Sep 9 14:59 UTC confirmed by [Sep 3 Cygames notice transcription](https://umamusume.gg/a-legend-race-is-here-12/). Individual phases split Sep 6 14:59/15:00. Can replace inference note; no need to split existing installed row.
- Uma `seed:uma:story-event-19`: exact Sep 7 22:00 to Sep 19 21:59 UTC confirmed by [Sep 6 notice transcription](https://umamusume.gg/check-out-all-the-latest-updates-3/). Official punctuation: Hark Back, Run Forward. Banner start confirmed here but do NOT infer banner end from story end without its own notice.
- NIKKE `seed:nikke:drake-great-villain-pickup`: existing note calls Drake limited. Same [patch-note transcription](https://nikke.gg/september-3-patch-notes/) explicitly says Drake enters Ordinary Recruit, Social Point Recruit and molds in the following update. Correct limited claim; keep key. Three Sep 3 rows currently open 07:00, but source says after maintenance and schedules maintenance 11:00–18:00 UTC+9. Do not treat scheduled 18:00 as a verified actual finish. Existing 07:00 is contradicted by the announced maintenance; mark as planned after-maintenance time if correcting.
- HSR block title is **To Roll the Stars in Astropolis**, not Nameless Honor. [Publisher update details](https://www.hoyolab.com/article/46449452?reply=1) fetched substantively through web search extraction. Existing Minuscule Great Adventure Sep 12 12:00 server local to Sep 28 03:59 UTC+8 is correct (EU bundled end Sep 27 20:59); AS Aug31–Oct5 and PF Sep14–Oct19 server-local windows are also correct. No new phase-2 warp notice found. Preserve uncertainty for inferred phase-2 boundaries.

## Per-game scope / gaps

- Genshin: targeted official HoYoLAB search surfaced existing 7.0 material, no newly verified in-game window since Sep 2. Do not treat fan-author HoYoLAB articles as publisher notices. No dates changed.
- HSR: publisher update body verified as above. Direct announcement API was blocked by proxy 403; phase-2 standalone notice not found. No new event row required from this source.
- WuWa: official [3.6 notice URL](https://wutheringwaves.kurogames.com/en/main/news/detail/5310) yielded an empty JS page. Discovery found only existing Strings Remember / If Dreams Still Reverberate / Fogveil Pagoda windows. No new first-party window verified; do not promote estimates.
- NTE: official [site](https://nte.perfectworld.com/en/) gave a JS shell. Publisher search found only Aug19 phase-1 and v1.3 update notices. No Sep9 phase-2 article body found. Runaway Echoes/Linko dates are still secondary transcriptions and already exist; no new verified rows.
- Uma Global: original [news](https://umamusume.com/news/) returns 403. Cygames notice transcriptions supply the rows/correction above. Upcoming Transfer Request starts Sep24 22:00 UTC but close is not printed; Dream Team is only end-of-September; half-TP/double-reward URA events have no exact dates. Do not invent windows.
- NIKKE: Sep3 patch notice transcription inspected; it supplies missing Storm Bringer row. Latest Sep4 sanctions and Sep6 MINIKKE media announcements do not add an in-game window. Champion Arena season38 gives only Sep10 opening date and no close, so no fabricated duration.
- Endfield: [official maintenance notice 5209](https://endfield.gryphline.com/en-us/news/5209) confirms already-shipped Sep1 17:00–23:00 UTC-5 / Sep2 06:00–12:00 UTC+8. No newer exact event window found in bounded official search.
- LADS: two new Sep8 windows above are faithful dated publisher reposts. Direct publisher social fetch failed; retain this source distinction.

## Search Summary

- Commands: webcmd --version; webcmd web fetch (DuckDuckGo query, Bing query, HSR announcement API); built-in web search/open/click on sources above.
- Initial fetch failures: DuckDuckGo returned 302 text; Bing returned irrelevant results; HSR API proxy CONNECT returned403. Built-in web search used as fallback.
- Browser fallback: none. No installations or permission changes.
- Additional fetched sources used only for discovery: ntebuild.com/events/runaway-echoes, gamewith.net/nte/77418, gosugamers.net/news/79085-umamusume-pretty-derby-s-september-roadmap-add-yamanin-zephyr-nakayama-festa-and-wonder-acute, gpdsgameshop.com/blog/wuthering-waves-3-6-patch-notes-qingxiao. No candidate timings derive from these editorial sources.
