# Game page and motion review — 20 September 2026

## Change

Opening a game now uses one page on phone, tablet, and PC. The page has one title, one Edit control, and one Back control. Dashboard no longer repeats the game filter. Other pages retain their filter. Back restores the selected card, keyboard focus, document scroll, and desktop roster scroll.

The old phone effect captured and resized the whole card and page through View Transitions. The desktop effect changed card height on every spring frame. Both were replaced with a 200 ms content arrival using opacity and an 18 px horizontal translation. The fixed header and navigation stay still. Reduced motion changes the page immediately. Interrupting an arrival cancels its animation.

## Measurements

Chromium traces used an immutable production build, seven preset games, and CPU throttling. Phone measurements cover three open/back cycles at 412 × 915. PC measurements cover two cycles at 1280 × 900. These are controlled browser measurements, not physical-phone FPS guarantees. No concurrent browser suite ran during the final traces.

| Measurement                                   | Previous build | Revised build |
| --------------------------------------------- | -------------: | ------------: |
| Phone, 4× CPU: layout operations              |            212 |            32 |
| Phone, 4× CPU: paint operations               |            370 |            51 |
| Phone, 4× CPU: worst sampled frame gap        |         100 ms |         50 ms |
| PC, 4× CPU: layout operations                 |            138 |            17 |
| PC, 4× CPU: paint time across measured cycles |         680 ms |        171 ms |

The revised phone run at normal CPU speed had a maximum sampled gap of 16.8 ms and no sampled gaps over 25 ms. The throttled run still had a 58 ms long task on its first return. The PC run still had first-visit work of up to 70 ms under throttling; later visits improved. These limits remain visible in the trace rather than being described as perfect smoothness.

Removing blur alone did not remove the old phone gaps. A desktop clip prototype cut layout work but left paint time near 680 ms, so it was not shipped. The final change removes the costly transition path rather than adding more effects.

The connected S23 graphics counters were inspected before the update, but they cover a long session, not a controlled action. They were not used for the before/after comparison. Native screen control is unavailable in this session.

Trace files and sample summaries remain in the ignored `app/test-results-motion-profile/` folder: `summary-main.json`, `summary-after.json`, `desktop-summary.json`, and `summary-desktop-after.json`. The release check and browser results are reported separately after validation.

## Validation

The eight-size browser matrix passed 104 applicable checks; 104 platform-specific combinations were skipped. This covers open/back navigation, scroll and focus restoration, quick reversal, reduced motion, touch input, layout editing, backup import/export, and accessibility. The complete project check passed before packaging.

The release test found a separate draft bug: an untouched local title could overwrite an incoming sync title when the game page unmounted. The draft handler now commits only fields changed by the user. Two regression cases cover an untouched page closing and a local nickname change alongside a remote title change.

## Readability update — 21 September 2026

The shared scale now uses 16 px body text and 14 px metadata on PC. Phones use 17 px body text and 15 px metadata. Labels use 13 px on PC and 14 px on phones; captions and phone navigation use 13 px. Resource names now use body text in their original case. The game-page heading starts at 22 px. Desktop summary cards have more height, and timeline month labels follow the full caption line height. User display settings remain unchanged.

The typography screen-size run passed 85 applicable browser checks across eight viewports (51 platform-specific skips). A final run after the resource and ruler changes passed 23 applicable checks (41 skips). The complete project check passed with 533 unit tests. Release checks passed for the Windows package and single-file build. Screenshots were inspected at normal 320 px and 412 px phone widths and on the PC.

The signed debug APK was installed on the connected S23. PC and phone loaded the same final JavaScript asset, retained seven games, and both reported Synced. The phone reported 501 CSS px for both its viewport and document width, with no alert errors. Its CSS scale uses the new 17 px body and 15 px metadata values independently of that wider effective viewport.
