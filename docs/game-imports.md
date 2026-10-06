# Import game progress

Memoria 2.0 has three input methods: manual entry, screenshot import, and supported account connections.
All methods use the same resource and task controls.
An energy estimate is a calculation from the last reading, not a live measurement from the game.

## Select a method

| Method             | Available on                | Coverage                                                                        |
| ------------------ | --------------------------- | ------------------------------------------------------------------------------- |
| Manual entry       | All versions                | All resources and tasks                                                         |
| Screenshot text    | All versions                | Recognized resource names and values for the selected game                      |
| Image recognition  | Windows app and Android app | Text visible in a selected screenshot                                           |
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
6. Enter the **In-game UID**.
7. Select the **Game server**.
8. Expand **Get a connection session**.
9. Follow the instructions to get the HoYoLAB session cookie.
10. Paste the cookie into **HoYoLAB session cookie**.
11. Select **Connect and review**.
12. Compare the readings with the game before you apply them.

Windows encrypts the session for the current Windows user.
Keep the session cookie private. Use **Disconnect** to remove the connection.
If the session expires, connect the account again.
The Windows app does not have a built-in sign-in browser.

## Connect a HoYoLAB account on Android

1. Open **Import readings**.
2. Select the correct **Game account**.
3. Select **Accounts**.
4. Select **Sign in with HoYoLAB**.
5. Sign in on the official page.
6. Select **Done** to return to Memoria.
7. Enter the **In-game UID**.
8. Select the **Game server**.
9. Select **Connect and review**.
10. Check the readings before you apply them.

The phone supports one HoYoLAB sign-in identity at a time.
You can connect multiple game UIDs and servers for that identity.
The session stays in the app's private WebView cookie store. Session cookies do not cross the JavaScript bridge.
Account connections remain separate from your progress backup.

## Enable automatic checks

Automatic import is optional. Enable it for each account that you want Memoria to check.
Memoria checks enabled, active games every five minutes while the Windows or Android app is open, visible, and online.
Supported fields depend on the game and the account response.
Missing fields remain unchanged. Memoria does not infer that every daily task is complete from an incomplete response.

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
