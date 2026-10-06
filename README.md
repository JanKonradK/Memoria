# Memoria

**Keep track of your game energy, daily tasks, and events in one place.**

Memoria helps you see what needs attention before you play. It shows when your energy will fill,
when tasks reset, and when events end.

Enter progress manually, import a screenshot, or connect a supported HoYoLAB account in the Windows or Android app.
Memoria does not play games or collect rewards for you.
You do not need a Memoria account or any coding knowledge.

## Version 3.0

- **Flexible layouts** adapt to phone screens, small PC windows, and large displays.
- **Play mode** uses a PC shortcut to capture game readings for later review.
- **Background checks** continue for connected PC accounts while Memoria is minimized or in the system tray.
- **HoYoLAB sign-in** connects supported PC accounts through the official sign-in page.

- **Today** shows approaching energy caps and unfinished routines within your sleep window.
- **Games** keeps the complete game controls, account list, and Tonight summary.
- **Calendar** shows events, banners, resets, and livestreams. Select **Livestreams** for broadcast details.
- **Import readings** accepts game screenshots and supported account data. Review detected values before you apply them.

Each energy estimate shows the source and age of its last reading.
The header status refers to device sync. It does not mean that Memoria just checked your game account.
See [Import game progress](docs/game-imports.md) for supported methods, setup steps, and limits.

## Download and open Memoria

