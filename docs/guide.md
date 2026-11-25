# Memoria guide

Everything the [README](../README.md) leaves out: setting up games, the daily loop, reminders, backups, syncing devices and updates.

## Add your games

1. Select **Add your first game**, or **+ → Add game**.
2. Pick a game, then your server region, and check the game's settings.
3. Select **Add**.

Ready-made settings exist for Genshin Impact, Honkai: Star Rail, Zenless Zone Zero, Wuthering Waves, Neverness to Everness, Love and Deepspace, Umamusume, Goddess of Victory: NIKKE, Arknights: Endfield and CookieRun: Crumble. You can add a custom game, or several accounts of one game.
Check the starting values against your game: server regions and patches change them, and every number can be edited.

## Each day

- **Energy:** select the number on a game, type what the game shows (or use **Spent all** / **Full** or keys **A −10 · S −1 · D +1 · F +10**), and press **Enter**. On **Today → Steps**, **Enter** moves to the next input (**Shift+Enter** moves back) while **Order paused · Re-sort now** keeps rows from jumping under your cursor. Memoria projects energy forward from each reading.
- **Dailies:** tick the circle beside a task when it is done (or use **Tick all**, with Undo). Resets follow each game's own server time.
- **Shortcuts & Back:** press `?` anywhere outside a field for all shortcuts (`Alt+1..5` switches places; `Ctrl+1..9` opens games; `Shift+S` or `Ctrl+Shift+M` starts a screenshot capture on Windows). Alt+Left, the browser's Back, or the back arrow steps back, and Memoria asks before discarding an unsaved draft.
- **Tasks & Codes:** open a game, select its pencil, then a task to change its cadence, mode or count (**Add item** adds one). Each game's **Codes** tab collects livestream and saved gift codes with one-tap HoYoLAB claiming when linked.
- **Events:** the **Timeline** lists events, banners, resets and livestreams; **Agenda**, **Month** and **Ending soon** show the same schedule in list, calendar and urgency views. **+ → Event** adds one; **Manage events** on a game edits its events.
- **Genshin:** Teyvat events come first, Miliastra Wonderland next, banners last.
- **Pause a game:** pencil → **Pause tracking**. Your progress stays.
- **Theme, Looks, Mark & General:** pick theme, colour palette, look, icon set, game icons, mark finish (colour, shading, tile), app backdrop and detail level under **Settings → Appearance**; change your **Home timezone** and **Vibration** under **Settings → General**.

Dates and clocks use your **Home timezone** from Settings. Bundled event dates can change, so check important deadlines in the game.

## Quests

The **Quests** tab follows each game's story: main-story acts, world-quest series and character stories.

- Press a part once for done, again for partly done, again to clear. **Mark all done** and **Skip** work on the whole quest.
- **Continue** lists quests you have started; **Ready to start** lists quests whose prerequisites you have finished.
- Search by quest, place or character. Select a character to find their other quests.
- Events running now sit at the top, with their parts.
- **Add a quest line** for anything missing. Progress is per account and syncs between devices.

The quest lists come from community wikis and are not complete. Your own quest lines fill the gaps.

## Pulls

**Pulls** shows each game's savings, banner goals and (for Genshin, HSR, ZZZ and WuWa) pity and 5★ log, alongside **Version history**: the free currency every version gave a player who spends nothing, from the first version on, with the limited banners of each phase. Custom games can also use **Savings** to track their currency, pull cost and goals. Totals are community estimates; each version's notes and sources say where a figure comes from.

- **Import UIGF / JSON…** (all platforms): reads UIGF v2–v4 (asking which UID to import when a file holds more than one) or WuWa Tracker JSON files offline.
- **Read from PC game** (Windows): opens your game's local web cache or `Client.log` read-only and imports recent history without your auth URL ever leaving your PC. Open your in-game Wish / Warp / Convene history page once first if the key is missing or expired.

## Live numbers (Connections)

Manual entry stays complete and offline by default. Under **Settings → Connections** you can opt in per device:

- **HoYoLAB & SKPORT live numbers** (Genshin, HSR, ZZZ via HoYoLAB and Arknights: Endfield via SKPORT in the Windows and Android apps): sign in through the isolated webview (reusing a saved session when valid), connect from Chrome, Edge or Firefox via the bundled **Memoria Browser Connect** extension and a one-time 6-character code, or paste a browser session. Credentials are sealed on this device with **Windows DPAPI** or **Android Keystore** and never written to backups, sync or browser storage. Link each role to its tracked game and tap **Refresh** (or turn on **Refresh when a game closes** on Windows) to pull energy, dailies, endgame cycles and check-in state, or claim HoYoLAB daily check-in and gift codes in one tap. If HoYoLAB returns code `10102`, enable **Real-Time Notes** inside HoYoLAB's Battle Chronicle settings; on code `1034`, Memoria backs off automatically and asks you to pass a check in HoYoLAB once.
- **Screenshot reader** (all games): on Windows, press `Ctrl+Shift+M` (or click **Snip** / press `Shift+S`), pick an image, or watch your screenshot folder — drag up to 8 regions on the frozen screen (or press `Enter` for the whole screen) and Windows OCR reads bars, reserves, tasks, endgame cycles and savings together in one pass, or captures extra regions directly into an already-open sheet. On Android, pick an image or share a screenshot directly to Memoria; in a browser, pick a screenshot file and enter values beside the preview. Memoria always asks you to review and **Save** (with one Undo for the whole batch) before recording anything.

