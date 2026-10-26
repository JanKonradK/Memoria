# Developer guide

For download and daily-use instructions, see the [README](../README.md).

## Run from source

CI and the Windows download use Node **24.21.0**. Use that version for release checks.

```sh
npm install
npm run dev
```

Open `http://localhost:5183`.

```sh
npm run check
npm run audit
npm exec -- playwright install chromium
npm run test:e2e
```

`check` runs lint, formatting checks, type checks, unit tests, builds, and the PWA size check.
The browser tests cover responsive layouts, keyboard controls, and accessibility.

## Code layout

| Location                      | Responsibility                                                             |
| ----------------------------- | -------------------------------------------------------------------------- |
| `app/src/components/`         | Interface and shared controls                                              |
| `app/src/store.ts`            | State changes and local storage                                            |
| `app/src/selectors.ts`        | Shared derived data for the interface                                      |
| `app/src/data/seed-feed.ts`   | Event facts and source notes                                               |
| `app/src/data/seed-events.ts` | Event import rules                                                         |
| `shared/src/`                 | Types, validation, migrations, merge rules, energy, and reset calculations |
| `desktop/`                    | Windows launcher and updates                                               |
| `scripts/` and `app/scripts/` | Builds, packaging, and release checks                                      |

Read [AGENTS.md](../AGENTS.md) before code changes. Reuse existing code and preserve saved data.

## Event and preset changes

Edit [seed-feed.ts](../app/src/data/seed-feed.ts) for event dates and source notes.
Verify dates against official announcements. Keep uncertain dates clearly marked.
Import rules protect user edits and deleted events.

Edit [presets.ts](../shared/src/presets.ts) for default game settings.
Keep preset task keys stable so renamed tasks do not create duplicates.

## Storage and sync

The browser uses IndexedDB. Backup export and import use JSON files.
The Windows launcher also stores `%APPDATA%\memoria\state.json` outside the install folder.

Local sync uses `/api/state`, `/api/sync`, and `/api/events`.
The launcher listens on loopback only. It normally uses port 17817, with 17818 and 17819 as alternatives.
A browser's storage belongs to its origin, so keep these ports stable.
An authenticated second launch reuses the existing instance.

The shortcut gives each browser session an authorization token for its exact origin.
Session storage holds the token. Requests send it in a header, not a cookie.
The token expires when the launcher stops. Reopen the shortcut if local sync requests a new session.
For the first upgrade from the cookie-based launcher, stop the old launcher before you start the new version.

Optional cloud sync uses a user-selected file in an existing synced folder.
The provider's client transfers the file. Memoria reads it before each write and merges the data.
For conflicting rows, the later `updatedAt` value wins. Deleted rows retain tombstones.
If a provider creates a conflict copy, import that copy through Settings to merge it.

Optional Wi-Fi sync uses a separate listener on TCP port 17820.
The user enables it in the Windows app and pairs the Android app with a temporary code.
The launcher keeps its existing loopback access checks.
Both listeners use the same merge rules and a serialized state writer.
Sync merges rows by identifier. A game added separately on two devices is two games.
Before its first sync, the Android app reads the PC's data with an empty request.
If each side has games the other has not seen, the app asks the user before it sends or merges data.
The Android app uses native HTTP requests. Browser pages cannot use the Wi-Fi listener.

The PC displays a QR code with a temporary pairing code and private addresses.
Android scans it through the native camera activity. Shared validation rejects unrelated codes and nonlocal addresses before any request.
The app tries the supplied addresses until it reaches the PC. It does not scan the network.
Manual entry remains available. A failed replacement scan keeps the previous connection.
The camera permission request occurs only after the user selects Scan PC code. The scanner does not save images.

Wi-Fi sync uses HTTP on a trusted private network. It does not encrypt network traffic.
Keep the PC on and Memoria open. The phone syncs while its app is open and after it returns to the foreground.
Offline edits stay on the phone until the PC becomes available.

## Build the Android APK

Install Android Studio with Android SDK 36 and JDK 21 or later.
Then run:

```sh
npm ci
npm run build:android
```

The output is `dist/release/Memoria-android.apk`, a release build. Its version comes from `package.json`.
The APK contains the app assets and supports offline startup. The minimum version is Android 7 (API 24).
It is signed with `~/.android/debug.keystore`, the key already on installed devices. Set `MEMORIA_KEYSTORE` and its password variables to use another.
Android refuses an update signed with a different key, so every published APK must use this one.
The release workflow restores it from the `ANDROID_KEYSTORE_BASE64` repository secret.

Native Back closes the active editor through its normal cancel control.
The Android backup command opens the system file picker.
External web links open outside the app.

