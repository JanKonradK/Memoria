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

## Desktop shortcut from source

```sh
npm run build
npm run install:desktop
```

The launcher serves `app/dist`. Reopen the window after a new build.
Restart the launcher process after changes to launcher code.

### Browser choice

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
```

Outputs:

- `dist/release/Memoria-win-x64.zip`
- `dist/release/SHA256SUMS.txt`
- `app/dist-single/Memoria.html`

Release checks use a copied install, isolated app data, and an available launcher port.
They cover startup, disk sync, a second launch, live changes, and offline HTML use.

The ZIP includes the built app, launcher, icon, and a pinned Node runtime.
Packaging verifies the Node download against the official checksum.
`release.json` identifies a packaged install. The updater does not replace a source checkout.

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

## Automatic updates

The packaged launcher checks GitHub at most once every six hours.
It verifies the download checksum and stages the update for the next launcher start.
User data stays outside the install folder.

From the packaged install folder, use this command for a manual check:

```bat
node\node.exe desktop\memoria.mjs --check-update
```

Set `MEMORIA_NO_UPDATE=1` before launch to disable automatic update checks.