## Reminders

The Android and Windows apps plan reminders a week ahead:

- an hour before each daily reset that still has dailies left;
- before the weekly reset, one hour ahead for each game still owing weeklies (up to 10 hours);
- three hours before an unfinished event ends;
- two hours before a freshly read bar caps.

Nothing is sent for work you have ticked off. Turn them on in setup, from the prompt on Today, or in **Settings → Reminders**.

- **Styles:** each kind arrives **Silent**, **Gentle**, **Standard** or **Alarm**. Alarms ring at alarm volume with **Snooze 10 min**; pick their ring under **Alarm ring**. **Test** sends a sample.
- **Your reminders:** **+ → Reminder**, once or on repeat, in any style.
- **Quiet hours** are off by default. When set, a reminder inside them arrives just before they begin.
- **Evening digest:** one optional notification a day with what is still open.
- **Android:** allow **Alarms & reminders** so reminders arrive on the minute, and set Memoria's battery use to **Unrestricted** if reminders come late. Dailies and events notifications have **Dailies done** and **Done** buttons.
- **Windows:** if nothing appears, check that notifications are on for Memoria in Windows settings; Today says so when they are off.

Opening Memoria refreshes the plan. If a phone goes a week without it, one notification says so before reminders run out.

## Backups

**Settings → Data → Export backup** saves a copy of everything. **Import backup** shows a preview, then **Merge backup** combines it with what you have; for the same item the newer change wins.
The Windows app keeps its data in `%APPDATA%\memoria`, outside the program folder.

## Sync a PC and a phone over Wi-Fi

Put both on the same Wi-Fi and open Memoria on both.

1. On the PC: **Settings → Device sync → Connect my phone or tablet**.
2. On the phone: **Settings → Device sync → Scan PC code**, and point the camera at the code.

If both devices already have games, Memoria asks first: **Use my PC's data**, **Combine both**, or **Cancel and disconnect**.
Without a camera, select **Enter a code instead** on both devices. If Windows Firewall asks, allow Memoria on private networks; if Windows still blocks it, right-click the tray icon → **Allow phone sync through Windows**.

Keep Memoria running on the PC (closing the window leaves it in the tray). Changes merge automatically, and offline changes wait for the next connection. **Pause sync**, **Resume sync** and **Disconnect** keep your data.
The connection is end-to-end encrypted (X25519, XChaCha20-Poly1305); see [publisher-trust.md](publisher-trust.md).

**Away from home:** either install [Tailscale](https://tailscale.com) on both devices with the same account, or deploy your own free Cloudflare relay ([relay/README.md](../relay/README.md)) and paste its address under **Settings → Device sync → Sync away from home** — all data remains end-to-end encrypted.

**Two PCs:** **Settings → Device sync → Shared-folder sync** keeps one file in a OneDrive, Google Drive or Dropbox folder. **Create sync file…** on the first PC, **Use existing file…** on the other.

## Updates

Memoria checks GitHub when it opens and twice a day while open, and lists every change since your version.

- **Windows:** **Update** downloads it; **Restart and update** installs it and reopens Memoria.
- **Android:** **Update** downloads the APK and opens Android's installer.
- **Obtainium:** add `https://github.com/JanKonradK/Memoria` as a GitHub source with the APK filter `Memoria-android\.apk`.

Every download is checked against the release's checksums. Updates never touch your data.

## Install details

**Windows:** `Memoria-setup-x64.exe` installs for your user without an administrator prompt, into `%LOCALAPPDATA%\Programs\Memoria`, with Start menu and Desktop shortcuts and an uninstaller in Settings → Apps. Windows may warn that it protected your PC, because the installer is not code-signed yet: **More info → Run anyway**. For a portable copy, extract `Memoria-win-x64.zip` and run `Memoria.exe`.
Press **Alt** for the menu. Closing the window keeps Memoria in the tray so sync and reminders keep working; quit from the tray icon.

**Android:** open `Memoria-android.apk` on the phone (Android 7 or later) and allow installs from that source if asked. Install updates over the existing app; uninstalling deletes the phone's data.
