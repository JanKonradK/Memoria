# Import game progress

Memoria 3.0 supports manual entry, screenshot import, game-window capture, and supported account connections.
All methods use the same resource and task controls.
An energy estimate is a calculation from the last reading, not a live measurement from the game.

## Select a method

| Method             | Available on                | Coverage                                                                        |
| ------------------ | --------------------------- | ------------------------------------------------------------------------------- |
| Manual entry       | All versions                | All resources and tasks                                                         |
| Screenshot text    | All versions                | Recognized resource names and values for the selected game                      |
| Image recognition  | Windows app and Android app | Text visible in a selected screenshot                                           |
| Capture shortcut   | Standalone Windows app      | Text visible in the selected game window                                        |
| HoYoLAB connection | Windows and Android apps    | Supported readings for Genshin Impact, Honkai: Star Rail, and Zenless Zone Zero |

Account connections require an active HoYoLAB session and access to Real-Time Notes.
The connection uses community protocol support. A publisher change, expired session, or access check can stop an import.
The phone can read its own connected account or receive account readings through device sync.
Game passwords and session cookies do not enter progress backups or device sync.

## Import a screenshot

1. Take a screenshot of the game screen that shows the resource name and value.
2. In the Windows app, drop or paste the screenshot anywhere in Memoria.
   On Android, share the screenshot to Memoria from another app.
3. Memoria reads the image and saves the readings it is sure about.
4. Select **Undo** in the notice if a saved value is wrong.

You can also start from a game's card. Select **Readings**, then **Read a screenshot**.
In a browser, select **Readings**, then **Enter screenshot text**, and paste the text.
Drop one PNG or JPEG file, up to 8 MB.

Memoria saves a value without a question when its name sits beside its own maximum.
For example, `Original Resin 120 / 200` identifies a resin reading for one tracked game.
Memoria asks you to check a reading in the game's card in these cases:

- The value has no maximum, such as `Original Resin 120`.
- The image only shows a ratio, such as `120 / 200`. Select its resource under **Values without a label**.
- No readings were recognized. Correct the text under **Screenshot text**.

If two tracked accounts could own the screenshot, Memoria asks which game it belongs to.
In the card, check the values and the **Taken** time, then select **Save**.
Memoria asks before a new screenshot replaces a reading that you are still checking.
An older screenshot does not replace a newer reading.
The app reads selected images on the device. It does not continuously record the game screen.

## Connect a HoYoLAB account on Windows

