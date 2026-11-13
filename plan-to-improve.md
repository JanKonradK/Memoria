# Plan to improve Memoria

Reviewed 12 November 2026 against `main` at `8f6eb99` (version 4.0.3, shown in the app as Beta 0.4.0.3). Revised 13 November 2026 with the owner's decisions.

## Verdict

Memoria is a carefully engineered **viewer** for deadlines and a weak **guard** against missing them.
Open the app and it tells you, correctly and per server, what is about to cap or reset. Do not open it and it does almost nothing: reminders are off by default, plan only 24 hours ahead, fire 30 minutes before a deadline, and are silently suppressed between 01:00 and 08:00 with no setting to change that. For a Europe-server player the daily reset is at 03:00 or 04:00, so the reminder for the number 1 goal can never fire.

The second problem is the event calendar. It is researched by hand for nine games, and it lags each version update by days. Today Wuthering Waves has no events at all, Neverness to Everness has none running, and Honkai: Star Rail shows three endgame cycles and no 4.7 banners or events, because those games updated in the last few days. The lag itself is expected for hand-kept data. The fault is that the app does not tell the player this is missing data rather than a quiet week.

The effort has gone to the wrong layer. Signed feeds, encrypted pairing, a QuickJS merge core and a drag-and-drop card layout editor are all built and tested. A notification an hour before reset saying "Genshin and ZZZ still have dailies" is not.

The engineering quality is high. The product priorities are out of order. Most of this plan moves effort from infrastructure to the app's four purposes (see Goals).

## Goals

The app's purpose, in the owner's order:

1. **Not missing dailies.**
2. **Nothing caps.**
3. **Events, and not missing their rewards.**
4. **Extras:** codes to redeem, logins on companion apps, pull planning (enough currency for a good chance at a character), and reminders for battle passes and monthly subscriptions the player chooses to buy.

The rule behind the order is **what is lost first comes first**. Dailies are almost always the nearest loss. After them, events and weeklies swap places depending on the day: an event that ends before the weekly reset outranks the weeklies, and the other way round. The app's urgency ordering and its reminders should follow that rule, not a fixed category order.

**Hassle-free data** is not a fifth goal. It is a condition for all four: every typed value is a chance to give up, and every stale value makes a reminder wrong.

## How this was reviewed

- Read the shared domain code, the app shell and main screens, the Rust desktop program, the Android native code, the build and release workflows, and the design and product documents.
- Ran the app and captured every main screen at 1440×900 and 412×915, dark and light, with the five main games added.
- Measured the production build in Chromium with nine games and CPU throttling (1×, 4×, 6×).
- Checked the bundled feed (`app/src/data/feed/current.json`) and the live published feed against today's date.
- Spot-checked on 13 November: quiet-hours default, 24-hour horizon, `isExactNotification: false`, file provider paths, debug keystore, loopback capability, missing CSP tag, missing release `environment`, chunk budget, feed counts per game and the unused motion exports. All as described.

Not done: nothing was run on a physical Android device or in the packaged `Memoria.exe`. Notification behaviour comes from reading the code, not from watching a phone. The test suite was not run. Throttled Chromium is an approximation of a phone, not a measurement of one. Step 0 closes these gaps before any building starts.

## Ranking criteria

Each item is ranked on four things, in this order:

1. **Goal order** (see Goals).
2. **Reach.** How many of the five main games it helps (Genshin, HSR, ZZZ, WuWa, NTE). The other four games (LADS, Umamusume, NIKKE, Endfield) stay fully supported; they rank lower only because they are not the owner's daily games.
3. **Hassle removed.** Whether it removes taps or typing, or adds them.
4. **Cost and risk.** Effort is S (days), M (one to two weeks) or L (longer). Risk covers trust, data loss and breakage.

## Scorecard

| Goal                         | Grade  | Why                                                                                                                                                                           |
| ---------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Not missing dailies       | D+     | In the app: clear and correct. Outside the app: no reminder reaches a Europe player with default settings.                                                                    |
| 2. Nothing caps              | C+     | Projection, reserve handling and reading age are good. Cap alerts exist but depend on opting in and opening the app daily. A blank reading becomes a confident fake cap time. |
| 3. Events and rewards        | C−     | The model and screens are good. Data lags each version update and the app does not say so. The feed has no reward amounts.                                                    |
| 4a. Codes                    | C−     | Present in Catch up with copy and redeem links. They ship inside app releases, so a 24-hour livestream code needs a new build to reach anyone.                                |
| 4b. Companion logins         | D      | A plain checkbox named "HoYoLAB daily check-in". No link, no reminder of its own.                                                                                             |
| 4c. Pull planning            | B−     | Income ranges and pity maths are honest and well built for four games. No probability answer, no NTE rules, all manual.                                                       |
| 4d. Pass and subscription    | D      | The battle pass appears as a calendar row. Nothing tracks a 30-day pass running out. Reminders are one-off only.                                                              |
| Hassle-free data (all goals) | D      | Every value is typed. Entry is not even minimal: steppers move by 1, and only Umamusume ships a quick-spend button.                                                           |
| Security                     | A− / C | Desktop is far above the norm. Android has several plain gaps.                                                                                                                |
| Design, UX, motion           | C+     | Competent, accessible, generic. Several visible defects on the phone. Navigation has almost no motion.                                                                        |
| Performance                  | B / C+ | Instant on a PC. On a throttled phone a single tick costs 70 to 100 ms of main-thread time.                                                                                   |

## The plan in order

This is the single order of work. Each ID is detailed further down. Milestones group these rows; they do not reorder them.

