# Memoria guide

Everything the [README](../README.md) leaves out: setting up games, the daily loop, reminders, backups, syncing devices and updates.

## Add your games

1. Select **Add your first game**, or **+ → Add game**.
2. Pick a game, then your server region, and check the game's settings.
3. Select **Add**.

Ready-made settings exist for Genshin Impact, Honkai: Star Rail, Zenless Zone Zero, Wuthering Waves, Neverness to Everness, Love and Deepspace, Umamusume, Goddess of Victory: NIKKE and Arknights: Endfield. You can add a custom game, or several accounts of one game.
Check the starting values against your game: server regions and patches change them, and every number can be edited.

## Each day

- **Energy:** select the number on a game, type what the game shows, press Enter. Memoria projects it from that reading, so enter it again after you spend or receive energy.
- **Dailies:** tick the circle beside a task when it is done. Resets follow each game's own server time.
- **Back:** Alt+Left, the browser's Back, or the back arrow. An open editor closes first, and Memoria asks before discarding a draft.
- **Tasks:** open a game, select its pencil, then a task to change its cadence, mode or count. **Add item** adds one.
- **Events:** the **Timeline** lists events, banners, resets and livestreams; **List** is the simpler view. **+ → Event** adds one; **Manage events** on a game edits its events.
- **Genshin:** Teyvat events come first, Miliastra Wonderland next, banners last.
- **Pause a game:** pencil → **Pause tracking**. Your progress stays.
- **Theme:** the sun or moon button, or Settings → General for palettes.

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

**Pulls** shows each game's savings and pity, and **Version history**: the free currency every version gave a player who spends nothing, from the first version on, with the limited banners of each phase. Totals are community estimates; each version's notes and sources say where a figure comes from.

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

1. On the PC: **Settings → Connect my phone or tablet**.
2. On the phone: **Settings → Scan PC code**, and point the camera at the code.

If both devices already have games, Memoria asks first: **Use my PC's data**, **Combine both**, or **Cancel and disconnect**.
Without a camera, select **Enter a code instead** on both devices. If Windows Firewall asks, allow Memoria on private networks; if Windows still blocks it, right-click the tray icon → **Allow phone sync through Windows**.

Keep Memoria running on the PC (closing the window leaves it in the tray). Changes merge automatically, and offline changes wait for the next connection. **Pause sync**, **Resume sync** and **Disconnect** keep your data.
The connection is end-to-end encrypted (X25519, XChaCha20-Poly1305); see [publisher-trust.md](publisher-trust.md).

**Away from home:** install [Tailscale](https://tailscale.com) on both devices with the same account. After the next sync at home the phone also syncs over Tailscale.

**Two PCs:** **Settings → Data → Shared-folder sync** keeps one file in a OneDrive, Google Drive or Dropbox folder. **Create sync file…** on the first PC, **Use existing file…** on the other.

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
