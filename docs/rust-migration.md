# Moving the Windows app from Electron to Rust

Goal: no Electron and no Node in the shipped Windows app. Node stays a build tool for the React app.

## Design

- **Shell:** Tauri 2 on the system WebView2 runtime. The crate lives in `native/`.
- **Local server:** the same loopback contract as `desktop/memoria.mjs`, rewritten in Rust (axum).
  The window still opens `http://127.0.0.1:17817/api/launch/<ticket>`, so the React app keeps
  `launcherFetch`, the bearer token, `/api/events` and its IndexedDB origin.
- **Domain rules:** `shared/` stays the only implementation. The release build bundles
  `desktop/shared-core.mjs` for a neutral platform and the Rust server runs it in QuickJS
  (`rquickjs`). Rust supplies the PC's IANA time zone, since QuickJS has no `Intl`.
  A parity test runs the same states through Node and through the Rust core.
- **Bridge:** an initialization script defines `window.memoriaDesktop` (version 1) on top of
  Tauri IPC. Its shape matches `app/src/desktop-host.ts`, so the app needs no host changes.
  IPC is only granted to the loopback origins in `native/capabilities/`.
- **Data:** `%APPDATA%\memoria` is unchanged. A new WebView2 profile fills IndexedDB from
  `state.json` before its first sync write (`app/src/store.ts`), so progress carries over.
  Per-window browser settings in the old Electron profile do not.

## Upgrade path from 3.2.0

Installed Electron builds download `Memoria-win-x64.zip`, verify `SHA256SUMS.txt`, require a
`release.json`, then run the **new** build's `desktop/Install-Shortcut.ps1` and start
`Memoria.exe`. The Rust release keeps that zip layout and those two files. Its installer
accepts an existing `runtime: "electron"` install as the destination it replaces.

## Phases

1. **Shell and local server.** Window, bounds, menu, zoom, navigation guard, external links,
   close-and-save handshake, single instance. Loopback server with launch tickets, CSP,
   `/api/state`, `/api/sync`, `/api/events`, `/api/calendar`, `/api/update`, `/.memoria/hello`.
2. **Parity.** Phone (LAN) sync on port 17820, game launch, and the updater (check, download,
   verify, stage, install on close).
3. **Remove Electron.** Package the Rust build, update the installer, scripts, tests, README
   and `docs/development.md`, then drop `electron`, `desktop/*.mjs` and the browser launcher.