| #   | ID          | Do                                                                                                          | Goal    | Effort | Milestone |
| --- | ----------- | ----------------------------------------------------------------------------------------------------------- | ------- | ------ | --------- |
| 0   | V           | Verify: run the tests, watch reminders on a real phone and in `Memoria.exe`                                 | —       | S      | 1         |
| 1   | A1          | Reminders that fire: dailies 1 h, events 3 h, weeklies 1 h per game (max 10 h), caps                        | 1, 2, 3 | M–L    | 1         |
| 2   | A2          | Say when a game's calendar is behind its latest version                                                     | 3       | S      | 1         |
| 3   | F1–F6       | Fix the visible defects (title break, fake cap times, row label, leaking game filter, strokes, event order) | all     | S      | 1         |
| 4   | S1–S3       | Android security: release signing key, content policy, file provider paths                                  | trust   | S–M    | 1         |
| 5   | A4          | Faster entry: "spent it all", real quick spends, tick from Today, widget action                             | 1, 2    | S      | 2         |
| 6   | A5          | Capture the play session: prompt when a game closes (PC), notification actions (Android)                    | 1, 2    | M      | 2         |
| 7   | P           | Phone performance: per-game derivation, feed out of startup, images and fonts                               | feel    | M      | 2         |
| 8   | S4–S7       | Remaining security: CI signing job, capability ports, key storage, sync listener                            | trust   | M      | 2         |
| 9   | A3          | Automate the calendar from the publishers' feeds, all nine games, main five first                           | 3       | L      | 3         |
| 10  | A6          | Rewards on events                                                                                           | 3       | M      | 3         |
| 11  | A7, A8, A9  | Codes in the feed, companion check-in links, pass tracker with repeating reminders                          | 4       | M      | 3         |
| 12  | A10         | Pull planning that answers "will I get her", plus NTE rules                                                 | 4       | M      | 4         |
| 13  | T1–T10      | Take away: layout editor, dead code, stale docs, tour, app bar clutter, single-file build                   | upkeep  | M      | 4         |
| 14  | A12, A13, M | All-clear state, normal installer, navigation motion, identity                                              | feel    | M–L    | 4         |
| —   | A11         | Optional account import for the three HoYoverse games. Decide after milestone 3.                            | hassle  | L      | decide    |

---

## Verify first

### V. Confirm what the review only read — effort S

- Run the full test suite and record the baseline.
- On a real Android phone: enable reminders, close the app, and record whether and when they arrive with the screen off overnight. Check behaviour after a reboot and with battery saver on.
- In the packaged `Memoria.exe`: the same with reminders on and the window in the tray.
- Confirm the Europe case: a Genshin Europe account, default settings, no reminder before the 03:00 reset.

A1's design depends on these results. If a phone delivers on time today, A1 is smaller.

---

## Add

Ranked. The bracket is the goal it serves.

### A1. Reminders that actually fire [1, 2, 3] — effort M–L

What exists (`shared/src/notification-plan.ts`, `app/src/notifications.ts`, `desktop/tauri/src/reminders.rs`):

- One notification per game, for its single next action, 30 minutes before it.
- A 24-hour horizon, rebuilt only while the app is open. Miss one day of opening it and the phone goes silent, which is exactly the day you needed it.
- Quiet hours default to 01:00–08:00 (`shared/src/types.ts`), and no screen lets you change them. An action whose reminder lands in quiet hours is skipped, not moved.
- Off by default on both platforms (`reminders_on_pc: false`; Android is opt-in in Settings). Onboarding never offers it.
- Android schedules with `isExactNotification: false` and no `allowWhileIdle`, so a sleeping phone may deliver late. The README admits "Android can delay delivery".

Thirty minutes is too short for dailies: five games of dailies take most of an hour.

Build instead. Every lead time below is the default and can be changed per game.

1. **Dailies: 1 hour before reset.** For each game with dailies not ticked, one notification an hour before that game's daily reset: "Genshin dailies reset in 1 h. 2 of 4 left." Nothing if they are done. This is the most important notification in the app.
2. **Events: 3 hours before an unfinished event ends.** For each event not ticked as done: "Severian — Answers ends in 3 h." Several events of one game ending close together go in one notification.
3. **Weeklies: one hour of lead per game still owing them, up to 10 hours.** Weeklies take longer than dailies, and the more games owe them, the earlier the warning has to come. Count the games whose weekly reset falls in the next 10 hours and whose weeklies are not done. The lead is 1 hour per game: 5 games → 5 hours before the earliest of those resets, 3 games → 3 hours, never more than 10. One notification lists them in reset order: "Weeklies: 3 games, first reset in 3 h (HSR, ZZZ, Genshin)." Because the count changes as you tick things off, the job recomputes the time after every change; finishing a game moves the reminder later, and it is never sent twice. The weeklies reminder never absorbs the dailies one: on a night when both resets coincide, the 1-hour dailies reminder still fires on its own, so falling asleep after the weeklies warning does not cost a game's dailies. A weekly that ends before an event keeps its place ahead of it in the agenda (see Goals).
4. **Caps: with usable lead.** Warn at a threshold set per game (for example 2 hours before cap, or at 80%), not only at T−30 minutes. Ignore estimated readings, as now.
5. **Quiet hours: off by default, the player's choice, and they move reminders, never drop them.** A reminder at 02:00 that gets the dailies done beats sleeping through a reset, so the default is no quiet hours: a Europe player gets the dailies reminder at 02:00, an hour before the 03:00 reset. Players who want silence set quiet hours in Settings or setup. A reminder that falls inside them is sent at the last minute before they start (quiet hours from 01:00 → the 02:00 reminder arrives at 00:59). The current hidden 01:00–08:00 default is removed; existing users who never touched it are migrated to no quiet hours.
6. **Deliver without the app.** Plan seven days ahead. The "only if not done" rule means fixed repeating alarms are not enough, because they cannot see what is ticked. Instead:
   - Android: a periodic native job (WorkManager) that recomputes from the last saved snapshot, the way the widget already does, and schedules the next exact notifications. Use exact, idle-safe alarms where permitted.
   - Windows: the tray process already runs from sign-in; let `reminders.rs` recompute from `state.json` on a timer rather than only when the page pushes a plan.
   - Fallback when the snapshot is older than a day: send the reminder anyway with neutral wording ("Genshin dailies reset in 1 h"). A reminder for done work is a small annoyance; a missing one is the failure this app exists to prevent.
