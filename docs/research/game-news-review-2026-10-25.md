# Game news review — October 25, 2026

This review adds to the [October 17 review](game-news-review-2026-10-17.md). It covers the nine game presets.
The bundle date is `2026-10-25`. The bundle gains 44 records, corrects 11, and drops 56.
Records marked `notify: false` with "Estimated dates." come from press or schedule patterns, not publisher text.

## Removed rows

- 51 rows ended before August 26 and leave under the 60-day retention rule.
- Five aired broadcasts leave so each game keeps one next-patch livestream row:
  Genshin 7.1, Star Rail 4.6, Wuthering Waves 3.7, NTE 1.4, and ZZZ 3.3.

## Duplicate check

- No two rows share a `sourceKey`.
- No two rows share a game, name, and start time.
- A fuzzy pass over overlapping rows found only distinct content: story parts, separate scouts, and consecutive seasons.
- One known overlap remains. The NTE Beyond the Rails seasons from August 13 and August 26 overlap by seven hours.
  This is a time-zone error in one past row. The August 13 row leaves at the next refresh, so it was not changed.

## Changes

| Game                | Source                                                                                                                          | Change                                                                                                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Genshin Impact      | Official announcement API, notices 20508, 21053, 21891, 21908; official news 166991                                             | Exact times for Carefree Snowball Fight and Overflowing Favor. Added Clever Stratagems, the Year in Review web event, the 7.2 Special Program, and the November Abyss.       |
| Genshin Impact      | Press (game8, gamesandchill)                                                                                                    | Added estimated rows for the 7.2 maintenance and the Mitya and Furina phase-one banners.                                                                                     |
| Honkai: Star Rail   | Official announcement API, notice 1360                                                                                          | Added the Mortenax Blade rerun and Reforged in Hellfire, October 21 12:00 – November 10 15:00. Added an estimated 4.7 maintenance and a predicted 4.7 stream.                |
| Zenless Zone Zero   | [Version 3.3 update announcement](https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=4162040&count=30&maxlength=0) | Added eight dated 3.3 events and the 3.4 maintenance start. Added Phoenix, Severian, their W-Engines, and the Velina rerun as estimated banners.                             |
| Wuthering Waves     | Kuro article CDN, article 5668                                                                                                  | Added the Lucilla and Lynae reruns and their weapons, October 22 10:00 – November 11 11:59. Suoming is press-only and estimated.                                             |
| NTE                 | [Publisher Steam news](https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=4508340&count=20&maxlength=0)            | Exact times for Golden Crackshot, Gold Clash (was "Gold Crash"), and Puka Lucky Flip. Added Akane Rin, Far Side of the Moon, the October 21 maintenance, and the 1.5 stream. |
| Umamusume           | Notice API, notices 1067, 1119–1124, 100103                                                                                     | Named the October 20 and 24 scouts. Added the guaranteed New Year scouts, Daily Free 10x Scout, the countdown login bonus, and three bonus Star Piece races.                 |
| NIKKE               | Press (Inven Global, Prydwen)                                                                                                   | Added Marian: Queen and Scarlet: Goddeath for the October 29 anniversary update, estimated.                                                                                  |
| Love and Deepspace  | Press (ldshop.gg)                                                                                                               | Added the Misty Invasion rerun, October 19 – 27, estimated.                                                                                                                  |
| Arknights: Endfield | Official news list                                                                                                              | No posts after October 15. No change.                                                                                                                                        |

## Time rules

- Genshin notices 21891 and 21053 use `t_lc`. The rows copy those server times with no time zone.
- Genshin notice 21908 gives the Year in Review start as October 22 (UTC+8) with no hour. The row starts at 00:00 UTC+8.
- The Genshin 7.2 Special Program aired October 23 at 08:00 UTC-4, which is 12:00 UTC.
- Genshin 7.1 notices end November 4 at 06:00 UTC+8. The 7.2 maintenance row starts there. Its five-hour length is estimated.
- Star Rail notice 1360 tags both Mortenax Blade times `t_lc`. Notice 1437 ends the version November 11 at 06:00 UTC+8.
- ZZZ 3.3 ends December 2 at 06:00 UTC+8. The Severian outfit sale opens November 11 at 12:00 server time.
  The phase-one banners end at 11:59 that day. This end is inferred and the rows keep notify off.
- NTE "after update" means October 21 at 11:00 UTC+8. Gold Clash and Puka Lucky Flip are printed in server time.
- The NTE 1.5 Special Program airs October 28 at 19:30 UTC+8, which is 11:30 UTC.
- Predicted stream windows use the last three offsets before release:
  Star Rail 8–12 days before November 11, ZZZ 12–14 days before December 2, and Wuthering Waves 10–12 days before November 11.

## Remaining gaps

- Genshin: the 7.2 banner notice and event slate. Press sources disagree on Valeriy and on the phase-two start date.
- Star Rail: the 4.7 broadcast date.
- ZZZ: the 3.3 banner notice. Press lists Norma as a phase-two rerun, but only one source names her, so no row was added.
  Shiyu Defense and Deadly Assault windows are still unpublished.
- Wuthering Waves: Suoming's own convene notice and the 3.8 broadcast.
- NIKKE: no publisher source was reachable. nikke-en.com did not resolve and there is no Steam feed.
- Love and Deepspace: the official news page returns 404. The Blade Runner 2049 crossover has no dates yet.
- Umamusume: the October 27 support scout names.
- Endfield: the Seal of Jade end date is still "after three Chartered Headhunting banners".

## Test fixtures

- `event-schedule.test.ts` now mocks two date-only fixtures. The bundle has no date-only rows after the Genshin notices printed hours.
- Broadcast tests now use the Genshin 7.2 and NTE 1.5 streams.
- The dates in `remote-feed.test.ts` move forward one week so its fake feed stays newer than the bundle.