The browser tests cover phone layouts and motion. They do not replace tests on a physical Android device.
The [Capacitor Android documentation](https://capacitorjs.com/docs/android) describes the native project.
The [View Transition API documentation](https://developer.mozilla.org/en-US/docs/Web/API/Document/startViewTransition)
describes the optional card transition. Older browsers use immediate navigation.

## Standalone Windows app

The Windows app is a Rust program in `native/` (Tauri 2 on the WebView2 runtime that Windows provides).
It needs the [Rust toolchain](https://rustup.rs) and the Visual Studio C++ Build Tools.
Node is only a build tool. The shipped app contains no Node or Electron.

```sh
npm run build
npm run desktop
```

`npm run desktop` builds the host and opens the window on your real data folder. Close an installed Memoria first.
The host serves `app/dist` on a loopback port (17817, 17818 or 17819) and backs `/api/state`, `/api/sync`
and `/api/events` with `%APPDATA%\memoria\state.json`. It runs the merge and validation rules from `shared/`
in embedded QuickJS, so they have one implementation ([rust-migration.md](rust-migration.md)).
The page has no Node or Tauri access. `native/src/bridge.js` exposes only `window.memoriaDesktop`:
the close-and-save handshake, game launch and updates. IPC is granted only to the loopback origins.
The WebView2 profile stays in `%APPDATA%\memoria\webview-profile`.

```sh
npm run test:native
```

This runs the Rust tests, the parity test that runs the state rules in Node and in QuickJS,
and `native/test/launcher.test.mjs` against the built host.
`Memoria.exe --headless` serves the app without a window and prints a launch URL, for these tests.
`MEMORIA_TEST_PORT`, `MEMORIA_TEST_LAN_PORT` and `MEMORIA_ROOT` keep a test copy off the ports
and folders of a running Memoria.

To install a copy with Desktop and Start Menu shortcuts:

```sh
npm run package
npm run install:desktop
```

The installer copies `dist/release/Memoria` to `%LOCALAPPDATA%\Programs\Memoria`.
Close an installed copy before installation. The installer refuses to replace an active runtime.
User data stays in `%APPDATA%\memoria`.

## Build the downloads

```sh
npm run build
npm run package
npm run build:single
npm run check:release
npm run check:native
```

Outputs:

- `dist/release/Memoria-win-x64.zip`
- `dist/release/SHA256SUMS.txt`
- `app/dist-single/Memoria.html`

Release checks use a copied install, isolated app data, and an available launcher port.
`check:release` serves the packaged app headless to Chromium. It covers startup, disk sync, a second launch,
live changes, Wi-Fi controls, a safe service worker update, the CSP, and offline HTML use.
`check:native` opens the packaged window and drives it through WebView2's DevTools port.
It covers existing PC data, resizing, close and quit saving, a second launch, an unsaved draft,
phone pairing, and blocked navigation.

`npm run package` builds the Rust host in release mode. The ZIP holds `Memoria.exe`, the built app,
the icon and the install scripts.
`release.json` identifies a packaged install. The updater does not replace a source checkout.
The release record uses `runtime: "tauri"`. Installed Electron builds (up to 3.2.0) update into it:
they run the new build's `Install-Shortcut.ps1`, which accepts an Electron install as the folder it replaces.

The standalone HTML includes its scripts, styles, fonts, and icon.
It has no service worker or launcher sync. It checks for new releases and links to the download page, but cannot replace itself.
Use a backup to transfer data between browsers or file locations.

## Publish a release

Run the checks above first. From `main`, increase the version:

```sh
npm version patch

git push --follow-tags
```

Use `minor` or `major` instead of `patch` when appropriate.
Write the release notes in `docs/releases/v<version>.md` before tagging. The app shows them in **Settings → Updates**.
A `v*` tag starts [the release workflow](../.github/workflows/release.yml).
The tag must match the version in `package.json`.
The workflow builds and publishes the Windows, Android and one-file downloads, checksums, and release notes.
CI also assembles the Windows package on each push to `main` and each pull request.

## Updates

Every build reads the GitHub release list (`app/src/app-update.ts`) and shows the notes of every release newer than itself in `UpdateScreen.tsx`.
The Windows app downloads `Memoria-win-x64.zip` in the Rust host (`native/src/update.rs`), verifies it against `SHA256SUMS.txt` and stages it in `%APPDATA%\memoria\updates\pending`.
**Restart and update** closes through the normal save path. `updates\install-update.ps1`, started through `cmd start` (PowerShell launched directly as a detached child exits without running), then runs the staged `Install-Shortcut.ps1` over the install and reopens Memoria. Its log is `updates\install.log`.
Android downloads `Memoria-android.apk`, verifies it the same way and opens the system installer (`AppUpdaterPlugin.java`).
The installer retains the current program folder until the new copy is complete.
If the final folder change fails, the installer restores the previous program folder.
User data stays separate from the program files.