7. **Platform permissions.** Android 13+ needs the `POST_NOTIFICATIONS` prompt. Android 14 denies `SCHEDULE_EXACT_ALARM` by default, so either declare `USE_EXACT_ALARM` (allowed for alarm-like apps, check Play policy if the app is ever published there) or ask for the exact-alarm setting with an explanation. WorkManager runs at most every 15 minutes and later under battery saving; the exact alarms carry the timing, the job only keeps them current. Show reminder health in Settings ("Reminders: on, exact, last planned 10 min ago").
8. **Ask during setup, default on.** After "Create dashboard", one screen: "Remind me before I lose something", with the dailies lead time and an optional "Set quiet hours" (empty by default). On Windows, `reminders_on_pc` defaults to on, matching "start with Windows" and "stay in the tray".
9. **Notification actions.** "Dailies done" and "Open" on the dailies notification; "Done" on an event notification. The common answer needs no app.
10. **Urgency uses quiet hours when they are set.** Urgency colour is driven by raw time left. For a player with quiet hours, "Dailies reset in 9h 30m" shows calm at 17:30 although the real deadline is when quiet hours start. With quiet hours set, amber means "this happens before you are next awake" and the Today agenda leads with a "Before quiet hours" group; without them, urgency stays on raw time left. The sleep window already exists as a setting (`sleepHours`); replace it with the quiet-hours times and apply them to everything, not only energy.
11. **Optional evening digest.** One notification at a chosen time listing what is left across games. Off by default; it complements the per-reset reminders, it does not replace them.
12. **Recurring reminders.** `Reminder` is one-off (`at` only). Add a repeat interval and fold the custom reminders sheet and the automatic notices into one Reminders section (Function, item 11). A9 depends on this.

### A2. Calendar honesty: say when data is behind [3] — effort S

Verified in `current.json` and the published feed (dated 4 November):

| Game                  | Running now                                  | Coming                 |
| --------------------- | -------------------------------------------- | ---------------------- |
| Genshin Impact        | 16                                           | 4                      |
| Honkai: Star Rail     | 3, all endgame cycles; no banners, no events | 1 predicted livestream |
| Zenless Zone Zero     | 8                                            | 4                      |
| Wuthering Waves       | **0**                                        | **0**                  |
| Neverness to Everness | **0**                                        | 1 predicted livestream |

HSR 4.7 went live on 11 November, and WuWa and NTE updated around the same time. A gap of a few days after an update is normal for a hand-kept calendar. Nothing on screen says the calendar is behind.

Add a per-game check: if the feed's last known version boundary has passed, or the game has no banner row running, show "Calendar not updated for version 4.7 yet · feed from 4 Nov" on the game page, the Timeline lane and the Today agenda. The data to do this already exists (version rows, maintenance rows, `remoteFeedVersion`). Applies to all nine games. Until A3 exists, this notice is also the prompt to update the feed.

### A3. Automated calendar, all nine games [3] — effort L

`docs/feed-notes.md` already documents the hard part: where each publisher posts, which times are server-local and which are global, and the traps in each feed. That knowledge lives in prose and in one person's weekend. Turn it into code:

- A scheduled job (GitHub Actions, daily, and more often in the days after a version update) that reads the HoYoverse announcement feeds for Genshin, HSR and ZZZ first, then Kuro (WuWa) and Perfect World (NTE), then the other four games where a reachable source exists. Apply the local-or-global rules per game and write a draft `events.json`.
- Diff against the published feed and **always open a pull request**. The scheduled job never holds the signing key. Signing happens only in the approved release job (S4).
- Keep the existing signing and replay protection. They are already built for this.
- Keep `notify: false` for anything not from an official notice.
- A game with no reachable source stays hand-kept, with A2's notice telling the player when it is behind.

This is the largest item in the plan and the one that decides whether goal 3 is real.

### A4. Faster manual entry [1, 2] — effort S

Entry is declared the hot path in `app/PRODUCT.md`. It is not yet fast:

- The card steppers are −1 and +1. Nobody spends 1 Resin. After a session the true value is usually "nearly zero".
- Only Umamusume has a quick-spend preset (`shared/src/presets.ts`). The five main games have none.
- The reserve stepper also moves by 1, on a 2,400 scale.
- A/S/D/F stepping is keyboard only.
- On a phone, ticking a daily takes: tap the row, wait for the page, tap the task, go back.

Add:

1. **"Spent it all"** on each energy row: sets the value to 0 (or the remainder you type) in one tap. Long-press for "Full".
2. **Preset quick spends** for the five games (Genshin −20, −40, −60; HSR −10, −30, −40; and so on), editable as now.
3. **Tick from Today.** Tapping the dailies ring on a Today row ticks all of that game's check-type dailies, with Undo. `completeDailies` and Undo already exist; they are only reachable inside the game.
4. **Reserve steps of 10 and 100**, or type-only.
5. **Widget actions** on Android: the ring as a "dailies done" button, queued natively and applied when the app next opens. A1's background job reads the queue, so the 1-hour reminder knows.

### A5. Capture the play session [1, 2] — effort M

The best moment to record is the moment you stop playing, and the app is not there.

- **Windows.** `presence.rs` already watches for tracked game processes and shows a notice when one **starts**. Watch for the **exit** as well. When a game that ran for more than a few minutes closes, show a small prompt: energy field focused, "Dailies done" button, dismiss. This is the highest-value hassle reduction available without touching an account.
- **Android.** A post-play notification with actions. Detecting that a game was in the foreground needs the usage-access permission; make it optional. Without it, A1's notification actions cover most of the need.

### A6. Rewards on events [3] — effort M

`docs/redesign-plan.md` lists it as an open point: "The bundled feed has no reward field." Without it, a 40-Primogem web event and a 1,600-Primogem flagship look the same, and part counts are guessed from the event's name.

- Add `reward` (amount of pull currency) and `kind` (login, flagship, web, combat) to feed rows. A3 fills them where the notice states them.
- Sort and emphasise by value and time left. Show the amount on the row and in A1's event reminder.
- On Today: "Ends in 2 days, 420 Primogems unclaimed" rather than a bare name.
- Count a login event's daily claim inside that game's dailies ring while it runs. `dailyTouch` exists for this and currently only adds a pill.

### A7. Codes that arrive in time [4] — effort M

