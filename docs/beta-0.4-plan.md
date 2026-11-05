# Beta 0.4 plan

Agreed 2026-11-05 between Claude (Opus 5.5) and GPT 6.1 Sol (high), over four rounds. Ships as 4.0.0, shown as Beta 0.4.
A small security hotfix (3.3.2, shown as Beta 0.3.3.2) goes out first.

## First: security hotfix 3.3.2

These fixes are small, independent of the foundations, and should not wait for 0.4.

| Issue                                                                                                                                                                                           | Who can exploit it                                                                    | Fix                                                                                                                    | Size | Files                                                            |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ---- | ---------------------------------------------------------------- |
| **The PC app crashes on startup, every time**, when a game's process name is non-ASCII without `.exe` (for example `游戏`). The suffix check slices by bytes, and release builds abort on panic | A backup file or a paired device; the name is saved and synced, so the crash repeats  | Check the suffix in a way that is safe for Unicode; add test cases                                                     | S    | `desktop/tauri/src/presence.rs:89`                               |
| **"Allow phone sync" asks for admin rights for a script any program can edit.** The script sits in the user-writable install folder and elevates itself                                         | Malware already running as you, which gets admin rights after a normal-looking prompt | Elevate `Memoria.exe` with a fixed subcommand that creates the firewall rule from built-in values, with no script file | M    | `desktop/tauri/src/main.rs:490`, `desktop/Enable-Phone-Sync.ps1` |
| **Phone sync is reachable on public Wi-Fi.** The firewall rule allows the Public profile as well as Private                                                                                     | Anyone on the same café or hotel Wi-Fi                                                | Allow Private by default, with a separate narrow rule for Tailscale; Public only if the user opts in                   | S    | `desktop/Enable-Phone-Sync.ps1:33`                               |
| **Game images can be remote URLs**, which load when a card is viewed and reveal the viewer's IP                                                                                                 | A backup file, a shared-folder file or a paired device                                | Accept only bounded raster `data:` images when importing or syncing; drop remote URLs                                  | S–M  | `shared/src/validation.ts:90`, `GameCard.tsx:1398`               |

## The underlying problem

Memoria does not record what changed, in what order, or who changed it.

- **Order** is decided by each device's wall clock (`updatedAt` in `shared/src/merge.ts:37`). Clock skew needs its own patch (`FUTURE_CLOCK_SKEW_TOLERANCE_MS`).
- **History** does not exist. Restoring a backup merges it, so newer bad edits win (`store.ts:1342`). Even a working restore would be overwritten by the next sync from a phone.
- **Trust** relies on the location a file comes from. Updates come with a checksum from the same release (`update.rs:320`). The event feed is read from the `main` branch (`remote-feed.ts:7`). Phone sync is plain HTTP with a bearer token.

Most items on both earlier lists were symptoms of this problem. They can be fixed with two foundations instead of separate patches.

## Foundation A: changes with order and history

- Every record carries the device that changed it and a hybrid logical clock instead of the wall clock.
- A bounded local journal records each change's before and after, grouped per action. It covers user edits, sync, migrations and feed imports, not only `batch()`.
- Sync checks a protocol version before writing. A device on the old version is told to update. It cannot write.

All platforms share this code (`shared/src/merge.ts`). The Windows app runs it through QuickJS (`desktop/tauri/core-entry.mjs`).

## Foundation B: one source of trust

- One publisher key signs release manifests and `events.json`, with a separate signing context for each. The app has the public key built in and rejects modified or replayed files.
- Pairing creates a key for each device. The QR code carries the PC's certificate fingerprint, so sync moves to pinned HTTPS. Foundation A's protocol gate requires a new pairing anyway, so moving to HTTPS now means users pair only once.

## Beta 0.4 scope, in build order

| #   | Item                                                  | Done when                                                                                                                                                                         | Size | Key files                                                                                                |
| --- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | -------------------------------------------------------------------------------------------------------- |
| 1   | **Release gates** (do first: safety net for the rest) | The browser specs in `app/e2e` (33 files, none run in CI today) plus migration and restore tests block a release, using a fixed clock                                             | M    | `.github/workflows/*`, `app/e2e`, `package.json`                                                         |
| 2   | **Foundation A**                                      | Clock-rollback tests converge; an old-version device cannot write; a crash leaves state and journal consistent                                                                    | L    | `shared/src/{types,validation,merge,migrations}.ts`, `app/src/store.ts`, sync adapters, `core-entry.mjs` |
| 3   | **Restore a checkpoint**                              | Automatic checkpoints before imports, migrations, sync-combine, and once per day. A restore survives a sync from an older device and removes records created after the checkpoint | M    | `store.ts`, `Settings.tsx`                                                                               |
| 4   | **Complete dailies + Undo**                           | One tap marks a game's daily checkboxes (not counters or timers). Undo reverses only that action and keeps later edits                                                            | S    | `store.ts`, `GameCard.tsx` checklist                                                                     |
| 5   | **Foundation B: signing**                             | A modified or replayed feed or update is rejected before use                                                                                                                      | M    | `update.rs`, `remote-feed.ts`, `app-update.ts`, release workflow                                         |
| 6   | **Foundation B: device keys + pinned HTTPS**          | Pairing by QR or code binds the right PC, and sync traffic is encrypted                                                                                                           | M–L  | `desktop/tauri/src/lan.rs`, `app/src/lan-sync.ts`, `shared/src/pairing.ts`                               |
| 7   | **Feed freshness** (small, unrelated)                 | Calendar shows when the feed was published, separately from when it was downloaded                                                                                                | S    | `CalendarFeedStatus.tsx`                                                                                 |

