# Google Play compliance

Memoria's Android app is built in two flavours from one codebase. This page records what differs, why, and how each Play requirement is met and checked. `npm run check:android` verifies the parts a build can prove.

## Two builds

|                             | `direct` (GitHub releases)                                                                                         | `play` (Google Play)                                                                               |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| Built by                    | `npm run build:android` (or `-- --flavor direct`)                                                                  | `npm run build:android -- --flavor play`                                                           |
| Output                      | `dist/release/Memoria-android.apk`                                                                                 | `dist/release/Memoria-play.aab`                                                                    |
| Updates                     | In-app updater: a publisher-signed APK from GitHub, verified, handed to the system installer                       | Google Play                                                                                        |
| `BuildConfig.IS_PLAY_BUILD` | `false`                                                                                                            | `true`                                                                                             |
| Alarm-style reminders       | Ring as real alarms: full screen over the lock screen, looping in a foreground service, until dismissed or snoozed | Arrive as high-priority notifications on the alarm channels, with their tone and the Snooze action |
| Flavour-only code           | `src/direct`: `AppUpdaterPlugin`, `AlarmClockPlugin`, `FlavorPlugins`                                              | `src/play`: `FlavorPlugins` (adds nothing), `AndroidManifest.xml` overlay                          |

Both share the application id `app.memoria.tracker`, the version (from `package.json`) and every other feature. Moving from a GitHub-distributed APK to the Play build requires either enrolling the GitHub release signing key in Play App Signing or uninstalling the GitHub build first (exporting or syncing data beforehand so local data is not lost).

The page learns which build it runs in from `EntitlementsPlugin.getStatus()` (`distribution: "direct" | "play"`), read once at start by `initEntitlements()` in `app/src/entitlements.ts`. In the Play build `updateTarget()` is `none`, so no GitHub release check runs, the update screen never opens and Settings → Activity & About shows the version alone. An Android copy that has not answered yet is treated the same way, so a check never starts before the answer.

## Removed permissions and components

The Play manifest overlay (`android/app/src/play/AndroidManifest.xml`) removes, with `tools:node="remove"`:

| Permission or component                                   | Why the direct build has it                                    | Why Play does not                                                                                     |
| --------------------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `REQUEST_INSTALL_PACKAGES`                                | The in-app updater installs a verified APK                     | Play installs updates; the permission is restricted to apps whose core purpose is installing packages |
| `USE_EXACT_ALARM`                                         | Alarms ring on the minute                                      | Restricted to alarm-clock and calendar apps                                                           |
| `USE_FULL_SCREEN_INTENT`                                  | A ringing alarm opens over the lock screen                     | Restricted to alarm and calling apps                                                                  |
| `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MEDIA_PLAYBACK` | The alarm loops its tone in a foreground service               | No media-playback use case to declare                                                                 |
| `AlarmService`, `AlarmActivity`, `AlarmReceiver`          | The ringer, its full-screen page, and re-arming after a reboot | The components that need the permissions above                                                        |

Reminders still arrive in the Play build. `notifications.ts` asks the `AlarmClock` plugin to ring alarm-style reminders; the Play build does not register it, so the call fails and those reminders go to Android's notification scheduler on the `memoria-alarm-<tone>` channels instead (high importance, the chosen tone). Nothing asks for full-screen permission, because the status that would prompt for it is never read. `SCHEDULE_EXACT_ALARM` (from `@capacitor/local-notifications`) stays: the player grants it in Android settings, and reminders fall back to inexact timing without it.

`check:android` reads the Play build's merged manifest and fails if any of `REQUEST_INSTALL_PACKAGES`, `USE_EXACT_ALARM`, `USE_FULL_SCREEN_INTENT`, `FOREGROUND_SERVICE_MEDIA_PLAYBACK`, `AlarmService`, `AlarmActivity` or `AlarmReceiver` is declared. It also fails if the direct build lost the updater permission or the ringer, so the overlay never leaks into the GitHub build.

## No publisher artwork

Memoria ships no game publisher's artwork, logos, characters or screenshots. The livestream key art that once headed **News** (Genshin Impact 7.2, Honkai: Star Rail 4.7, NTE 1.5, Wuthering Waves 3.7) was removed; the newest version now leads with a plate drawn from type alone: its number in the game's identity colour. Game coins are Memoria's own drawings of each game's name (see `docs/research/logo-prompts.md`: no official logo artwork). Game names are used only to say which game a reading belongs to.

## 16 KB memory pages

From November 2025, Play requires apps targeting Android 15+ to support 16 KB memory pages: every loadable segment of every 64-bit native library must be aligned to at least 16 KB. Memoria's own code is Java with no native libraries. The native code it ships comes from:

- ML Kit text recognition v2, bundled (`com.google.mlkit:text-recognition:16.0.1`)
- CameraX (`androidx.camera:*:1.4.2`)