Codes live in `app/src/data/catch-up.ts`, compiled into the app. Livestream codes expire in about a day. A code can only reach a player through a full release and an update.

- Move codes into the signed remote feed.
- A "Codes" line on Today when an unredeemed code exists, with Copy, Redeem (deep link, already built for Genshin) and "Redeemed".
- A notification when a new code arrives, and a second one a few hours before it expires.

### A8. Companion check-ins that open the page [4] — effort S

"HoYoLAB daily check-in" is a checkbox. Give tasks an optional link. Preset the HoYoLAB check-in pages for Genshin, HSR and ZZZ, and SKPORT for Endfield. Tapping the task opens the page; on return, offer "Mark done". On Android this is one tap from A1's dailies notification.

### A9. Pass and subscription tracker [4] — effort S–M

Only for players who buy them; every part is opt-in.

- **Monthly pass.** A "days left" counter per game (Welkin, Express Supply Pass, Inter-Knot Membership, Lunite, and NTE's equivalent once confirmed). The player enters days left once; the app counts down, adds a "claim today" daily while it is active, and reminds three days before it runs out. `PAID_PASSES` in `shared/src/savings.ts` already names each pass except NTE's; only Savings uses it.
- **Battle pass.** The feed already carries a battle pass row for Genshin. Add a reminder a week before it ends ("claim rewards, buy levels if you intend to") and the weekly cap as an optional weekly task.
- Depends on A1.12 (recurring reminders).

### A10. Pull planning that answers the question asked [4] — effort M

The question is whether you will "have a good chance to get that character". The planner answers a different one: how many pulls you will hold by a date, against a target you type.

- Compute the probability of the featured 5★ within N pulls from the current pity, the guarantee flag and the game's curve. `rateAt` and the 50/50 odds are already in `shared/src/pity.ts`. Show "74% to get Furina by the end of her banner at your income; 100% by 2 January".
- Default a goal's target to the worst case for that banner from your pity, instead of a typed 90.
- Add pity rules and passes for NTE. `PITY_RULES` and `PAID_PASSES` cover Genshin, HSR, ZZZ and WuWa only, and NTE is one of the five main games.
- On Windows, offer wish-history import from the game's own history link, the method community pity trackers use. It fills pity and the 5★ log without typing. Read-only, optional, and it expires by itself.

### A11. Optional account import for HoYoverse games [hassle] — effort L, real risk — decide later

Publishers will not hand you data. For three of the five main games the next best thing exists: HoYoLAB's Real-Time Notes, the source the official HoYoLAB widgets use. It reports current Resin, Trailblaze Power and Battery, commissions and daily activity done, expeditions, and weekly boss counts. With it, those three games need no typing and A1's "only if not done" reminders become accurate without a tap.

The data model already expects this: `ObservationProvenance` has `kind: 'account'` and a `provider`.

Be clear about what it costs:

- It is an unofficial use of a site API. It can change or be withdrawn, and it sits in a grey area of the terms of service. It must be opt-in, labelled as such, and the app must stay fully usable without it.
- It needs the player's HoYoLAB sign-in token. That token must never enter `state.json`, backups, shared-folder sync or Wi-Fi sync. Store it with Windows DPAPI and the Android Keystore, per device. S2 and S6 must be closed first.
- `app/PRODUCT.md` currently says "Memoria does not read accounts". This reverses a stated principle. Decide that on purpose.

No equivalent is known for WuWa global or NTE; check before promising one. Decide after milestone 3. It is the biggest single step for hassle-free data, which serves every goal.

### A12. The "all clear" moment [feel] — effort S

When every daily in every game is done and nothing caps before morning, Today looks the same as when nothing is done: the list reorders and a ring shows a tick. The best moment the product has is undesigned. Give it a state: "All clear until 03:00", the next thing due, and the list folded away. Add a weekly line ("7 of 7 days, 0 capped") for people who like a streak. Keep it quiet.

### A13. A normal install [hassle] — effort M

The Windows install is: download a ZIP, extract it, find `Memoria.exe`, then run a `.cmd` file to get shortcuts. `tauri.conf.json` has `bundle.active: false`. An unsigned program from a ZIP also meets SmartScreen. Ship an installer from the Tauri bundler, and consider code signing and a winget entry. On Android, document Obtainium for people who want updates without the in-app installer.

---

## Fix

Visible defects, all milestone 1. Each is detailed under Criticism.

- **F1. The game title breaks inside a word on a phone** ("Honka / i: Star / Rail"). Design, item 1.
- **F2. A blank reading becomes a fake cap time.** Show "—" and "Enter a value" until there is a real reading. Function, item 3.
- **F3. Phone Today rows hide what the countdown is for.** Function, item 4.
- **F4. The game filter follows you.** Opening a game's page sets a "focused game". Timeline then opens filtered to that game, and Settings → Games shows one game with "Showing the focused game. Clear the focus to see all 5." A player who opens HSR and then taps Timeline sees three events and reasonably concludes the rest are gone. Navigation must not set filters. Make the Timeline filter its own choice, default All games, and remove the filter from Settings.
- **F5. Stray diagonal strokes on the phone Timeline.** Design, item 2.
- **F6. Events sit last on the phone game page**, under the notes box. Move them above Catch up and notes. Function, item 9.

Add the two gates from Code health so F1 and A2 cannot regress.

---

## Keep

These are right. Do not let the changes above erode them.

1. **Local-first, no account, no telemetry.** It is the reason to trust the app. Account import, if built, stays optional and per device.
2. **All nine games.** People use the other four, and their presets and calendars stay. Reach (Ranking criteria) decides order of work, not what survives.
3. **Per-game server time.** Each game's own timezone, reset hour, weekly day and monthly day, including the fixed-offset versus daylight-saving distinction (NTE Europe) and Endfield's shared UTC−5 server. This is the hardest thing to get right and it is right.
4. **Editable presets, and the rule for what earns a place in them.** The three tests at the top of `shared/src/presets.ts` are good product thinking. `core` tasks leading the list is correct.
5. **One domain core.** The same TypeScript merge and validation code running in QuickJS inside the Rust program removes a whole class of sync bugs.
6. **The Today concept.** One list ranked by the next deadline, then an agenda across all games. Energy shown with the age of its reading.
7. **Task modes.** Count tasks with sectors and dispatch timers that separate "collected" from "when it returns" are well thought out.
8. **The desktop security work.** Loopback host and origin checks, a per-run token, a hashed script policy, signed updates and feed with replay protection, encrypted pairing with rate limits, launch paths that never come from the page.
9. **Tests and accessibility.** About 95 unit test files, 37 browser specs across eight window sizes, axe checks, real keyboard support, reduced motion honoured.
10. **The motions that give the app character or explain a change.** The coin flip, the strike-through drawn in step with the tick, the burst on the last segment, numbers that count, rows that glide when the order changes, the logo carried into the game page.
11. **Honesty about uncertainty.** `notify: false` for unofficial dates, "Estimated" livestream windows, income shown as a range. Extend this principle to calendars that are behind (A2).
12. **Catch up, Savings and Pity as content.** The research in Catch up and the income model are worth having. They need delivery (feed, not release) and the probability answer.
13. **The Android widget, the tray, game launch, Undo and Activity.**

---

## Take away

Ranked by how much upkeep or confusion each removes. No game and no game's calendar is removed.

### T1. The card layout editor

`GameLayoutCanvas.tsx` (531 lines), `AddGameLayoutItem.tsx` (209), the widget plumbing in `GameCard.tsx`, a synced `cardLayout` field, long-press dragging, keyboard moving, Undo layout and Reset layout. All of it reorders rows inside one game's column. The default order (energy, dailies, cycles, weeklies, events) is already the right one. Replace it with "hide this task" and "reorder" in the task list, which the game editor mostly has. Migrate existing `cardLayout` values to the new hide and order fields so nobody loses a hidden row.

It also gives a game four editing surfaces: Edit → Edit layout, Edit → Manage events, the Game settings sheet with five tabs, and the inline row in Settings → Games. Collapse to two: the sheet for setup, and direct manipulation on the page.

### T2. Dead code and stale documents

- `GameCard` (the exported component at the bottom of `GameCard.tsx`) is imported nowhere; only `GameControls` and `GameControlsView` are. The file is named after something that no longer renders.
- `motion.ts`: `pageEnter`, `fadeDown`, `stageLayout`, `stageSpring` and `stagger` are unused. `cardEnter` is used only by the dead `GameCard` export and animates opacity 1 to opacity 1.
- `index.css` still carries the glass card (`.game-card-surface`, `.card-shell`, `--panel-hi` equal to `--panel-lo`) for cards the design no longer has, and comments about an "attention hub", a "Nexus card" and a "stage".
- `App.tsx` computes a page direction that the CSS ignores (see Motion).
- **README** says Wi-Fi sync "uses HTTP without encryption" and `docs/development.md` repeats it. `docs/publisher-trust.md` says it has been encrypted since Beta 0.4. The README is telling users the app is less safe than it is. Fix in milestone 1.
- README is headed "Version 3.0", describes a "Calendar" tab and a "Tonight summary" that do not exist, and says "Closing the window quits Memoria" while the default is to stay in the tray.
- `app/DESIGN.md` opens with "a softly rounded glass workspace" and then spends most of its length describing flat rows and hairlines. It is a changelog, not a design document. Rewrite it at a quarter of the length.
- The version is 4.0.3 in `package.json`, "Beta 0.4.0.3" in Settings and "Version 3.0" in the README. Pick one scheme.
- Once this plan is agreed, move it to `docs/` and retire the dated notes it supersedes.

### T3. The turning ring and title typefaces in lists — the coin flip stays

The coin flip stays: it is a deliberate touch the owner likes. What changes is around it.

- The logo is a 48 to 60 px coin with the game's full name on two lines inside it. At that size the text is about 6 px tall and cannot be read; the name is printed again beside it. At list size, put a simple mark or monogram in the game's two colours on the coin face, and keep the full lettering for the large coin on the game page. The flip works the same on either face.
- The flip state is remembered and changes the widget's cache key. Check that this is intended and does not cause needless widget redraws.
- The ring on the game page turns forever. Stop the perpetual rotation; let it turn with the flip instead.
- The nine typefaces are free look-alikes of each game's logo. Set large in the game's colour ("Honkai: Star Rail" in pink Zen Dots) they read as a knock-off of the real logo rather than as the game. Use them only in the game page heading, or consider one neutral display face for all headings and let colour do the identifying.

### T4. Refresh, the theme switch and the clock in the app bar

The bar gives permanent, labelled space to Refresh (a local-first app should never need it; sync on focus and pull-to-refresh on the phone), the theme toggle (a once-a-year choice; move to Settings and follow the system by default) and a clock (the system has one). The sync state, which does matter, is a 6 px dot with no label. Reverse that emphasis: show sync in words when it is not healthy, hide it when it is.

### T5. The nine-step tour

Two setup steps are followed by a nine-step guided tour over a dimmed app. Replace it with three hints that appear in place the first time each thing is relevant: enter energy, tick a task, events live here.

### T6. The provenance line above the Timeline

"33 events · Feed published 2026-11-04 · Downloaded 11/12/2026, 5:38:14 PM · Calendar changes 37" takes four lines on a phone before any content. It uses two date formats in one sentence, one of them American with seconds, in a session set to London. Show nothing when the feed is current, and A2's one plain line when it is behind. Put the rest behind the Calendar changes button.

### T7. The single-file HTML build, and the legacy `.woff` files

- `Memoria.html` is a third distribution with its own build mode, checksum, release check and update path, for a version that cannot sync or update itself. The targets are Windows and Android. Drop it, or stop testing and promoting it.
- 25 `.woff` files (402 KB) ship beside their `.woff2` twins (377 KB). WebView2 and the Android WebView both read `.woff2`.

### T8. Full-screen update pages for patch releases

Four releases were tagged on 6 November (4.0.0 to 4.0.3), after two on 5 November. Each one puts a full-screen page in front of every user. Show that page for versions with something to say. For fixes, a quiet badge on Settings and install on next start.

### T9. "Make this network private"

The firewall helper can switch the PC's current network from Public to Private with administrator rights. That changes how Windows treats every program on that network, not only Memoria. A game tracker should not be the thing that does this. Keep the per-program rule; replace the network switch with an explanation and a link to the Windows setting.

### T10. Light italic for data

See Design, item 6. Remove the `.aside` style from anything that is a time, a date or a count.

---

## Criticism in detail

### Function

1. **Reminders do not protect the first goal.** Covered in A1. This is the most serious finding in the review.
2. **The calendar lags each version update and does not say so.** Covered in A2 and A3.
3. **A blank reading becomes a fake fact (F2).** Leave energy blank in setup and the game is created with a starting estimate of 0. Today then shows "0/240 · now" and the agenda lists "Character Pixels caps · 23h 59m · Fri 17:38" as if measured. The onboarding code's own comment says a blank must not let the app "project a confident refill time from a reading the user never gave it". The agenda does exactly that. Reminders correctly ignore estimates; the screen should too.
4. **The phone hides what the countdown means (F3).** Below a certain row width `today.css` hides `.today-row-what`. A phone row reads "Honkai: Star Rail — 9h 30m" with no subject. `app/DESIGN.md` says that label "gives way last" and moves to its own line; the stylesheet removes it.
5. **The same fact appears three times on desktop Today.** The row says "23m · Battery Charge caps", the first agenda line says "Battery Charge caps · 23m · 17:53", and the open card says "full 17:53 · in 23m". Meanwhile nothing on that screen says what to do first across games.
6. **Completed games sink without a group.** When a game's dailies are done its row moves to the bottom because its next deadline is now further away. There is no "Done for today" divider, so the list looks reshuffled rather than progressed.
7. **Duplicates on sync.** `docs/development.md`: "A game added separately on two devices is two games." Onboarding on the phone warns about it, which is an admission. Merge by preset and server when the player confirms.
8. **Sync needs the PC awake and the app open.** A phone-first player has no second-device story at all.
9. **Events sit last on the phone (F6).** The phone game page stacks tracking, last livestream, next livestream, Catch up, a notes box, and then events. The third goal is under a text area.
10. **"Next 48h" is not "today".** The agenda mixes what must happen before quiet hours with what happens the day after tomorrow, in one list sorted by time. It should follow the Goals rule: what is lost first comes first (A1.10).
11. **Reminders exist in two unrelated forms.** One-off custom reminders (a sheet) and automatic deadline notices (a toggle) share a name and nothing else. Neither can repeat. A1.12.

### Design and UI/UX

The interface is clean, consistent and accessible. It is also anonymous: a graphite ground, hairline rules, pill buttons and a floating dock, the default look of current dark dashboards. `index.css` states "This system has no brand accent", and it shows. Most of the character is borrowed from the games, and borrowed imperfectly (T3).

**Visible defects**

1. **The game title breaks inside a word on a phone (F1).** At 412 px the heading reads "Honka / i: Star / Rail". The title, logo, dailies ring and two buttons share one row, and the heading has `overflow-wrap: break-word`. This is the screen a phone user opens most.
2. **Stray diagonal strokes on the phone Timeline (F5).** Short slanted lines appear at the ends of the bars for repeating cycles (Spiral Abyss, Imaginarium Theater). They look like the cycle connectors, and at this size they read as rendering faults.
3. **Game names are cut off in onboarding on a 1440 px screen.** "Neverness to Evern…", "Umamusume: Prett…", "Goddess of Victory…". The grid is capped at about 860 px while half the window is empty.
4. **Event names are cut off beside empty space.** "Cyber Miracle Healer, on …", "Severian — Answers …". The countdown column and tick take fixed space and the name gets the remainder.
5. **Pills are grey on grey.** `--color-tag-event`, `-banner`, `-cycle` and others are defined as distinct hues "so a chip is recognisable before it is read". On screen the EVENT, CYCLE and LIVESTREAM pills are all the same grey. EVENT is printed on nine consecutive rows. A comment in `GameCard.tsx` explains why a repeated WEEKLY pill was removed for exactly this reason.

**Hierarchy**

6. **The quiet voice is given to the important data.** The rule "secondary detail is light italic" has been applied to deadlines: "ends 3d 9h", "Fri 03:00", "Updated just now", "reset 03:00", every Schedule and Time left cell in the Timeline list. Weight 300 italic in mid-grey at 13 px is the least legible style in the system, and it is on the numbers the product exists to show (T10).
7. **The tick is far from its label.** Task rows span the column with the name at the left edge and the circle at the right, 300 to 400 px apart on desktop. The whole row is the button, which is good, but the eye still has to travel. Put the tick first, as every checklist does.
8. **Urgency has two speeds only.** Amber under two hours, red when already full. A cap in 23 minutes and one in 1 h 35 m look identical. Nothing distinguishes "tonight" from "tomorrow" (A1.10).
9. **The Timeline chart says little.** With a one-week-back, three-weeks-ahead window, most events start before it and end after it, so most bars are full width. For Genshin today that is 16 near-identical beige bars. All event kinds share the game's colour, so a banner, a login event and an endgame cycle differ only by a small pill. What ends this week does not stand out. Default the order to "ending soonest", clip long-running rows into a compact group, and colour by kind or by value.
10. **Three primary buttons in one column.** On Pulls each pity card has a white "Got a 5★" button. "Correct" reads as "that is right", not "fix the number". The pity cards are the only bordered cards left in an app that otherwise removed cards.
11. **One orphan colour.** The selected tab is blue (`--nav-ink: #80c3ff`). Nothing else in the chrome is. Either make it the accent and use it for focus and selection, or drop it.

**Flow**

12. **Setup asks the same thing twice.** Step two shows server buttons ("+ Europe"); pressing one adds a row containing a server dropdown already set to Europe. One control is enough.
13. **A disabled primary button as instruction.** "Pick at least one game" is a greyed button. Say it in the text and keep the button enabled with a hint.
14. **Too many ways to edit a game.** See T1.
15. **No moment of completion.** See A12.

**What is good**

Sizes, spacing and alignment are disciplined. Tap targets are 44 px on touch. Light mode is a real theme, not an inversion. Focus rings are visible. The Today list on a phone is compact and scannable. The energy row (name, stepper, bar, verdict, age of reading) is the best-composed part of the app.

### Motion (M)

1. **Page changes have no transition.** `pageEnterForward` and `pageEnterBack` in `index.css` are the same keyframe: opacity 0.88 to 1 over 260 ms, which is not perceptible. `App.tsx` carefully tracks which direction the page is travelling and stores it with the tab; the stylesheet does nothing with it. The comment explains that a JavaScript transition once left the app blank. That justifies a CSS transition, not the absence of one.
2. **Swiping between tabs gives no feedback.** `gestures.ts` detects a sideways drag of 64 px and switches the tab. The page does not follow the finger and does not slide. A gesture with no response until it completes feels like a fault. Either make the page track the drag, or remove the gesture.
3. **Navigation got the least care.** The coin flip is the most elaborate animation in the product, and it stays. Navigation, the thing done hundreds of times a week, has almost none. Give it the same care the flip got.
4. **A perpetual animation on the main page.** The game page ring turns every 24 seconds for as long as the page is open. It pauses when hidden, which is correct, but it is a permanent compositor load on phones for decoration (T3).
5. **Dead motion code.** See T2.
6. **A library for three effects.** `motion` contributes a 61 KB features chunk plus its core for sheets, toasts, one slide-in and the coin flip. Check whether the flip and the sheet drag can share a smaller dependency; the rest is CSS.
7. **Almost no haptics.** `navigator.vibrate` appears once, for Timeline reordering. Ticking a daily on a phone, the most repeated action in the product, has no physical response.
8. **Sheets carry a 24 px backdrop blur while dragged.** See Performance.

Keep the coin flip, tick, strike-through, counting numbers, row reordering and the logo carry.

### Performance (P)

Measured on the production build in Chromium, nine games, a fresh profile, long tasks from `PerformanceObserver`.

| Action                 | PC, no throttle | Phone size, 4× CPU | Phone size, 6× CPU |
| ---------------------- | --------------- | ------------------ | ------------------ |
| First contentful paint | 100 ms          | 516 ms             | 772 ms             |
| Longest task at start  | 55 ms           | 309 ms             | 474 ms             |
| Tick one daily         | none over 50 ms | 71 ms              | 98 ms              |
| Enter an energy value  | none over 50 ms | 60 ms              | 88 ms              |
| Open a game            | none over 50 ms | 138 ms             | 197 ms             |
| Timeline, second visit | none over 50 ms | 187 ms             | 255 ms             |
| Settings, first visit  | none over 50 ms | 284 ms             | 376 ms             |

On a PC the app is instant. On a mid-range phone the two hot-path actions cost 60 to 100 ms each, so a tick lands a visible beat after the tap.

Causes found in the code:

1. **Every change recomputes and re-renders everything.** Components subscribe to the whole document (`useApp((s) => s.state)`), and `useDerived` rebuilds every game's checklist, urgency and projection whenever the document's identity changes. Ticking one task in one game re-derives all nine. Derive per game and subscribe to slices.
2. **The calendar is inside the startup script.** The shared `ui` chunk is 388 KB and contains 348 feed rows; `history` adds 108 KB with 176 more. They are parsed on every start, before first paint. Load the feed as JSON after the first screen is up. Total JavaScript is 1.54 MB uncompressed. This matters more once A3 keeps nine calendars current.
3. **The size budget was raised until it stopped failing.** `scripts/check-pwa.mjs` allows 1 MB per chunk, with a comment that the old 350 KB limit "had been under water for a while". A budget that only moves up is not a budget. Set it on the compressed startup path and hold it.
4. **1.06 MB of livestream artwork is bundled.** Four JPEGs of 150 to 330 KB each, shown as a 96 px thumbnail and a roughly 400 px panel. Convert to WebP or AVIF at display size (about 20 to 40 KB each), or load them from the feed.
5. **Backdrop blur on always-visible surfaces.** The phone dock blurs 24 px with saturation over scrolling content, so it is recomputed on every scroll frame. Sheets do the same while being dragged. On the Galaxy Tab S7+ that `docs/redesign-plan.md` names as the floor, test with the blur replaced by a solid tint.
6. **402 KB of legacy fonts.** See T7.

### Security (S)

**Desktop: strong.** The loopback server checks the Host header, requires a per-run bearer token held only in session storage, and requires same-origin on writes. Scripts are allowed by hash. Static paths are canonicalised. Updates and the feed are Ed25519-signed with a monotonic sequence. Pairing uses X25519 with a pinned fingerprint and XChaCha20-Poly1305, one-time challenges and attempt limits. Launch targets come only from a native file dialog. The elevated firewall script is compiled into the binary. CI actions are pinned by commit. This is better than most commercial desktop apps.

It is also more than this product needed before its reminders worked.

**Findings, most serious first.** S1–S3 are milestone 1; S4–S7 milestone 2.

1. **S1. Release APKs are signed with the Android debug keystore.** `android/app/build.gradle` defaults to `~/.android/debug.keystore`, alias `androiddebugkey`, password `android`, and `docs/development.md` confirms that this is the key on installed devices. That one file signs every debug build of every Android project on the development PC, its password is public knowledge, and a copy sits in a repository secret. Anyone who obtains the file can ship an update that Android will install over Memoria. Create a dedicated release key with a real password and an offline backup. Do it in milestone 1 while the installed base is small: it forces a reinstall, so ship one last debug-signed release that prompts for a backup export first, and make sure restore from that export works.
2. **S2. No content security policy on Android.** The policy is sent as an HTTP header by the Rust server (`server.rs`) and by `_headers` for static hosting. The Capacitor WebView gets neither, and `index.html` has no policy meta tag. Android is the platform where the page can reach the native installer, the file picker and the widget. React escapes text, so the present risk is low, but there is no second line. Add the policy as a meta tag in the native build.
3. **S3. The file provider exposes far more than it needs.** `res/xml/file_paths.xml` shares all of external storage and the whole cache directory. The updater needs one folder. Use `<cache-path name="updates" path="updates/" />`.
4. **S4. Signing secrets live in the job that runs third-party code.** `release.yml` runs `npm ci`, the full test suite and a browser download in the same job that later receives `MEMORIA_SIGNING_KEY` and the keystore. `docs/publisher-trust.md` recommends "a protected environment with manual approval"; the workflow has no `environment`. Build without secrets, then sign and publish in a separate job that requires approval. A3's feed job uses the same approved job.
5. **S5. The Tauri capability trusts every loopback port.** `capabilities/main.json` grants the window's commands (start a program, install an update) to `http://127.0.0.1:*/*`. The app serves from three fixed ports. List those three.
6. **S6. Device keys are stored in plain text.** The phone's X25519 private key is in WebView `localStorage` (`lan-sync.ts`); the PC's is in `%APPDATA%\memoria\devices.json`. Wrap them with the Android Keystore and Windows DPAPI.
7. **S7. The sync listener binds every interface.** `lan.rs` binds `0.0.0.0:17820` and filters by source address. Private ranges also describe hotel, campus and café networks. `100.64.0.0/10` is accepted for Tailscale, but it is carrier-grade NAT space in general, not Tailscale's alone. `/hello` answers anyone in those ranges with the PC's permanent public key, which identifies the machine across networks. Bind to the addresses shown in the pairing code, and accept `100.64/10` only when a Tailscale interface is present.
8. **Cleartext traffic is allowed app-wide on Android.** `usesCleartextTraffic="true"` and `<access origin="*" />` exist so Wi-Fi sync can use HTTP with its own encryption. Any other accidental `http://` request would also be allowed. Acceptable for now; note it, and keep every other request on HTTPS by policy (S2 does this).
9. **Changing the Windows network category.** See T9.
10. **The documentation understates the protection.** See T2. Users are told sync is unencrypted.

If A11 (account import) is built, token storage becomes the most sensitive thing in the app. S2 and S6 must be closed first.

### Windows

- Install is a ZIP and a `.cmd` (A13).
- The game-start notice is good. The game-exit prompt is the missing half (A5).
- PC reminders are off by default while "start with Windows" and "stay in the tray" are on by default. The app is running in the background from sign-in and has been told not to speak (A1.8).
- Desktop Today wastes its width on repetition (Function, item 5). At 1440 px the right pane could be "what to do next across all games" instead of a second copy of one game.
- `main.rs` is 1,301 lines. Split window, tray and commands.

### Android

- It is the desktop web app in a WebView. It works, and the widget is a real native touch. It lacks the things a phone is for: dependable background reminders, notification actions, haptics, the system back gesture with a visual response, a share target for codes.
- The first screen pushes "Connect to PC". A phone-only player is a second-class case (Function, items 7 and 8).
- Reminders are opt-in, buried in Settings, limited to the next 24 hours and tied to opening the app (A1).
- The phone game page breaks its own title and puts events last (F1, F6).
- Hot-path cost on mid-range hardware (P).
- Signing, policy and file-sharing gaps (S1–S3).

### Code health and process

- **Five files over 1,300 lines**: `store.ts` (1,473), `GameCard.tsx` (1,455), `index.css` (1,432), `Timeline.tsx` (1,343), `main.rs` (1,301).
- **Comments narrate history.** Many comments describe a bug that used to exist ("The old row fused them and inverted both…"). That belongs in commit messages. In the file it buries the current intent, and several now describe screens that are gone.
- **Documents multiply.** There are more than twenty dated notes in `docs/`. The three that matter (`README`, `DESIGN`, `PRODUCT`) are the three that are out of date.
- **Tests guard mechanics, not outcomes.** There is a browser matrix of eight sizes, and the phone title still breaks mid-word. There are feed signature checks, and the feed has no rows for two games. Add two cheap gates: a screenshot assertion that no game heading wraps inside a word, and a release check that warns when any game has no running banner or event and fails when one of the five main games has none more than three days after its version boundary.
- **Release pace.** Six releases in two days, all committed straight to `main`. Batch fixes; reserve releases for when something a player will notice has changed.

---

## Milestones

The order is the table in "The plan in order". Milestones group it.

**Milestone 1 — "It reminds me" (about two to three weeks)**

- V verify.
- A1 reminders: dailies 1 h before reset, events 3 h before end, weeklies 1 h per game owing them (up to 10 h), caps, quiet hours off by default and moving rather than dropping, seven-day background plan, permissions, setup prompt, urgency by quiet hours when set.
- A2 calendar-behind notice, all nine games.
- F1–F6 visible fixes. Correct the README security line.
- S1–S3 Android signing key migration, content policy, file provider paths.

**Milestone 2 — "It is quick" (about two weeks)**

- A4 entry: "spent it all", quick spends, tick from Today, widget action.
- A5 game-exit prompt on Windows; notification actions on Android.
- P per-game derivation, feed out of the startup chunk, images and fonts.
- S4–S7 CI signing job, capability ports, key storage, sync listener.

**Milestone 3 — "It knows what is on" (three to four weeks)**

- A3 automated calendar, main five first, then the other four where a source exists.
- A6 reward amounts. A7 codes in the feed. A8 check-in links. A9 pass tracker.

**Milestone 4 — "It looks like something" (ongoing)**

- T1–T10 removals.
- A10 pull probability and NTE rules.
- Identity, navigation motion, the all-clear state (A12), installer (A13).

**Then decide** on A11, account import.

## What success looks like

- A player who does not open the app for three days still gets a notification an hour before each reset for every game whose dailies are not done, and three hours before any unfinished event ends.
- Weeklies are flagged early enough to do them all: one hour of lead per game still owing them, up to 10 hours.
- With default settings a reminder can arrive at any hour. With quiet hours set, no reminder is dropped; it moves to before they start.
- No game ever shows an empty or outdated calendar without saying so, and the five main games have their new version's banners and events within a day of it going live once A3 exists.
- Recording a session takes one tap per game.
- The phone's most-used screen has no visual defect.
- A tick on a mid-range phone responds within one frame or two.