Additions to item 5 and item 6:

- **5, verify updates when they run, not only when they download.** Today the zip checksum is checked once (`update.rs:330`). The installer then runs later from a folder that can be modified (`update.rs:384`, `:400`). Verify the signed payload right before installing, and refuse to update from an elevated process.
- **6, a neighbour can block pairing.** Every `/pair` request uses up one shared budget of 5 per minute before the code is checked (`lan.rs:334`). Add limits for each source and keep room for real pairing attempts.

## New features

These are cheap once the foundations exist, in this order. The first two are committed. The third ships if there is time.

| #   | Feature                                                                                                                                                                                                                                                            | Priority      | Done when                                                                                                                        | Size | Key files                                                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------- | -------------------------------------------------------------------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------ |
| F1  | **Activity**: one list per device of recent changes (edits, sync arrivals, imports, feed updates), grouped by action and labelled with the device that made each change. Each entry has Undo or "Restore this item", including a deleted game with all its records | Must          | Undo keeps later edits; restoring a deleted game brings back its tasks, readings and events; older records show "Unknown device" | M–L  | shared history and merge code, `store.ts`, new Activity screen                             |
| F2  | **Calendar changes**: events that were added, rescheduled or withdrawn since you last looked, from the signed feed. Includes changes not applied because you had edited that event                                                                                 | Should        | Changes stay unread until you confirm them; your own edits are never overwritten                                                 | M    | `app/src/data/seed-events.ts`, `remote-feed.ts`, calendar UI                               |
| F3  | **Reminders on Windows**: the energy-cap and deadline reminders Android already has, shown as Windows notifications from the tray, plus a choice of which device reminds you so the phone and PC don't both alert                                                  | Should, third | Only the chosen device reminds you after a sync; quiet hours, restart and wake from sleep all work                               | M–L  | `shared/src/notification-plan.ts`, Rust scheduler in `desktop/tauri/src/main.rs`, Settings |

F1 also covers items 3 and 4: Activity is the screen where checkpoint restore and Undo live.
F3 needs a scheduler in Rust, because the webview is suspended while hidden. The plan covers only 24 hours (`notification-plan.ts:20`), so it must be rebuilt at startup, on wake and after every change.

## Not in 0.4

- A full replicated change log. It is permanent complexity that a solo project does not need. The journal gives undo and restore without it.
- Code-signing the .exe, broad file splits beyond what these items touch, and dropping the one-file HTML build.

## Decisions for the owner

- **0.3 and 0.4 devices stop syncing until both update.** Update the PC and the phone together. Otherwise a long-lived compatibility bridge is needed.
- **Where the signing key lives.** Sol prefers keeping it out of normal CI credentials. The pragmatic option is a dedicated Actions secret in a protected environment that needs manual approval.
- **One key or two.** One key with separate contexts is simpler. A separate key for each purpose limits the damage if one key leaks.

## Where the reviewers disagreed

- Claude first proposed a full change log. Sol said it was too much, and the plan uses the smaller journal and clock design.
- Sol first deferred LAN encryption. It is now in scope because the protocol gate forces a new pairing anyway.
- Claude claimed the Windows app sends no content security policy. That was wrong: `server.rs:329` sends one.
- **Still open:** elevating `Memoria.exe` instead of a script removes the editable script. Malware running as you could still replace the exe itself, because the install folder is user-writable. Fully preventing that needs a per-machine install in Program Files. Both reviewers agree that is not worth it for 0.4.

## Checked and found safe

- **Game launch:** it only runs the program you picked in the PC's file picker. The choice is stored in `launch-targets.json` and is never synced or imported.
- **Event notes:** they display as plain text. Feed links are bundled with the app, and external links must be HTTPS.
- **Local server:** API calls need a bearer token, writes must come from the app's exact origin, and file serving can't leave its folder.
- **Android:** the widget and FileProvider are not exported, and update APKs stay in private cache.
- **HoYoLAB:** no account cookie or token reader is left in the code.

## Built on branch `beta-0.4` (2026-11-05)

The owner asked for real features instead of the small ones above. Two were built, plus the security hotfix items.

**Security**

