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
2. In Memoria, select **Import readings** on **Today**.
3. Select the correct **Game account**.
4. Select **Screenshot**.
5. Select **Choose screenshot**, or paste the text into **Text from the screenshot**.
6. Enter the **Screenshot capture time** in this device's local time.
7. Select **Review readings**.
8. Compare the detected values with the screenshot.
9. Correct a detected value if necessary.
10. Select **Apply reviewed readings**.

On Android, you can also share a screenshot to Memoria from another app.
Select **Review shared screenshot** when Memoria receives the image.

Recognition uses a resource name and its value. For example, `Original Resin 120 / 200` identifies a resin reading.
If an image only shows a ratio, expand **Assign values without a label** and select its resource before review.
Unclear text, unsupported labels, and fields absent from the image do not become confirmed progress.
Use manual entry when recognition cannot identify a value.
The app reads selected images on the device. It does not continuously record the game screen.

## Connect a HoYoLAB account on Windows

1. Open the Windows app.
2. Select **Settings**.
3. Select **Game connections and imports**.
4. Select the correct **Game account**.
5. Select **Accounts**.
6. Select **Sign in with HoYoLAB**.
7. Sign in on the official page in the separate window.
8. Select **Done** in that window, or press **Ctrl + Enter**.
9. If necessary, select **Find my accounts**.
10. Select the correct **Linked HoYoLAB account**.
11. Select **Connect and review**.
12. Compare the readings with the game before you apply them.

If Memoria cannot find the account, enter the **In-game UID** and select the **Game server** manually.
Windows encrypts the connection session for the current Windows user.
The official sign-in page uses a separate session on this PC.
Session cookies do not enter the Memoria interface, backups, or device sync.
Use **Disconnect** to remove the connection.
After you disconnect the last account, Memoria removes its HoYoLAB sign-in session on this PC.
If the session expires, connect the account again.
The legacy browser launcher still supports manual session setup.

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
12. In **Capture inbox**, select **Review capture**.
13. Check the game account, capture time, and detected text.
14. Select **Review readings**.
15. Check the values, then select **Apply reviewed readings**.

The shortcut does not bring Memoria to the front.
Memoria reads the selected window and keeps only detected text and capture details on this PC.
The inbox holds up to 20 captures. It retains captures after you close and reopen Memoria.
The inbox removes a capture after its reviewed readings save, or when you select **Discard**.
Select the game window again after each Memoria restart or game restart.
Windowed or borderless mode gives the best capture results. Some games block screen capture.
Memoria does not continuously record the screen or read game memory.

## Connect a HoYoLAB account on Android

1. Open **Import readings**.
2. Select the correct **Game account**.
3. Select **Accounts**.
4. Select **Sign in with HoYoLAB**.
5. Sign in on the official page.
6. Select **Done** to return to Memoria.
7. Select **Find my accounts** if Memoria did not find your account after sign-in.
8. If Memoria finds multiple accounts, select the correct **Linked HoYoLAB account**.
9. Select **Connect and review**.
10. Check the readings before you apply them.

If Memoria cannot find the account, enter the **In-game UID** and select the **Game server** manually.

The phone supports one HoYoLAB sign-in identity at a time.
You can connect multiple game UIDs and servers for that identity.
The session stays in the app's private WebView cookie store. Session cookies do not cross the JavaScript bridge.
Account connections remain separate from your progress backup.

## Enable automatic checks

Automatic import is optional. Enable it for each account that you want Memoria to check.
Memoria checks enabled, active games every five minutes while the app is online.
The Windows app continues checks when minimized.
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

1. Select **Import readings**.
2. Select **History**.
3. Find the import by its source and time.
4. If necessary, select **Undo import**.

History contains recent imports on this device.
Undo preserves later edits. An older import does not replace a newer manual correction.
Duplicate imports do not add the same readings again.

## Read the status

**Manual**, **Account**, and **Screenshot** identify the source of a reading.
**Starting estimate** identifies an initial value that did not come from the game.
The time describes when the reading was observed.
**Estimated** identifies a value that Memoria calculates from that reading.

The header reports device sync separately.
A successful device sync does not confirm that the game connection is current.
Open **Accounts** to check a connection or fetch its readings again.
