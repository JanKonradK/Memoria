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

The output is `dist/release/Memoria-android-debug.apk`.
The APK contains the app assets and supports offline startup. The minimum version is Android 7 (API 24).
The build uses a local debug key. Keep that key to install later test builds as updates.
A public release needs a separate release key and a signing process.

Native Back closes the active editor through its normal cancel control.
The Android backup command opens the system file picker.
External web links open outside the app.

The browser tests cover phone layouts and motion. They do not replace tests on a physical Android device.
The [Capacitor Android documentation](https://capacitorjs.com/docs/android) describes the native project.
The [View Transition API documentation](https://developer.mozilla.org/en-US/docs/Web/API/Document/startViewTransition)
describes the optional card transition. Older browsers use immediate navigation.

## Standalone Windows app

```sh
npm run build
npm run desktop
```

Electron opens the interface in its own window with its bundled runtime.
The renderer has no Node access. The preload exposes only the close-and-save handshake.
The local backend keeps the existing data file and Wi-Fi connections.
The desktop profile stays in `%APPDATA%\memoria\desktop-profile`.

To install a copy with Desktop and Start Menu shortcuts:

```sh
npm run package
npm run install:desktop
```

The installer copies `dist/release/Memoria` to `%LOCALAPPDATA%\Programs\Memoria`.
Close an installed copy before installation. The installer refuses to replace an active runtime.
User data stays in `%APPDATA%\memoria`.

### Legacy browser launcher

The browser launcher remains available for diagnostics and browser checks:

```sh
node desktop/memoria.mjs --list-browsers
node desktop/memoria.mjs --browser zen
```

For a persistent choice, set `browser` in `desktop/config.json`:

```json
{ "browser": "helium" }
```

Supported names include `helium`, `chrome`, `edge`, `brave`, `vivaldi`, `opera`, `firefox`, `zen`, and `librewolf`.
A full executable path is also valid. Use `system` for the system browser.
Priority is `--browser`, then `MEMORIA_BROWSER`, then `config.json`, then automatic selection.

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
They cover startup, disk sync, a second launch, live changes, and offline HTML use.

The ZIP includes `Memoria.exe`, Electron, the built app, backend, icon, and a pinned Node runtime.
Electron's license files stay in the download. The package uses the Electron version from `package-lock.json`.
Packaging verifies the Node download against the official checksum.
`release.json` identifies a packaged install. The updater does not replace a source checkout.
The native release record uses `runtime: "electron"` and `updateMode: "manual"`.
This prevents the backend from changing program files that the desktop runtime uses.

The standalone HTML includes its scripts, styles, fonts, and icon.
It has no service worker, launcher sync, or automatic updater.
Use a backup to transfer data between browsers or file locations.

## Publish a release

Run the checks above first. From `main`, increase the version:

```sh
npm version patch

git push --follow-tags
```

Use `minor` or `major` instead of `patch` when appropriate.
A `v*` tag starts [the release workflow](../.github/workflows/release.yml).
The tag must match the version in `package.json`.
The workflow builds and publishes both downloads, checksums, and release notes.
CI also assembles the Windows package on each push to `main` and each pull request.

## Desktop updates

The standalone desktop app uses manual updates. Select **Help → Download updates** to open the release page.
Close Memoria before you install a newer download. The installer retains the current program folder until the new copy is complete.
If the final folder change fails, the installer restores the previous program folder.
User data stays separate from the program files.

Older browser packages keep the previous background updater.
The updater checks GitHub at most once every six hours and verifies the download checksum.
It stages updates for the next launcher start.
For an older browser package, this command starts a manual check:

```bat
node\node.exe desktop\memoria.mjs --check-update
```

Set `MEMORIA_NO_UPDATE=1` before launch to disable automatic update checks.