1. Open the Windows app.
2. Open the game's card. On **Today**, select the game.
3. Select **Readings**, then **Connect account**.
4. Select **Set up browser connector**.
5. In Chrome, open `chrome://extensions`. In Edge, open `edge://extensions`.
6. Enable **Developer mode**.
7. Select **Load unpacked**.
8. Select the **browser-extension** folder that Memoria opened.
9. In your browser, open [HoYoLAB](https://www.hoyolab.com/).
10. Sign in on the official page.
11. Open the **Memoria Browser Connector** from the browser toolbar.
12. Select **Read accounts**.
13. In Memoria, select **Find my accounts**.
14. Select the correct **Linked HoYoLAB account**.
15. Select **Connect**.

Memoria saves the account's readings to the card. Select **Undo** in the notice to restore the earlier values.
**Settings** also has a **Game accounts** button that opens the same panel.

Do the connector installation once for each browser profile that you use.
After a Memoria update, select **Reload** for the connector on your browser's extensions page.
Memoria uses your normal Chrome or Edge session. Your password and session cookies stay in the browser.
The connector sends game account details and readings to the Windows app.
Keep Chrome or Edge open when you want automatic browser readings.
Enable automatic checks in the connector and automatic imports for each Memoria account.
If a reading fails, open HoYoLAB and complete its verification, then select **Read accounts** again.
Use **Disconnect** in Memoria to remove a game connection. This does not sign you out of HoYoLAB in your browser.
To stop browser checks, disable them in the connector or remove the extension.

Existing connections from Memoria's separate sign-in window remain available.
The legacy browser launcher also retains its manual session setup.

## Capture readings while you play on PC

1. Open your game and Memoria.
2. In the Memoria header, select **Play mode**.
3. Select **Use the capture shortcut**.
4. Select the **Game account for captures**.
5. Select the **Game window**.
6. If the game window is missing, select **Refresh windows**.
7. Select a **Capture shortcut**.
8. Select **Save play mode**.
9. In the game, open a screen with the resource values.
10. Press the shortcut. The default is **Ctrl + Shift + M**.
11. When convenient, open **Play mode** in Memoria.
12. In **Capture inbox**, select **Use capture**.

Memoria saves the readings it is sure about. It opens the game's card when a value needs a check.
The shortcut does not bring Memoria to the front.
Memoria reads the selected window and keeps only detected text and capture details on this PC.
The inbox holds up to 20 captures. It retains captures after you close and reopen Memoria.
The inbox removes a capture after its readings save, or when you select **Discard**.
Select the game window again after each Memoria restart or game restart.
Windowed or borderless mode gives the best capture results. Some games block screen capture.
Memoria does not continuously record the screen or read game memory.

## Connect a HoYoLAB account on Android

1. Open the game from **Today**.
2. Select **Readings**, then **Connect account**.
3. Select **Sign in with HoYoLAB**.
4. Sign in on the official page.
5. Select **Done** to return to Memoria.
6. Select **Find my accounts** if Memoria did not find your account after sign-in.
7. If Memoria finds multiple accounts, select the correct **Linked HoYoLAB account**.
8. Select **Connect**.

Memoria saves the account's readings to the card.
If Memoria cannot find the account, enter the **In-game UID** and select the **Game server** manually.

The phone supports one HoYoLAB sign-in identity at a time.
You can connect multiple game UIDs and servers for that identity.
The session stays in the app's private WebView cookie store. Session cookies do not cross the JavaScript bridge.
Account connections remain separate from your progress backup.

## Enable automatic checks

Automatic import is optional. Enable it for each account that you want Memoria to check.
Memoria checks enabled, active games every five minutes while the app is online.
The Windows app continues checks when minimized.
Browser connections also require Chrome or Edge with connector checks enabled.
The Android app must remain visible for these checks.
Supported fields depend on the game and the account response.
Missing fields remain unchanged. Memoria does not infer that every daily task is complete from an incomplete response.

To continue PC checks after you close the window:

1. Open **Play mode**.
2. Select **Keep Memoria in the system tray**.
3. Select **Save play mode**.

The tray option also keeps the capture shortcut and phone sync available.
The PC must remain awake. Memoria does not start automatically with Windows.
To stop Memoria, open its tray menu and select **Quit Memoria**.
The PC and phone need separate HoYoLAB sign-in sessions. Device sync transfers progress, not credentials.

## Review or undo an import

1. Open the game's card.
2. Select **Readings**, then **Recent imports**.
3. Find the import by its source and time.
4. If necessary, select **Undo**.

Recent imports contains the imports on this device.
Undo preserves later edits. An older import does not replace a newer manual correction.
Duplicate imports do not add the same readings again.

## Read the status

Each game's card names the source of its last reading: **Manual**, **Account**, or **Screenshot**.
**Starting estimate** identifies an initial value that did not come from the game.
The time describes when the reading was observed. Memoria calculates the current value from that reading.
**auto** identifies an account that Memoria checks every five minutes.

The header reports device sync separately.
A successful device sync does not confirm that the game connection is current.
Select **Readings**, then **Fetch from account**, to read a connected account again.

## Start a game from Memoria

The Windows app can start a tracked game.

1. Open the game's card.
2. Select **Set up launch**.
3. Select the game's program or launcher, or a shortcut to it.
4. Select **Launch** to start it.

To change or remove the program, select **Edit** on the card, then **Change** or **Remove**.
Memoria stores the choice on this PC. It does not enter backups or device sync.
Browsers and the Android app do not show **Launch**.
