# Pity rules

`shared/src/pity.ts` holds one rule per banner type. Checked 2026-11-05 by GPT 6.1 Sol (medium).

Hard pity, base rate and featured odds are the games' published rules. The soft-pity start and the per-pull increase are community-measured. Memoria uses them only for the "about" figures, which the app labels as estimates.

| Game    | Banner                        | Hard | Base | Soft from, +per pull        | Featured when not guaranteed           | Model mean |
| ------- | ----------------------------- | ---: | ---: | --------------------------- | -------------------------------------- | ---------: |
| Genshin | Character event               |   90 | 0.6% | 74, +6pp                    | 55% (Capturing Radiance)               |       62.3 |
| Genshin | Weapon event (chosen weapon)  |   80 | 0.7% | 63, +7pp                    | 37.5%; a Fate Point guarantees it next |       53.3 |
| Genshin | Standard                      |   90 | 0.6% | 74, +6pp                    | none                                   |       62.3 |
| HSR     | Character warp                |   90 | 0.6% | 74, +6pp                    | 50%                                    |       62.3 |
| HSR     | Light cone warp               |   80 | 0.8% | 66, +7pp                    | 75%                                    |       53.4 |
| ZZZ     | Exclusive channel             |   90 | 0.6% | 74, +6pp                    | 50%                                    |       62.3 |
| ZZZ     | W-Engine channel              |   80 |   1% | 65, +6pp (lower confidence) | 75%                                    |       49.9 |
| ZZZ     | Bangboo channel               |   80 |   1% | curve not verified          | always the selected Bangboo            |       49.9 |
| WuWa    | Resonator / weapon / standard |   80 | 0.8% | 66, flat +5pp               | 50% / always / none                    |       53.9 |

Caveats:

- **Capturing Radiance (Genshin):** HoYoverse states 55% consolidated odds. The real mechanism depends on your history, so the 55% is an average, not a fixed per-pull chance.
- **HSR odds:** community models suggest about 56% for characters and 78% for light cones. Memoria uses the published 50% and 75%.
- **WuWa:** the community ramp is uneven: +4pp from pull 66, +8pp from 71 and +10pp from 76. A flat +5pp gives the same average of about 54 pulls.
- **Genshin weapon:** community models reach certainty around pull 77, before the official 80.

Sources:

- Genshin: https://genshin-impact.fandom.com/wiki/Wish and https://genshin.hoyoverse.com/m/en/news/detail/125274
- HSR: https://gachawiki.com/honkai-star-rail/wiki/warps and https://github.com/OneBST/GGanalysis/blob/main/GGanalysis/games/honkai_star_rail/gacha_model.py
- ZZZ: https://www.icy-veins.com/zenless-zone-zero/signal-search and https://github.com/OneBST/GGanalysis/blob/main/GGanalysis/games/zenless_zone_zero/gacha_model.py
- WuWa: https://wutheringwaves.gg/convene-details/ and https://www.wutheringtools.com/convene

## Paid passes in the savings forecast

Turning on a pass in Savings adds its currency to the daily income, outside the free-content share. Values are in `PAID_PASSES` (shared/src/savings.ts):

| Game      | Monthly pass                                            | Battle pass, per version (42 days)                            |
| --------- | ------------------------------------------------------- | ------------------------------------------------------------- |
| Genshin   | Blessing of the Welkin Moon: 90 a day + 300 on purchase | Gnostic Hymn: 680 Primogems + 4 Intertwined Fates             |
| Star Rail | Express Supply Pass: 90 a day + 300 on purchase         | Nameless Glory: 680 Stellar Jade + 4 Star Rail Special Passes |
| ZZZ       | Inter-Knot Membership: 90 a day + 300 on purchase       | New Eridu City Fund: 680 Polychrome                           |
| WuWa      | Lunite Subscription: 90 a day + 300 on purchase         | Insider Channel: 680 Astrite                                  |

Pull tickets count at the game's pull cost. ZZZ and WuWa battle pass tickets are left out until a current source confirms them.