**[Download the latest version](https://github.com/JanKonradK/Memoria/releases/latest)**

### Windows app

1. Open the download page above.
2. Under **Assets**, select **Memoria-win-x64.zip**.
3. Open your Downloads folder.
4. Right-click the ZIP file and select **Extract All**.
5. Open the extracted **Memoria** folder.
6. Double-click **Memoria.exe**.

Memoria opens in its own desktop window. The download includes its own runtime.
You do not need a browser or developer tools.
Press **Alt** to show the desktop menu.
To keep account checks and phone sync active after closing the window, enable **Keep Memoria in the system tray** in **Play mode**.
Select **Quit Memoria** in the tray menu to stop the app.

To install Memoria, close the app and double-click **Add Memoria to Start Menu.cmd**.
The installer copies the app to `%LOCALAPPDATA%\Programs\Memoria` and creates Desktop and Start Menu shortcuts.
Your saved progress and phone connection stay in `%APPDATA%\memoria`.

### Android app

The Android build creates **Memoria-android-debug.apk** for Android 7 or later.
This test package is available from a local build. It is not part of the published GitHub download yet.
See [Build the Android APK](docs/development.md#build-the-android-apk) for the build command.

1. Copy the APK to your phone.
2. Open the APK on your phone.
3. If Android requests permission, permit installation from that file source.
4. Install Memoria.
5. Open Memoria.

The app works offline and stores your data on the phone. Use **Settings → Data → Export backup** to save a separate copy.
Install future updates over the existing app. Uninstalling the app removes its local data.

### Try it as one file

Download **Memoria.html** from the same page. Open the file with **Chrome or Edge**.

This version works offline and saves your progress in that browser. It does not update itself.
Keep the file in the same location, and use the same browser each time.

## Add your games

1. Open Memoria.
2. Select **Add your first game**, or select **+ → Add game**.
3. Select a game from the list.
4. Select your server region and check the game settings.
5. Select the **Add** button to finish.

Ready-made settings are available for:

- Genshin Impact
- Honkai: Star Rail
- Zenless Zone Zero
- Wuthering Waves
- Neverness to Everness
- Love and Deepspace
- Umamusume
- Goddess of Victory: NIKKE
- Arknights: Endfield

You can also add a custom game or separate accounts for the same game.
Check the starting values against your game. Server regions and game updates can change the correct values.

## Use Memoria each day

- **Update your energy.** Select the number on a game card, enter the amount from your game, and press Enter.
- **Mark completed tasks.** Select the circle beside a task after you complete it.
- **Return to the game list.** Press **Alt+Left**, use browser **Back**, or select the back arrow. If an editor is open, Back closes it first. Memoria asks before discarding an unsaved draft.
- **Change daily-task rules.** Open the game, select its pencil button, then select a task. Change its cadence, mode, or count target here. Use **Add item** to add another task.
- **Check deadlines.** Open **Calendar** to see events and their dates. Select **List** for a simpler view.
- **Add an event or reminder.** Select **+**, then **Event** or **Reminder**.
- **Change events for one game.** Open its card, then select **Manage events**. Select an event to change its name, type, dates, or check-in rules. You can also add or delete events here.
- **Read Genshin events.** The card, Timeline lanes, and Manage events show Teyvat events first, Miliastra Wonderland events next, and banners last. Reorder events within each timeline section. Official calendar entries show confirmed date ranges. Events with exact times keep their countdowns.
- **Take a break from a game.** Open its card and select **Pause tracking**. Select **Resume tracking** when you return. Your saved progress and events stay in Memoria.
- **Change game settings.** Select the pencil button, then **Game settings**. You can also change the card layout here.
- **Change the appearance.** Select the sun or moon button for the light or dark theme.

Memoria estimates energy from your last entry. Enter a new value after you spend energy or receive extra energy.
Task resets use each game's server time. Dates and clocks use your **Home timezone** in **Settings**.

Some games include event dates with the app. These dates can change, so check important deadlines in your game.
The Android app can schedule optional phone reminders. Enable **Phone reminders** in **Settings** and allow Android notifications.
The schedule covers the next 24 hours, with custom reminders and one approaching deadline per game.
Quiet hours apply. Android can delay delivery. Open Memoria regularly to update the schedule.

## Keep a backup

A backup is a separate copy of your progress. Keep one before you change computers, browsers, or app versions.

1. Open **Settings**.
2. In **Data**, select **Export backup**.
3. Save the file somewhere you can find it again.

To use a backup, select **Import backup** in the same section.
Select your saved file, check the preview, then select **Merge backup**.
Memoria combines the backup with your current data. For the same item, the newer change wins.

The Windows app also keeps a data file outside the app folder.
The one-file version keeps its data in your browser. Clearing browser data can remove that copy.

## Use your phone and computer

### Sync a PC and Android phone over Wi-Fi

Connect the PC and phone to the same Wi-Fi. Open Memoria on both devices.

1. On the PC, open **Settings** and select **Connect my phone**.
2. On the phone, open **Settings** and tap **Scan PC code**.
3. Point the phone camera at the code on the PC.

Memoria connects the devices and keeps your existing progress. You do not need to type an address or code.
If Android requests camera access, allow it to scan the code. Memoria does not save a photo.

If you cannot use the camera, select **Enter a code instead** on both devices.
Then copy the PC address and pairing code into the phone app.
If the code expires, select **Show a new code** on the PC.
If Windows Firewall requests access, allow Memoria on your private network.
If Windows blocks the connection, press **Alt** and select **Help → Allow phone sync through Windows**.
Approve the Windows permission request to allow phone connections from your local network.

Keep Memoria open on the PC. The phone syncs while its app is open.
Changes from both devices merge automatically. Offline changes stay on each device until the next connection.
For conflicting changes to the same item, the later change wins.

Connection options are below the connection status. You can check the connection or scan a new PC code there.
If you move the PC to another network, scan a new code. Your saved progress stays on both devices.
Use **Pause sync** on the PC to stop sync temporarily. **Resume sync** connects your saved devices again.
Use **Disconnect** on the phone or **Disconnect phone** on the PC to remove a connection.
These actions keep your saved data.

If an older PC launcher remains active after an update, restart Windows and open the updated app.
This starts the new Wi-Fi listener without a change to your saved data.

Wi-Fi sync uses HTTP without encryption. Use a trusted private network.

### Sync computers through a shared folder

This is optional. Use the **Windows app**, **Chrome**, or **Edge**, and a folder that syncs between your computers,
such as a OneDrive, Google Drive, or Dropbox folder.

1. On your first computer, open **Settings → Data → Shared-folder sync**.
2. Select **Create sync file…**.
3. Save the file in your synced folder.
4. Wait for your folder service to copy the file to your other computer.
5. On the other computer, open the same section in Memoria.
6. Select **Use existing file…** and choose that file.

Your folder service transfers the file. Memoria combines the changes when both computers have access to it.
If Memoria asks for permission again, select **Reconnect**.
When you move from a browser to the Windows app, select **Use existing file…** to connect that file again.

If you do not want to use a synced folder, transfer a backup instead.

## Get updates

- **Windows app:** Select **Help → Download updates**. Download and extract the new Windows ZIP. Close Memoria, then run **Add Memoria to Start Menu.cmd** from the new folder.
- **One-file version:** Export a backup first. Download the new **Memoria.html**, then open it with the same browser.
  If your progress is missing, import your backup.

The Windows app keeps your saved data separate from its program files.
This desktop version uses manual updates. It does not replace program files while the app is open.
For the first update from an older launcher, restart Windows if Memoria cannot reconnect to local sync.

## Need help?

**[Report a problem or request a feature](https://github.com/JanKonradK/Memoria/issues)**

Include what you tried, what happened, and whether you use the Windows app or the one-file version.
A screenshot can help. Remove any personal information before you share it.
GitHub requires an account to post an issue.

## For developers

Use Node.js 24.15 or later in version 24, or Node.js 26 or later.
CI uses Node.js 24.21.0.
The app and shared packages use the TypeScript 7.0.2 compiler.
ESLint uses TypeScript 6.0.3 because its current TypeScript parser does not support version 7.
The `xcode` dependency uses `uuid` 11.1.1 to remove a known security defect.

For source code setup, tests, release commands, and technical details, see the [developer guide](docs/development.md).
