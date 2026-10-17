# Game news review — October 17, 2026

This review adds to the [October 11 review](game-news-review-2026-10-11.md). It covers the nine game presets.
The bundle date is `2026-10-17`. The bundle gains 23 records and corrects 8.
A record entered the bundle only after a direct read of the publisher's own text.
Four rows ended before August 18 and leave under the 60-day retention rule:
Spiral Abyss July, the Genshin 7.0 maintenance, ZZZ Deadly Assault from July 29, and Extensive Patrol: Triple Bounty.

## Changes

| Game                | Source                                                                                                                                                                                                                           | Change                                                                                                                                                    |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Genshin Impact      | [Official announcement API](https://sg-hk4e-api.hoyoverse.com/common/hk4e_global/announcement/api/getAnnContent?game=hk4e&game_biz=hk4e_global&lang=en&bundle_id=hk4e_global&platform=pc&region=os_euro&level=60&uid=700000000)  | Added Starlight Voyage: Heart Unbound, the October 16 Spiral Abyss, and the November 1 Imaginarium Theater.                                               |
| Honkai: Star Rail   | [Official announcement API](https://sg-hkrpg-api.hoyoverse.com/common/hkrpg_global/announcement/api/getAnnContent?game=hkrpg&game_biz=hkrpg_global&lang=en&bundle_id=hkrpg_global&platform=pc&region=prod_official_eur&level=70) | Added Anomaly Arbitration: Return to Roots for version 4.6.                                                                                               |
| Zenless Zone Zero   | [Publisher Steam API](https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=4162040&count=30&maxlength=0)                                                                                                              | Added the version 3.3 maintenance from the 3.2 end time.                                                                                                  |
| Umamusume           | [Notice API](https://umamusume.com/news/), notices 1043–1125                                                                                                                                                                     | Named the October 14 scouts. Corrected Holiday Celebration Part 2. Added Transfer Requests and six Fall G1 Part 3 mission windows. Named the story event. |
| Arknights: Endfield | [Sanctuary of Ink update notes](https://endfield.gryphline.com/en-us/news/9560) and [pre-download notice](https://endfield.gryphline.com/en-us/news/0744)                                                                        | Corrected three version 1.6 opening times. Added the maintenance and ten version 1.6 banners and events.                                                  |

## Time rules

- Genshin notice 21901 uses `t_lc`. Starlight Voyage runs October 19 at 10:00 through November 2 at 03:59 server time. Quests close October 29 at 04:00.
- Genshin notice 21946 dates the Spiral Abyss season to October 16 and the second Imaginarium Theater season to November 1, with no hour.
  The Abyss row uses the monthly 04:00 reset on the 16th. The Theater row keeps `Estimated dates.` like the earlier Theater rows.
- Star Rail notice 1437 names the Anomaly Arbitration theme but no window. The row follows the version: the reset after the update through 11-11 06:00 UTC+8.
  It keeps notify off.
- ZZZ: the 3.2 notice says the version ends 2026/10/21 06:00 (UTC+8). The maintenance row opens there. The five-hour length is estimated.
- Umamusume notice 1093 starts Holiday Celebration Part 2 on October 7 at 22:00 UTC. The event page stays open through October 24 at 21:59 UTC.
  The row now uses that window. The October 8 15:00 date in the roadmap applied only to the bonus race tickets.
- Endfield notice 9560 gives maintenance as October 14, 17:00–23:00 UTC-5 for Americas/Europe, and October 15, 06:00–12:00 UTC+8 for Asia. Both columns are the same moment.
  Rows that open "after the version update" now start October 14 at 23:00 with `startTimezone: 'UTC-5'`. All servers then open at the same moment.
  The October 11 placeholder of October 15 at 07:00 UTC+8 is gone.
- Endfield rows that run "before the next version update" end November 25 at 17:00 server time.
  The notice prints that close for Sanity Supply on Americas/Europe, as it did for version 1.4. Blazing Stoves already ended there.
- Endfield's six version 1.5 rows that closed October 14 at 17:00 had the right time. They are past and were not changed.

## Remaining gaps

- Genshin: the version 7.2 date and the next Special Program. No publisher text yet. Carefree Snowball Fight and Overflowing Favor keep estimated hours.
- Star Rail: version 4.6 phase-two warps, Gift of Odyssey dates, and the version 4.7 broadcast. Notice 1437 has no warp dates.
- Zenless Zone Zero: version 3.3 banner windows, Shiyu Defense and Deadly Assault after October 20, and the 3.4 broadcast.
- Wuthering Waves: version 3.7 phase-two convenes. Press sites give October 22 for Suoming, but the Kuro article CDN has no convene post yet.
  Its newest article is 5625, a Suoming character post with no dates. Version 3.8 date and broadcast are unknown.
- Neverness to Everness: the October 21 update hour and the second-half banners. The four Gematsu-only rows are still not in publisher text.
- Love and Deepspace: no publisher source was reachable. The news page returns 404 and X returns 402. The bundle still has nothing after October 10.
- Umamusume: names for the October 20, 24, and 27 scouts, and a character scout for October 27. The October 24 scout opens at 06:00, which needs checking.
- NIKKE: the 4th anniversary broadcast, said by a fan site to be October 24, Solo Raid 42, and banners after Belorta.
  nikke-en.com did not resolve, and X syndication answered 429.
- Arknights: Endfield: the Seal of Jade and Moongleam weapon issues end "after three Chartered Headhunting banners". There is no date, so they are not included.

## Search summary

- Nine Haiku research agents ran in parallel, one per game, at low reasoning effort. They read the bundle and searched the web. They did not edit files.
- Each added or corrected record was then checked against the publisher's raw response.
  Sources: both HoYo announcement feeds, the ZZZ Steam news API, the Umamusume notice API (`POST` with `announce_label: 0`), and the Endfield update notes.
- Unreachable: X pages and syndication (402/429), the Love and Deepspace news page, nikke-en.com, and Kuro's rendered news pages.
  The Kuro article JSON CDN was reachable.
- Test fixtures: `seed-events.test.ts` now uses Genshin notice 21901 instead of the dropped 7.0 maintenance.
  The dates in `remote-feed.test.ts` move forward one week so its fake feed stays newer than the bundle.
