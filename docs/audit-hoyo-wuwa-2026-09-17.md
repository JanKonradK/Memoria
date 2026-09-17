# HoYo and WuWa source audit — 17 September 2026

This second audit read current publisher data. It found a confirmed WuWa broadcast, a missing HSR event, and missing Genshin reward windows. This file records findings, not implementation status.

## Wuthering Waves

- **Version 3.7 Preview Special Broadcast:** September 19 at 19:00 UTC+8, or 11:00 UTC / 12:00 BST. Replace the predicted window under `seed:wuwa:3.7-livestream`.
- The [official English YouTube page](https://www.youtube.com/watch?v=nMa_e5ChL6w) confirms the date in its public description. Its public HTML identifies the author as Wuthering Waves and gives `scheduledStartTime: 1789815600` and `startTimestamp: 2026-09-19T11:00:00+00:00`. No end time appears. A display duration must remain an estimate.
- Official artwork: [YouTube thumbnail](https://i.ytimg.com/vi/nMa_e5ChL6w/maxresdefault.jpg?v=6aa3a755). [Official Twitch channel](https://www.twitch.tv/wuthering_waves).
- The [Japanese campaign](https://present.social-camp.com/WW_JP_Official/526508014180) also gives September 19 at 20:00 JST and links the [Japanese broadcast](https://youtube.com/live/NKDIlHEPNYE).
- **Phase 2 banners:** September 10 at 10:00 through September 29 at 11:59, server time. Existing `seed:wuwa:3.6-p2` dates are correct, but its claim that no official notice exists is obsolete. The publisher announced Jingran, Hiyuki, Mornye, Thousandfold Deliverance, Frostburn, and Starfield Calibrator. Add the missing weapon banner window.
- [Publisher notice 5431](https://wutheringwaves.kurogames.com/en/main/news/detail/5431) returns a page shell. [Publisher post transcript](https://www6.twstalker.com/Wuthering_Waves) contains all six banners and their shared window. The [notice transcription](https://wutheringwaves.gg/version-3-6-featured-resonator-weapon-convene-phase-%E2%85%B1/) supplies full Hiyuki/Mornye and weapon rules. The [Thousandfold Deliverance post transcript](https://www6.twstalker.com/Wuthering_Waves/status/2097521626422362484) confirms its exact window separately.
- The publisher's current event notice and social text agree with the existing If Dreams Still Reverberate window. The September 8 event overview and 3.6 patch notice contain the remaining current events. No verified 3.7 maintenance time or code string was found. Do not turn the maintenance estimate into a confirmed date.

## Genshin Impact

Read the complete live [official announcement API](https://sg-hk4e-api.hoyoverse.com/common/hk4e_global/announcement/api/getAnnContent?game=hk4e&game_biz=hk4e_global&lang=en&bundle_id=hk4e_global&platform=pc&region=os_euro&level=60&uid=700000000). Notices 21828–21832 explicitly identify these rows as Miliastra Wonderland:

| Source key                                 | Official evidence                        |
| ------------------------------------------ | ---------------------------------------- |
| `seed:genshin:7.0-event-ode`               | 21828: Manekin Cosmetic Event Ode        |
| `seed:genshin:7.0-miliastra-chronicle`     | 21828: Miliastra Pass                    |
| `seed:genshin:7.0-raiment`                 | 21830: awakened Manekin eligibility      |
| `seed:genshin:7.0-miliastra-play`          | 21832: awakened Manekin eligibility      |
| `seed:genshin:7.0-starlight-voyage-quests` | 21831: awakened Manekin eligibility      |
| `genshin:21831`                            | 21831: same event, later reward deadline |
| `genshin:21829`                            | 21829: Manekin cosmetic and eligibility  |

The other current Genshin rows belong to Teyvat. Forge Realm's Temper is Genius Invokation TCG. Trial of the Bastion requires Teyvat adventure progress. Neither belongs to MW. A shared version broadcast or maintenance is game-wide, so its label must not imply exclusive Teyvat content.

New official notice **21923**, [Version 7.1 Benefits Overview image](https://sdk.hoyoverse.com/upload/ann/2026/09/12/503dbdabd59d6ff5aebd151d5011b7f7_3634289702927936987_transformed.jpg), gives two separate reward windows. Both run from the 7.1 update through November 3, server time:

- Limited 5-star selector: Tartaglia, Nilou, Baizhu, Chiori, Clorinde, or Varesa. Complete the 7.1 Archon Quest.
- Standard 5-star selector: Jean, Diluc, Qiqi, Mona, Tighnari, Keqing, Dehya, or Yumemizuki Mizuki. Log in after the update.

The image gives no exact closing hour. Keep any calendar rows silent and label placeholder hours. It also confirms ten Intertwined Fates, 1,600 mail Primogems, and MW login headwear. It gives no dates for those three rewards. Do not invent their windows.

Existing 7.0 event closes agree with their current API notices. The live feed no longer includes Trial of the Bastion after its end. The 7.1 calendar-only event rows still need exact notices.

## Honkai: Star Rail

The live [official announcement API](https://sg-hkrpg-api.hoyoverse.com/common/hkrpg_global/announcement/api/getAnnContent?game=hkrpg&game_biz=hkrpg_global&lang=en&bundle_id=hkrpg_global&platform=pc&region=prod_official_eur&level=70) now includes **1392: Realm of the Strange**. This event was missing from the previous audit:

- Start: `t_lc 2026/09/19 04:00:00` — server-local time.
- End: `t_gl 2026/09/28 03:59:00` — global UTC+8 time, equivalent to September 27 at 19:59 UTC.
- Reward: double Cavern Relic drops. The reward count does not reset during this event.
- Do not apply one time zone to both boundaries. A mixed-boundary row needs explicit conversion. The previous September 17 date from a secondary guide is wrong.

The API also confirms Planar Fissure and Nameless Honor. The version notice still gives September 28 at 06:00 UTC+8 as the 4.5 end. Keep the known phase-2 banner conflict visible. Gift of Odyssey lacks a distinct end in the fetched version notice. The [4.6 broadcast announcement repost](https://www.reddit.com/r/HonkaiStarRail/comments/1wfz7hq/version_46_dance_with_the_beast_before_moonrise/) confirms September 20 at 19:30 UTC+8 and Pearl's introduction. Existing broadcast dates agree. The [official English broadcast](https://www.youtube.com/watch?v=drFgtruoPe8) now confirms this directly. Public YouTube metadata gives author Honkai: Star Rail, scheduledStartTime 1789903800, and startTimestamp 2026-09-20T11:30:00+00:00. Its description confirms Pearl. [Official thumbnail](https://i.ytimg.com/vi/drFgtruoPe8/maxresdefault.jpg?v=6aa7c612). No end time or code string appears.

## Zenless Zone Zero

Fetched the complete publisher 3.2 update through the [official Steam news API](https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=4162040&count=30&maxlength=0). The [publisher announcement](https://steamcommunity.com/games/4162040/announcements/detail/714537487845820570) and its [readable mirror](https://steamdb.info/patchnotes/24927009/) contain the same dated event list. All eleven version events already have feed rows. No new dated in-game event emerged from this check.

The separate September 14 [Shadow Chase notice](https://zenless.hoyoverse.com/en-us/news/166073), read through its [full transcription](https://zenless.gg/shadow-chase-showdown-event-details/), agrees with September 16 at 10:00 to October 5 at 03:59 server time.

The Steam API also contains the official 3.2 broadcast announcement: August 28 at **19:30 UTC+8**, or **11:30 UTC**. It promises one exclusive code, not three. Thus, the existing forecast rationale that claims Friday 12:30 UTC and three codes is unsupported. Keep the 3.3 broadcast unconfirmed. No direct 3.3 broadcast announcement was found.

## Search summary

- Commands: Webcmd version and direct fetch, web search/open/click, PowerShell public HTTP/API requests, and local image inspection.
- Primary bodies: Genshin and HSR announcement APIs, Genshin benefits image, WuWa YouTube public metadata, ZZZ Steam news API.
- Other bodies: publisher notice transcriptions and linked social mirrors above. Search snippets served only to find these sources.
- Browser fallback: none. Public YouTube HTML supplied data that text extraction omitted.
- Gaps: Kuro/ZZZ website shells, Instagram HTTP 429, guessed ZZZ announcement endpoint HTTP 404, and unavailable exact future schedules noted above. No private account data or login was used.