- Unicode-safe process names (`presence.rs`), with tests.
- The phone-sync firewall script is compiled into `Memoria.exe` and run elevated from memory. Nothing is read from the install folder.
- Firewall rules: Private networks on the local subnet, and Tailscale's range on any network. Public Wi-Fi is no longer allowed. Existing users must select **Allow phone sync through Windows** again to replace the old rule.
- Game images must be embedded JPEG, PNG, WebP or GIF data. The Windows app's content security policy no longer allows remote images.
- Pairing allows 5 attempts per address per minute and 30 overall, so one device cannot lock others out.
- Signed releases and event feeds use one Ed25519 publisher key with separate contexts and local replay records.
- The updater checks signed Windows files again after the app exits. It holds read locks through installation and refuses elevated updates.
- Phone sync uses X25519 device keys and XChaCha20-Poly1305 encryption. QR and manual pairing bind the PC fingerprint. Previous devices must pair again.
- The release keeps `SHA256SUMS.txt` and the previous asset names for 3.3.1 users. Add `MEMORIA_SIGNING_KEY` to Actions before release.
- Key management and transport details: [Publisher and device trust](publisher-trust.md).

**Events as JSON**

- `app/src/data/feed/current.json` holds the current and upcoming versions. `seed-feed.ts` only loads it.
- `app/src/data/feed/history.json` holds past versions and their events. Only the Pulls tab loads it.
- `npm run feed:archive` moves the events of finished versions into the history file.
- The research comments moved to `docs/feed-notes.md`.

**Pulls tab**

- **Version history:** free pulls per version compared across games, plus a section per game. Each game section shows its currency per version, four summary figures and a table with sources. Totals for 92 versions of Genshin, HSR, ZZZ and WuWa were researched by GPT 6.1 Sol. Gaps are listed in `docs/version-history-2026-11-05.md`. Event and banner counts come from 229 past events recovered from git history.
- **Savings:** for each account, enter a balance and add goals, from upcoming banners or a date of your own. The forecast range comes from the free income of the last six finished versions, scaled by how much free content you do. Goals are reserved in deadline order. The plan is stored as an optional `savings` field on the game record, so it syncs and backs up with the game.

**Pity tracker** (third view in the Pulls tab)

- For Genshin, HSR, ZZZ and WuWa, one panel per banner type. Tap +1 or +10 as you pull. Record each 5★ with the pull it came on and whether the 50/50 was won. Pulls after it in the same ten-pull stay counted.
- Each panel shows pity against hard pity, the soft-pity mark, and the guarantee. It gives pulls to the next featured 5★ at most and typically, plus a chart of where past 5★s landed, the average pity and the 50/50 record.
- The tracker is stored as an optional `pity` field on the game, like `savings`. A banner chosen as a savings goal defaults its target to the guaranteed pulls from the tracker.
- The rules and their sources are in `docs/pity-rules.md`.

**Reminders on Windows** (built by GPT 6.1 Sol, xhigh; item F3)

- `desktop/tauri/src/reminders.rs` runs the same `buildNotificationPlan` as Android through QuickJS and shows Windows toasts, even while the window is hidden in the tray.
- The plan is rebuilt at startup, after every save or sync arrival, on wake or a clock jump, and when its 24 hours run out.
- A reminder never fires twice, including after a restart; fired ids are kept locally for 7 days. Reminders more than 5 minutes late (after sleep) are skipped.
- **Reminders on this PC** is off by default, so phone and PC don't both alert. Turn it on from the tray menu or Settings → On this PC. It is a local preference, not synced.
- QuickJS has no `Intl`, so Rust now supplies real IANA offsets via `jiff`. Game resets and quiet hours on the PC now follow daylight saving. Without this, the new timezone check would have reset every game to UTC on the PC.
- Not yet tested: a live toast on a real Windows desktop, and clicking it.

**Second review (GPT 6.1 Sol, high), all fixed**

- An unknown timezone on a game or in settings made every reset calculation throw on every load. It is now repaired to UTC, and validation rejects it.
- A catch-up key such as `constructor` made every sync throw. Those helpers now use Maps.
- A goal deadline far in the future froze the Savings chart. Deadlines are capped at 2100, and month labels are thinned.
- The savings forecast counted versions still running, such as HSR 4.6 on 2026-11-05. Only versions that have ended count now.
- Feed times with seconds were silently skipped. Both formats are read now.
- Savings found version history only by `presetKey`, so older accounts without one got no forecast. It now matches by preset.

**Known limits**

- HSR has sourced totals for only 6 of 24 versions, so its forecasts rest on few versions.
- NTE, Endfield, NIKKE, Uma and LADS have no version history yet. The savings planner asks for a daily figure for them instead.
- Data is now schema 9 (`savings` and `pity` on games). A 3.3 device refuses a v9 document instead of stripping those fields, so phone and PC must both be on 0.4 to sync.
