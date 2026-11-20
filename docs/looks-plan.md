# Looks, the floating dock and Minimal mode: the plan

Status: built 20 November 2026; see "Where it stands" at the end. Answers are recorded under Answers.

## What was asked

1. The dock, left to right: **Calendar · Games · Today · Notes · Settings**. Today sits in the middle. Games shows the row of game logos; otherwise that row is hidden.
2. The dock **floats** in every look and every theme.
3. All three mocked looks (Instrument panel, Soft HUD, Clean tech) **and more** become choices in Settings, next to the theme, and each one works with every palette (Memoria, Catppuccin, Kanagawa, Rosé Pine, Gruvbox, Tokyo Night), dark and light, and every accent.
4. Every game logo and every drawing is vector, fits the look in use and the feel of its game, and gets better than it is now.
5. **Elaborate / Minimal** in Settings. Minimal shows instead of tells: almost no explanatory text anywhere.
6. Smooth, quick and light everywhere: UI, UX, animation and performance.

## What is true today (checked in the code)

- The rail is `components/shell/AppRail.tsx` + `shell.css`: a column on the left in landscape, a two-row dock fixed to the bottom edge in portrait (games strip on top, then Today · Calendar · Notes · Settings). It is not floating: it touches the screen edges.
- Colour is a token layer: `index.css` holds Memoria's palette, `palettes.ts` writes every other palette onto `<html>` as custom properties, and `index.html`'s pre-paint script repeats it so a reload never flashes. **Form (fonts, radii, rules, meters) has no such layer.** It is spread over Tailwind classes and about 25 CSS files.
- Every meter goes through one primitive, `ReactorTube` in `primitives.tsx` (plus `BankMeter` and the rail's hairlines).
- Game logos are **already vector**: a two-colour ring (`game-logo-ring.ts`) around a coin whose names are outlined paths (`game-logo-art.ts`, built from `docs/logos/*.svg`). Under 44px, which includes every logo in the dock, the coin falls back to **a single letter**. That letter is the weak point.
- The only raster images are the PWA and Android launcher icons, which the platforms require as PNG. They are generated from the vector mark by `app/scripts/gen-icons.mjs`.
- Settings rows take a `hint` (28 call sites, all through `SettingRow`), and pages take a `sub` line (`PageTitle`). Both are single points of control for Minimal.

## Decisions

### 1. Navigation

**Dock (portrait: phones and upright tablets)**

- Five equal places: Calendar · Games · Today · Notes · Settings. Today is the centre and the default page, and it carries the steps-left badge, as now.
- **Games** opens the game shelf: the logo row from the mock-ups, sitting on the dock as one floating object. The shelf rises from behind the place row (transform and opacity only, about 220 ms, ease-out) and closes back into it.
  - It opens when Games is pressed. It stays open while a game's page is showing. It closes when another place is chosen, on a second press of Games, or by swiping it down.
  - Choosing a logo opens that game. The open game keeps the pin in its colour. Add game stays at the shelf's end.
  - While closed, Games shows one dot when any game needs the player within the hour (the same rule as the rail's rose countdown), and its accessible name says how many.
  - With no games yet, Games opens Add game.
- **Floating:** the dock is inset from the screen edges by 10–12px plus the safe area, with fully rounded ends, its own shadow and a surface that differs in each look. Pages pad their end by the dock's height plus a gap. Toasts sit above it. The open shelf covers page content and never pushes it.
- The dock never hides on scroll. Something that moves under the thumb costs a tap.

**Rail (landscape: PCs, tablets on their side)**

- The same order from top to bottom: Calendar, Games, Today, Notes. Below them is the game list, then Settings at the foot.
- Here Games folds the list in and out, and the choice is remembered. It is **open by default**, because on a PC the list with its countdowns is the most useful thing in the rail. (Open question 3.)

**Swipes and keys**

- Swiping between places follows the dock: Calendar ← Games ← Today → Notes → Settings. From Today, a swipe toward Games opens the last game that was open, or the first game if none has been.
- Ctrl+1–9 still open games. Alt+1–5 open the five places.
- The gesture questions asked earlier (swipe between a game's tabs or between games, swipe a step to tick it, vibration) are left for a separate pass and are not decided here.

### 2. The look system (how every look works with every palette)

A look is **form**; a palette is **colour**. They stay independent: 6 palette families × their flavours × dark and light × accents × every look all work, because no look names a colour. A look only mixes palette tokens (`color-mix(in srgb, var(--color-accent) 18%, transparent)` and so on).

- **Store:** `useUI` gains `look: LookId` (default `classic`) and `detail: 'elaborate' | 'minimal'` (default `elaborate`). Both are persisted and pass the whitelist `merge`, and an unknown value falls back to the default.
- **DOM:** `<html data-look="…" data-detail="…">`. The pre-paint script sets both from storage, so a reload never shows the wrong look for one frame.
- **CSS:** one file per look, `src/looks/<id>.css`, whose rules all sit under `[data-look='<id>']`. A selector rather than `:root` lets Settings render a live preview of every look inside its own card, using the real components.
- **The form token layer**, defined once in `index.css` for Classic and overridden per look:
  - Type: `--font-display`, `--font-figure` (big numbers), `--font-label`, `--label-case`, `--label-tracking`, `--figure-weight`.
  - Shape: `--radius-ui-*` (already tokens: 62 call sites follow them for free), `--row-radius`.
  - Surface: `--row-fill`, `--row-edge`, `--section-rule` (solid, dashed, gradient or none), `--ground-pattern` (none, dot grid, aurora).
  - Meter: `--meter-h`, `--meter-radius`, `--meter-mask` (segments), `--meter-fill` (flat, gradient or luminous), `--meter-glow`.
  - Emphasis: `--hot-ring`, `--hot-glow` (only on what is live), `--now-style` (word, dot or pill).
  - Dock: `--dock-fill`, `--dock-blur`, `--dock-edge`, `--dock-radius`, `--dock-shadow`, `--dock-pill` (how the current place is marked).
  - Icons: `--icon-stroke`, `--icon-cap` (round or square).
  - Motion: `--motion-scale` (multiplies `--dur-*`, so Instrument can be crisper and Glass softer, still within limits).
- **Components change once:** `ReactorTube`, `BankMeter`, the rail meters, step and game rows, section headings, `PageTitle`, the "now" marker and the icons read these tokens through stable class names (`meter`, `meter-fill`, `row`, `section-label`, `figure`), instead of hard-coded Tailwind classes for those properties. Classic's values equal what ships today, so the switch to tokens alone changes no pixels. Shots before and after prove it.
- **Fonts load only for the look in use.** Each look's faces are a dynamic `import()` of their `@fontsource` CSS, Latin subset, only the weights used. The pre-paint script adds a `<link rel=preload>` for the current look's main face. Fallbacks use `size-adjust` so a late font never shifts layout. New dependencies: `@fontsource/doto` and `@fontsource/space-mono` (Instrument), `@fontsource/pixelify-sans` (Arcade), `@fontsource-variable/fraunces` or a static Fraunces cut (Paper). Share Tech Mono is already installed.
- **Switching looks** is a token swap with no React re-render, inside `document.startViewTransition` where supported: a 180 ms cross-fade, and an instant change under reduced motion or where it is unsupported.

### 3. The looks

Each look is specified for dark and light. Each is checked at AA against every palette's own surfaces.

| Look                                   | Character                                                                              | Type                                                          | Rows and sections                                           | Meters                                                                   | Live and urgent                             | Dock                                                     |
| -------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------- | -------------------------------------------------------- |
| **Classic** (default, today's Memoria) | Quiet graphite workspace                                                               | DM Sans                                                       | Hairline sections, rows with no fill                        | 4px rounded, game colour                                                 | Amber and rose countdowns                   | Floating, translucent surface, accent pill               |
| **Instrument**                         | Monochrome readout, one red live dot                                                   | Doto for the big figures, Space Mono uppercase tracked labels | Tiles on `surface-1`, dashed section rules                  | 3px hairline in the text colour; the game's colour only on the logo ring | Pulsing-free red dot plus NOW in Doto       | Solid, square-ish ends, inverted pill (text-colour fill) |
| **Soft HUD**                           | Dot-grid ground, glow only on what is live                                             | DM Sans headings, Share Tech Mono figures and labels          | Faint inset edge, sections in the accent with a fading rule | Segmented, in the game's colour, soft glow                               | Urgent row gets a game-colour ring and glow | Translucent and blurred, accent-outlined pill            |
| **Clean**                              | Flat tonal fills, no lines, bold rounded type                                          | DM Sans 800, tight tracking                                   | Filled rows (radius 20), no rules at all                    | 6px pill with a gradient into the game's colour                          | Filled rose "Now" pill                      | Tonal and opaque, inverted pill                          |
| **Glass**                              | Frosted panels over a still aurora made from your first two games' colours             | DM Sans                                                       | Translucent rows with a light top edge                      | Luminous fill                                                            | Soft halo                                   | Strong frost, light edge                                 |
| **Arcade**                             | Chunky game-menu energy, stepped (pixel) corners                                       | Pixelify Sans figures, DM Sans text                           | 2px borders, stepped corners via `clip-path`                | Blocky segments                                                          | Blinking-free inverse block "NOW"           | Bordered, stepped corners                                |
| **Paper**                              | Warm editorial: a cream page in light, warm charcoal in dark                           | Serif headings (Fraunces), DM Sans text                       | Ink rules under sections, no fills                          | 3px ink line with a game-colour end cap                                  | Underlined, italic "now" in rose            | Opaque paper with an ink edge, underline marks the place |
| **Neon**                               | Synthwave: game colours as neon outlines, a still horizon grid behind the Today header | Zen Dots figures (already shipped), DM Sans text              | Outlined rows in the game's colour at low alpha             | Thin outline tube that fills with a neon core                            | The row's outline brightens and glows       | Dark glass, neon underline on the place                  |

In light mode: Instrument becomes black figures on paper, keeping the red dot. HUD's dots and glows become a fine grey grid and tinted soft shadows. Clean becomes tonal greys. Glass becomes frosted white. Arcade keeps its borders in the text colour.

Fixed in every look: the game's colours identify the game (logo, title, meter or lane); amber and rose stay reserved for deadlines and always come with their number; the accent marks only the route, focus and the one primary action. Glow is never animated, and appears on at most the handful of rows that are live now.

### 4. Logos and drawings

- **Everything on screen stays vector.** Logos are already paths. The other drawings (dock and rail icons, the mark, empty-state art and guide miniatures) get audited: anything still a font glyph, emoji or image becomes an inline SVG. The PNG launcher icons stay PNG because Android and the PWA require it, but they are rendered from the vector mark at every density, as now.
- **Small coins show the short name, not a letter (owner's answer: no emblems).** Under 44px a preset coin draws its back face, the outlined short name (ZZZ, NTE, WuWa, HSR, LADS, Uma, NIKKE, Genshin, Endfield), on both sides; a custom game's small coin sets its `short` fitted to the coin instead of its first letter. Large coins are unchanged: full name in front, short name behind.
- **The logo follows the look through CSS only.** Ring colours move from `fill` attributes to `--logo-a` and `--logo-b` variables, so each look restyles every logo with no re-render:
  - Classic: today's two-colour ring.
  - Instrument: a monochrome ring with one tick of game colour.
  - HUD: a ring in the game's colour with a soft glow.
  - Clean: a solid disc in the game's colour, with the lettering in a readable ink and no ring.
  - Glass: a translucent coin with a gradient ring.
  - Arcade: a stepped octagon coin.
  - Paper: an ink ring, one stroke, with the game's colour as a thin inner band.
  - Neon: the ring as two glowing neon strokes in the game's colours.
- **Icons:** the place icons are redrawn as one set on a 20px grid. Their stroke weight and cap come from the look (Instrument 1.5 square, Clean 2 round, HUD 1.5 round), and Calendar, Games, Today, Notes and Settings each get a filled variant for the current place.

### 5. Elaborate and Minimal

Minimal means only values, names, times and controls are visible; anything that explains them is not shown. Nothing is removed for assistive technology: everything hidden stays as accessible names and descriptions, and appears as a tooltip on hover or focus on a PC, or on a long press on touch.

Every visible string is sorted into one of three classes:

1. **Fact:** values, names, times, counts. Shown in both modes.
2. **Label:** text that names something with an obvious icon (the dock places, Play, Edit, Add, view switches). Minimal shows the icon alone.
3. **Explanation:** setting hints, page subtitles, "Updated 13m ago" phrasing, empty-state paragraphs and section descriptions. Minimal does not show it.

Mechanics:

- `SettingRow` `hint` and `PageTitle` `sub` are hidden in Minimal at those two components: that covers 56 call sites.
- A small `<Label icon text>` primitive renders icon and text, or icon alone in Minimal with the text as its accessible name and tooltip. Buttons and switches with an unambiguous icon move to it.
- A `.say` class marks explanatory text in other places. Minimal hides it with `display: none`, and `aria-describedby` still points to it.
- Facts compress: "Updated 13m ago" becomes "13m", "2h 12m" becomes "2h12", and "Weekly Bosses ×3 resets" becomes "Weekly Bosses ×3".
- Empty states become one drawing and one action.
- Errors, data-loss warnings and permission prompts **always** keep their words. Minimal never hides a consequence.
- An e2e check runs every page in Minimal and asserts that every control still has an accessible name and that no `.say` text is visible.

### 6. Settings and first run

- Settings gets a new **Appearance** section, split out of General:
  - **Look:** a grid of cards, each a live miniature (a Today step, a meter, a small dock) rendered with `data-look` on the card, so it uses your real palette, theme and games.
  - **Detail:** Elaborate or Minimal, shown as a before-and-after of the same row.
  - **Theme:** System, Dark or Light.
  - **Palette, flavour and accent:** the existing controls, moved here.
- First run gains one step after picking games: choose a look and a detail level, with the same cards. It can be skipped, and Classic and Elaborate are preselected.

### 7. Motion and performance

- Animate only `transform` and `opacity`. The shelf, the dock pill, look cross-fades and meter fills all qualify. `will-change` is set only while something is moving.
- Blur is used only on the dock, and on sheets in the Glass and HUD looks. Rows never blur. Where `backdrop-filter` is unsupported, the dock falls back to an opaque surface.
- Ground patterns (dot grid, aurora) are a single fixed layer behind the app, built from gradients with no images. The aurora is painted once and never animates. `background-attachment: fixed` is not used, because it makes phones jank.
- Look CSS ships in the main stylesheet: about 2–3 KB each gzipped, which is cheaper than another request. Fonts are split per look. The PWA size budget (`check:pwa`) must pass, and the before-and-after sizes go into the release notes.
- On the tablet, with the APK installed, a Chrome remote-inspector trace confirms the shelf, a page swipe and a look switch hold 60 fps. If blur costs frames on Android, the dock's frost is reduced on that device.
- Reduced motion: the shelf appears and disappears instantly, looks swap without a fade, and nothing loops.

### 8. Accessibility

- AA contrast for every look × palette × theme × accent. `palettes.test.ts` is extended with the look tokens that touch text: HUD labels in the accent, Instrument's muted labels, Clean's text on filled rows, Glass text over the aurora at its worst point.
- Focus stays visible in every look, with an outline shaped by the look.
- 44px touch targets in every look. Arcade's stepped corners are clipped inside the hit area, never from it.
- Colour never carries urgency alone in any look: the number or "Now" is always present.
- Minimal keeps every accessible name (see 5).

### 9. Checks before calling it done

- Unit: store migration and fallback for `look` and `detail`; the shelf's open/close rules; a contrast matrix across all looks; screen-scale unchanged.
- E2E (new): dock order and Today in the centre; Games opens and closes the shelf, a game page keeps it open, and another place closes it; looks persist across a reload with no flash; Minimal hides `.say` text and keeps names; axe runs on Today, a game page and Settings in each look.
- E2E (updated): every spec that clicks rail places or counts dock items (`ui-stability`, `swipe`, `workspace-*`, `mobile-checkin`, `shots`).
- Shots: Today, a game page, Calendar and Settings in every look, dark and light, at phone, tablet and PC. All are reviewed in one batched pass, fixes are made in one batch, and one confirming pass follows.
- `npm run check` passes. The APK is built and installed on the tablet (R52N7186P7T), and the shelf, swipes and look switching are tried there.
- `app/DESIGN.md` gets a Looks section and the new navigation, and `app/PRODUCT.md`'s navigation line is updated.

### 10. Build order

Each step ends with the app working and `npm run check` passing.

1. **Form tokens with Classic.** Pull type, meters, rows, sections, dock and icons onto the token layer. No pixels change, and shots prove it.
2. **Navigation:** the new order, the floating dock in Classic, the Games shelf, the rail's foldable list, swipe order and Alt shortcuts.
3. **Instrument, Soft HUD, Clean:** each dark and light, with logo treatments and fonts.
4. **Glass, Arcade, Paper and Neon.**
5. **Short-name small coins and the icon set.**
6. **Minimal:** the string inventory, `<Label>`, `.say`, compressed facts, empty states.
7. **Appearance in Settings** and the first-run step.
8. **The full check** (section 9), docs, APK on the tablet.

## Answers

1. Extra looks: **Glass, Arcade, Paper and Neon**, all four. Eight looks in total.
2. Emblems: **no**. Small coins switch to the game's short name (ZZZ, NTE, WuWa) at most.
3. PC rail: the game list is **shown by default**, and Games folds it away.

## Where it stands (20 November 2026)

Built and passing `npm run check` and the browser suite, and installed on the tablet:

- The dock order, the floating dock in every look, the Games shelf, the side rail's foldable list, swipe order, and Alt+1 to Alt+5.
- All eight looks, dark and light, with an Appearance section of live preview cards. Each look's stylesheet and faces load only when that look is used or previewed.
- Small coins show the short name zoomed to fill them. The full-name artwork for large coins now loads on demand, which took about 33 KB off the startup path.
- Minimal: setting hints, page subtitles, help paragraphs and the dock and rail names are clipped from the screen but kept for assistive technology.
- Tests: `test/looks.test.ts`, `e2e/looks.spec.ts`, and the `every look` shots (`npm -w app run shots -- -g "every look"`).

Still open:

- Minimal does not yet shorten phrases ("Updated 13m ago" to "13m", "Last synced 5 min ago").
- On a game's page the looks reach the meters, corners, faces and logos, but the task lists and event columns are still mostly Classic.
- The first-run look picker (section 6).
- A 60 fps trace on the tablet (section 7).
- The gesture questions (swiping between a game's tabs, swiping a step to tick it, vibration).

## Round 2: finishing the open items (21 November 2026)

The owner's answers to the gesture questions, and the decision to do every open item now rather than list it.

### Answers

- **Swiping on a game's page** moves between its tabs. Past the last tab it moves to the next game's first tab; before the first tab, to the previous game's last tab. Past the last game it continues to Today and before the first game to Calendar, so the dock order still holds.
- **Vibration: yes.**
- **Swipe a row right to complete it, left to take it back,** on everything that has a done state: Today steps, a game's tasks, a game's events, Calendar's agenda and Soon items, quests and quest parts.
- **Swipe the bar to estimate a reading:** dragging across an energy bar (Original Resin and the like) sets the value.
- **Short phrases keep their meaning:** "Updated 13m ago" becomes a sync mark and "13m"; "just now" becomes the mark and "Now".
- **Accounts of the same game scroll sideways:** when the player has the same game on more than one server or under more than one nickname, the game's page shows those accounts as a sideways strip. With one account there is no strip.

### 1. Haptics (`app/src/haptics.ts`)

- One module and five kinds of feedback: `tick` (a value crossed a step, a swipe armed), `light` (a tap that changed something), `success` (completed), `undo` (taken back) and `edge` (hit the end of a range, or a swipe that cannot go further).
- On Android it uses `@capacitor/haptics`: `selectionChanged` for ticks, light and medium impacts, and notifications for success. In a browser it falls back to `navigator.vibrate` with 8–25 ms pulses. On a PC, and with a mouse, it does nothing.
- A **Vibration** switch in Settings → Appearance, on by default and stored with the other device preferences (`useUI.vibration`).
- The existing `haptic()` calls go through the module, so the switch covers them too.

### 2. Swipe a row (`app/src/swipe-row.tsx`)

- `<SwipeRow as="li|div" right left>` wraps a row. `right` and `left` are actions, each with a label. A row takes only a direction it has an action for.
- Touch and pen only, because a mouse drag selects text. The direction locks after 10 px. Vertical wins and lets the page scroll, while horizontal claims the pointer.
- The row follows the finger 1:1 up to the commit point (35% of its width, at most 112 px), then at a quarter of the speed. A flick faster than 0.6 px/ms with at least 40 px of travel also commits.
- Behind the row a track reveals the action: the game's colour with a check from the left for complete, and the muted fill with an undo arrow from the right for take back. Crossing the commit point scales the icon up and gives one `tick`. Letting go after it runs the action with `success` or `undo`, and the row springs back (transform only, 220 ms).
- A swipe never also clicks: the click after a drag is swallowed. The row carries `data-swipe-row`, which the page swipe ignores, so swiping a row never changes page.
- A swipe the row has nothing for, like completing something already done, is left to the page, so it changes page as usual. A row with both actions (a counted task) keeps both directions.
- Screen readers and keyboards keep the tick buttons, which still exist. The swipe is an extra, never the only way.
- Where it applies:
  - **Today steps:** for a task, right completes it (a counted task gets one more), left takes it back. Events work the same way. Energy steps scrub instead (section 3).
  - **A game's tasks:** check, count and timer rows. For a timer, right means collect and resend.
  - **A game's events:** on the Track tab's list, right means done and left means not started. On the Events tab, right marks done and left restores.
  - **Calendar:** agenda rows and Soon items do the same to every event in the moment.
  - **Quests:** a quest row is all done or cleared, and a part is done or cleared.

### 3. Scrub a bar (`app/src/scrub.ts`)

- On a game's page, dragging across an energy bar sets the value where the finger is (absolute), in whole units. The pill shows the number live, and lifting the finger commits it as a fresh reading, the same as typing it.
- On Today, an energy step's row is the scrubber: dragging sideways moves the value by the row's width for the whole cap (relative), starting from the current value.
- A `tick` sounds every twentieth of the cap (every 10 for Original Resin's 200), and `edge` sounds at 0 and at the cap. A cancelled pointer throws the draft away.
- With a mouse the bar on the game's page can be dragged too. A tap alone never changes the value, so a reading is never set by accident.
- Bars get a taller invisible hit area (44 px) without changing their drawn size.

### 4. Swipes on a game's page

- The App swipe handler asks for the next tab using the same availability rule as the tab strip (`gameTabAvailable`), then moves on to the next or previous game in the player's own order, then to the dock's places.
- Moving to another game keeps the direction: a forward swipe lands on that game's first tab, a backward swipe on its last.

### 5. Accounts strip

- On a game's page, the accounts of the same game (same preset, or the same name for custom games) are shown under the title as a row of chips: the server and, where set, the nickname. It scrolls sideways when it overflows, and the current account is pressed.
- One account means no strip.

### 6. Short phrases (`<Ago>`)

- `<Ago at now verb>`: Elaborate shows "Updated 13m ago" and "Updated just now". Minimal shows a sync mark plus "13m" or "Now". The full phrase is always the accessible name and the tooltip.
- Used for the game page's reading note, Today's reading age, Settings' "Last synced" (PC and devices) and Savings' "entered".
- On the Events tab, Minimal turns "Starts in 2h" into "in 2h" and "Ends in 2h" into "2h". Facts like "full 21:47 · 8h 32m" stay.

### 7. The looks reach a game's task and event lists

- Task rows, event rows, the band rules and the Events tab's rows get the stable classes the looks already style (`row`, `section-label`), so Instrument tiles, HUD inset edges, Clean filled rows, Glass panes, Arcade borders, Paper ink rules and Neon outlines reach them.
- Shots of a game's Track and Events tabs in every look, phone and PC, are reviewed before calling it done.

### 8. Look and detail on first run

- After picking games, onboarding shows one more step: the look cards (the same live miniatures as Settings) and Elaborate or Minimal. Classic and Elaborate are preselected, and Skip keeps them.

### 9. Smoothness on the tablet

- With the APK on the tablet, `dumpsys gfxinfo` is reset, page swipes and scrolling are driven with `adb shell input swipe`, and the frame stats are read back. The janky-frame share goes in this file. If the tablet is locked, that is reported rather than skipped silently.

### Checks

- Unit: the haptics module respects the switch and pointer type; row-swipe and scrub maths (pure functions); `ago` wording in both modes; the next place from a game tab at each end.
- E2E: swipe a Today step right and back; swipe a game's task; scrub the resin bar on a phone; swipe across a game's tabs into the next game; the accounts strip shows only with two accounts; Minimal shows the short age with its accessible name.
- `npm run check`, the browser suite and shots, then the APK on the tablet.

### Where round 2 stands (21 November 2026)

Built, with `npm run check` and the browser suite passing (452 passed):

- Haptics (`haptics.ts`, `@capacitor/haptics`) with a Vibration switch in Appearance on touch screens. Every older tap buzz goes through it.
- Swipe to complete and take back (`swipe-row.tsx`) on Today steps, a game's tasks, its Track event list and Events tab, Calendar agenda rows and Soon items, quest headers and quest parts. The labels are drawn by CSS, so they are never read as row text.
- Bar scrubbing (`scrub.ts`): absolute on a game's energy bar, relative on Today's reading pill.
- A game page swipe walks its tabs, then the next or previous game, then the dock's places. Each tab change slides in from the side it came from.
- The accounts strip on a game's page.
- `<Ago>`: Minimal shows a sync mark with "13m" or "Now". Today's reading age always uses the mark. On the Events tab, Minimal shortens to "in 2h" and "2h".
- The looks reach a game's task rows, event rows and band rules (`look-row`, `look-rule`, `tab-label`).
- First run has a look step between servers and reminders.
- A fix found while testing: the page swipe ignored drags while a tab was sliding in, because the sliding content briefly overflowed. Only real sideways scrollers now hold a swipe back.

Tests: `test/swipe-and-scrub.test.ts` (15) and `e2e/gestures.spec.ts` (5, phone), with the onboarding tests updated for the new step.

#### Smoothness on the tablet (21 November 2026)

On the Galaxy Tab S7+ (120 Hz), with this build installed, four page swipes and four long scrolls on Today were driven over adb. `dumpsys gfxinfo` gave 514 frames, 8 janky (1.6%), 0 missed vsyncs and 0 slow UI-thread frames. Frame time was 11 ms at the median and 15 ms at the 99th percentile, and GPU time 7 ms at the median. The "high input latency" count is what injected adb input always reports, so it says nothing about a real finger.
