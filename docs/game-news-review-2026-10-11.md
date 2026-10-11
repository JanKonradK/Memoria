# Game news review — October 11, 2026

This review adds to the [October 3 review](game-news-review-2026-10-03.md). It covers the nine game presets.
The bundle date is `2026-10-11`. The bundle gains 16 events and banners and corrects four records.
A record entered the bundle only after a direct read of the publisher's own text.
Eight Genshin rows ended before August 12. The bundle removes them under its 60-day retention rule.

## Changes

| Game                  | Source                                                                                                                                                                                                                           | Change                                                                                                                                                 |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Genshin Impact        | [Official announcement API](https://sg-hk4e-api.hoyoverse.com/common/hk4e_global/announcement/api/getAnnContent?game=hk4e&game_biz=hk4e_global&lang=en&bundle_id=hk4e_global&platform=pc&region=os_euro&level=60&uid=700000000)  | Added the three second-half wishes, Automatic Artistry, and the Anniversary Memories Album web event. Predictive Victory Dynamics now has exact hours. |
| Honkai: Star Rail     | [Official announcement API](https://sg-hkrpg-api.hoyoverse.com/common/hkrpg_global/announcement/api/getAnnContent?game=hkrpg&game_biz=hkrpg_global&lang=en&bundle_id=hkrpg_global&platform=pc&region=prod_official_eur&level=70) | Added Planar Fissure, October 12 at 04:00 through October 25 at 03:59 server time.                                                                     |
| Zenless Zone Zero     | [Publisher Steam API](https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=4162040&count=30&maxlength=0)                                                                                                              | The 3.3 Special Program aired October 9 at 19:30 UTC+8. The forecast window is now that broadcast.                                                     |
| Neverness to Everness | [September 29 patch notes](https://nte.perfectworld.com/en/article/news/gamenews/20260929/264409.html)                                                                                                                           | Added Blackbird's Invitation, September 30 at 11:00 through November 11 at 05:59 UTC+8.                                                                |
| Umamusume             | Notice 1089 from the [notice API](https://umamusume.com/news/)                                                                                                                                                                   | The October 7 scouts have names: [Heroic Author] Zenno Rob Roy, and the support cards Light Hello and Mayano Top Gun.                                  |

A second pass read more publisher text directly:

- Wuthering Waves: the Kuro article feed has no post about version 3.7 phase-two banners. Its newest article is 5603.
  The 3.7 patch notes give Waking Moon Fishing a window of October 15 at 10:00 through November 1 at 09:59 UTC+8. The bundle adds it.
- NIKKE: the publisher's post gives Belorta: Pumpkin Witch a window of October 8 after maintenance through October 28 at 23:59 UTC+9.
  The bundle adds it. Its opening hour is the planned maintenance finish that nikke.gg reports, not a publisher statement.

- Arknights: Endfield: the developer note states that Sanctuary of Ink launches October 15.
  The publisher's version briefing page lists seven version 1.6 windows through October 31. The bundle adds them.
  Its data gives one clock time for every server for scheduled events, so those rows use server time.
  Rows that open after the update use October 15 at 07:00 UTC+8. No notice gives a maintenance start.
  The four windows that begin November 5 are left for the next review.

## Time rules

- Genshin notices 21888, 21889, and 21890 use `t_lc`. The wishes run October 13 at 18:00 through November 3 at 14:59 server time.
- Genshin notice 21887 uses `t_gl`. Predictive Victory Dynamics runs October 12 at 10:00 through October 20 at 09:59 UTC+8.
  Its result announcement continues through October 23 at 09:59 UTC+8. The record now shows a countdown and can send alerts.
- Genshin notice 21368 uses `t_lc`. Automatic Artistry runs October 10 at 10:00 through October 26 at 03:59 server time.
- Genshin notice 21874 uses `t_gl`. The album web event ends October 18 at 23:59 UTC+8.
- Star Rail notice 1423 uses `t_lc`.
- The ZZZ broadcast keeps a one-hour display window. The publisher did not announce an end time.

## Remaining gaps

The research found these items only on fan sites or without a complete window. The bundle does not include them.

- Genshin: version 7.2 date, the next broadcast, and hours for Carefree Snowball Fight and Overflowing Favor.
- Star Rail: version 4.6 phase-two banner windows, Gift of Odyssey, and Anomaly Arbitration boundaries.
- Zenless Zone Zero: version 3.3 banner windows and the start hour on October 21.
- Wuthering Waves: version 3.7 phase-two banners. The Kuro news pages did not render, so no publisher text was read.
- Neverness to Everness: the October 21 update has a date without an hour.
  Four records with `time TBC` cite only Gematsu: Snap! Golden Crackshot, Puka Lucky Flip, Gold Crash, and Beyond the Rails: Sunset Circle.
  The publisher's patch notes do not mention them. They keep alerts off.
- Love and Deepspace: no publisher source was reachable. The bundle has no record after October 10.
- Umamusume: names for the October 14, 20, 24, and 27 scouts, and ends for New Beginnings Parts 1 and 2.
  Notice 1093 dates Holiday Celebration Part 2 from October 7 at 22:00 UTC. The roadmap dates it from October 8 at 15:00 UTC.
  The record keeps the roadmap window.
- NIKKE: Solo Raid 42, the story event, and the anniversary broadcast time rest on fan sites.
- Arknights: Endfield: no notice gives the October 15 maintenance start.
  Six version 1.5 records keep a placeholder close of October 14 at 17:00.

Redemption codes from fan sites were not added. No publisher post confirmed a code or an expiry.

## Search summary

- Nine research agents ran in parallel, one for each game. They read the bundle and searched the web. They did not edit files.
- Each added or corrected record was then checked against the publisher's raw response: both HoYo announcement feeds, the Steam news API, the NTE article, and the Umamusume notice API.
- Unreachable: X pages (HTTP 402), the Kuro news pages, the Love and Deepspace news page, the NIKKE news site, and Endfield article bodies.
