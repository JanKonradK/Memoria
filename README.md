# Memoria

**Keep track of your game energy, daily tasks, and events in one place.**

Memoria helps you see what needs attention before you play. It shows when your energy will fill,
when tasks reset, and when events end.

You enter your progress yourself, in a tap or two per game.
Memoria does not play games or collect rewards for you.
You do not need a Memoria account or any coding knowledge.

## Version 3.0

- **Flexible layouts** adapt to phone screens, small PC windows, and large displays.
- **Today** shows approaching energy caps and unfinished routines within your sleep window, then the Tonight summary across every game. Select a game for its complete controls.
- **Calendar** shows events, banners, resets, and livestreams. Select **Livestreams** for broadcast details.
- **Launch** starts a game from its card in the Windows app. Select the pencil button on the card to choose what it starts.

Each energy estimate shows how long ago you entered its value.
The header status refers to device sync. Memoria never reads your game account.

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
Phone sync is available while the window is open. Closing the window quits Memoria.

To install Memoria, close the app and double-click **Add Memoria to Start Menu.cmd**.
The installer copies the app to `%LOCALAPPDATA%\Programs\Memoria` and creates Desktop and Start Menu shortcuts.
Your saved progress and phone connection stay in `%APPDATA%\memoria`.

### Android app

Download **Memoria-android.apk** from the [latest release](https://github.com/JanKonradK/Memoria/releases/latest). It runs on Android 7 or later.

1. Copy the APK to your phone.
2. Open the APK on your phone.
3. If Android requests permission, permit installation from that file source.
4. Install Memoria.
5. Open Memoria.

The app works offline and stores your data on the phone. Use **Settings → Data → Export backup** to save a separate copy.
Memoria updates itself from **Settings → Updates**. Uninstalling the app removes its local data.

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
- **Take a break from a game.** Open its card, select the pencil button, then **Pause tracking**. Select **Resume tracking** on the card when you return. Your saved progress and events stay in Memoria.
- **Change game settings.** Select the pencil button, then **Game settings**. You can also change the card layout here.
- **Change the appearance.** Select the sun or moon button for the light or dark theme.

Memoria estimates energy from your last entry. Enter a new value after you spend energy or receive extra energy.
Task resets use each game's server time. Dates and clocks use your **Home timezone** in **Settings**.

Some games include event dates with the app. These dates can change, so check important deadlines in your game.
The Android app can schedule optional reminders. Enable **Reminders on this device** in **Settings** and allow Android notifications.
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

### Sync a PC and an Android phone or tablet over Wi-Fi

Connect the PC and phone to the same Wi-Fi. Open Memoria on both devices.

1. On the PC, open **Settings** and select **Connect my phone or tablet**.
2. On the phone, open **Settings** and tap **Scan PC code**.
3. Point the phone camera at the code on the PC.

Memoria connects the devices. You do not need to type an address or code.
If the phone or tablet and the PC both already have games, it asks before it syncs.
Select **Use my PC's data** for a new phone or tablet. Select **Combine both** to keep every game from both devices.
Select **Cancel and disconnect** to change nothing.
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
Use **Disconnect** on the phone or **Disconnect device** on the PC to remove a connection.
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

Memoria checks GitHub for a new release when it opens, and twice a day while it stays open.
When one is available, a notice appears. Select **View update** to read what changed.
You can also open **Settings → Updates** and select **Check for updates**, or turn automatic checks off there.

- **Windows app:** Select **Download update**, then **Restart and update**. Memoria saves, closes, installs the new version and opens again. **Help → Check for updates** opens the same section.
- **Android app:** Select **Download and install**, then confirm in Android's installer. The first time, Android asks you to allow Memoria to install apps.
- **One-file version:** Select **Open download page**. Export a backup first, then open the new **Memoria.html** with the same browser.
  If your progress is missing, import your backup.

Every download is checked against the release's checksums before it is installed. Your saved data is never touched by an update.
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