`check:android` opens each built APK in plain Node (no SDK tools), reads every `lib/<abi>/*.so`, parses its ELF program headers and fails if any `PT_LOAD` segment on `arm64-v8a` or `x86_64` is aligned to less than 16384 bytes. 32-bit libraries are listed but not failed, as 16 KB pages exist only on 64-bit devices. The parser is covered by `app/test/android-alignment.test.ts`.

## On-device text recognition

**Scan with camera**, **Pick screenshot** and images shared into Memoria are read by ML Kit's bundled Latin text recognizer, on the phone. The model ships inside the app, so no model is downloaded at run time, and neither the image nor the recognised text is sent anywhere. The camera picture is a temporary JPEG in the app's own cache, deleted as soon as it is read; it never reaches the gallery. The page receives a downscaled preview and the recognised text, and the player confirms every reading before anything is saved. The camera permission is requested only when the viewfinder first opens.

ML Kit itself (through Google's `datatransport` library, visible in the merged manifest) may send Google anonymous metrics about the API's performance and usage, as its terms describe. Those metrics hold no image or text. Declare them in the Data safety form as Google's ML Kit data disclosure describes (app info and performance, diagnostics).

## HoYoLAB and SKPORT sign-in

Account sign-ins are opt-in and happen on the services' own pages in a plain WebView (no JavaScript bridge, allowlisted hosts only).

- The session cookies (HoYoLAB) and tokens (SKPORT) are sealed with an AES-256-GCM key held in the Android Keystore. They never reach the page, a log, the app state, a backup or sync.
- After HoYoLAB's session is sealed, every HoYoLAB and HoYoverse cookie is expired from the shared WebView cookie jar, and the sign-in WebView's cache, form data and web storage are cleared when it closes. No raw session stays where Memoria's own WebView could read it.
- Native HoYoLAB requests go only to HTTPS `hoyolab.com` and `hoyoverse.com` hosts, never follow a redirect, and carry only the allowlisted session cookies (`ltuid_v2`, `ltoken_v2`, `ltmid_v2`, `cookie_token_v2`, `account_id_v2`, `account_mid_v2`).
- Disconnecting deletes the sealed values and expires the cookies.

## Backups

Backups only go where the player chooses, through the Storage Access Framework; Memoria requests no storage permission.

- **Export backup** opens the system save window for one file.
- **Automatic backup** keeps one file, `memoria-auto-backup.json`, current in a folder the player picks once with the system folder picker. Memoria holds a persistable grant to that folder alone, writes off the main thread at most every ten minutes and when the app goes to the background with unsaved changes, and gives the grant back when the player stops it.

`android:allowBackup` stays `false`: Android's own cloud backup never copies app data, so the sealed sign-ins cannot leave the device that way.

## Data safety form

What Memoria collects and shares, for Play's Data safety section:

- **Collected by the developer:** nothing. There is no account, analytics, advertising or crash reporting SDK of Memoria's own, and no server of Memoria's that receives player data.
- **Collected by a bundled SDK:** ML Kit's anonymous performance and usage metrics, sent to Google (see On-device text recognition). No images, recognised text or game data.
- **On the device only:** game tracking data, reminders, notes, screenshots being read (deleted after reading), sign-in sessions (sealed in the Keystore).
- **Sent to third parties at the player's request:** with a HoYoLAB or SKPORT sign-in, the sealed session goes to that service to read the player's own game numbers. This is the player's own account, used for its stated purpose.
- **Optional sync:** device-to-device sync is end-to-end encrypted between the player's own paired devices, over the local network or through a relay the player deploys on their own Cloudflare account (`relay/`), which only ever holds ciphertext; a shared-folder sync writes to storage the player chose.
- **Network reads without personal data:** the bundled event feed's updates and, in the direct build only, GitHub release checks.
- **Deletion:** Settings → Data → **Clear local data**, disconnecting an account, or uninstalling removes everything.

## Billing readiness

`EntitlementsPlugin` is the seam for Google Play Billing. Today it reports `tier: "free"`, `proUnlocked: false` and `billingReady: false`, and every feature stays unlocked for everyone (`app/src/entitlements.ts`). Settings → Appearance → **Preview Store locks** shows which options would be Pro without taking any away. When billing lands, `getStatus()` will report the purchase state from Play, and only `isLockedByStorePreview` needs to consult it.

## Releasing to Play

1. `npm run check:android`: both flavours compile, the Play manifest is clean, native code is 16 KB aligned.
2. `npm run build:android -- --flavor play`: `dist/release/Memoria-play.aab`, signed with the upload key from `MEMORIA_KEYSTORE` (see `docs/android-signing.md`).
3. Upload the bundle in Play Console. Keep the store listing's screenshots to Memoria's own screens.
