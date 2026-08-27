# Memoria — Gacha Daily / Energy / Event Tracker

One dashboard for every gacha you play: live energy projections, dailies/weeklies/monthlies
that reset on each game's _server_ time, an event timeline, and in-app next actions before
you waste regen or miss a reset.

Ships with editable presets for **Genshin, HSR, ZZZ, Wuthering Waves, NTE, Love and
Deepspace, Umamusume, NIKKE and Arknights: Endfield** — every cap, regen rate and reset
time is data you can change in the app in seconds when a patch changes something.

Memoria runs entirely on your own machine. No account, no server, no deployment.

## Layout

```
app/      React PWA (Vite + Tailwind) — the whole interface
shared/   All the math: energy projection, reset periods, urgency, merge
desktop/  Windows launcher: local server, app window, state.json
```

## Run it

```sh
npm install
npm run dev        # app on http://localhost:5183
npm run check      # lint, format, types, tests, build and PWA budget
npm run test:e2e   # Playwright responsive, keyboard and accessibility journeys
```

Data lives in IndexedDB in the browser you open it with. Backups are JSON files
you export and import from Settings → Data.

## Send it to a friend (one file)

```sh
npm run build:single       # writes app/dist-single/Memoria.html
```

That is the whole app in a single ~2 MB HTML file: script, styles, fonts and icon
are all inlined, so it needs no install, no server and no network. Send the file,
let them save it anywhere, and they open it by double-clicking. Their data is
their own — it stays in their browser and never leaves the machine.

Tell them three things:

- **Use Chrome or Edge.** Verified there: the page runs from `file://`, the app
  saves to IndexedDB, and reloading keeps everything. Other browsers isolate
  `file://` storage differently and may lose data when the file is moved.
- **Keep the file where it is.** Renaming it is fine; a browser that keys storage
  to the file path would treat a moved copy as a fresh start.
- **Export a backup now and then** from Settings → Data. It is the only copy that
  survives clearing browser data.

### Sending them an update

Rebuild, send the new file, tell them to open it. In Chrome and Edge their data
is already in it: every `file://` page shares one origin, so a fresh download in
a different folder under a different name reads the same IndexedDB the old copy
wrote (verified). Older data is migrated forward on load by `migrateState`, so
they can skip several versions at once. The old file can just be deleted.

- **Export a backup first anyway.** It is the only path that works if they are
  on Firefox, which keys `file://` storage per file, and the only way to carry
  data to another browser or machine.
- **Do not let them reopen an old copy afterwards.** Loading state stamps it
  with the running build's schema version and salvages rows against that build's
  schemas, so an older build silently drops fields it does not know and writes
  the result back.

The single-file build carries no service worker (a `file://` page cannot register
one) and no launcher sync. Everything else is the same app; see
`app/scripts/vite-single-file.ts`.

## Desktop shortcut (Windows)

```sh
npm run build              # the launcher serves app/dist
npm run install:desktop    # puts a Memoria shortcut on the Desktop
```

The shortcut opens the app in its own window and serves it on the **fixed port
17817** — the port must never change, because all data (IndexedDB) is tied to the
origin `http://127.0.0.1:17817`. Launching twice reuses the running instance.
After a `npm run build`, just reopen the window to pick up the new version.

Opened this way, the app also reads and writes `%APPDATA%\void\state.json` over
`/api/state` + `/api/sync`, and the launcher pushes an `/api/events` ping when the
file changes on disk. That is how two open windows stay in agreement — and it
gives you one real file to back up. The server listens on loopback only and exits
a few minutes after the last window closes.

### Choosing the browser

By default Memoria opens in your default browser when that browser can do app
windows (Chromium-based), otherwise in the first one it finds installed. To pin
a specific one:

```sh
node desktop/void.mjs --list-browsers     # what's installed and what would open
node desktop/void.mjs --browser zen       # this launch only
```

Persist the choice with `"browser"` in `desktop/config.json`, an environment
variable, or arguments on the shortcut itself (`Memoria.vbs --browser zen`):

```json
{ "browser": "helium" }
```

Known names: `helium`, `chrome`, `edge`, `brave`, `vivaldi`, `opera`, `firefox`,
`zen`, `librewolf`. You can also pass a full path to any executable, or
`system` to hand the URL to whatever the machine has registered for `https`
(the escape hatch for anything not on the list). Chromium-based browsers get a
chromeless app window; Firefox-based ones get a plain window; `system` gets a
tab. Precedence is `--browser` → `VOID_BROWSER` → `config.json` → automatic.

## Getting events in

- **Bundled feed** (Timeline): the app ships with the current patches' events in
  [app/src/data/seed-events.ts](app/src/data/seed-events.ts). Whenever that file
  contains events (or corrected dates) your device doesn't have, the Timeline shows
  an "Import N" button — one click imports everything, deduped against manual
  entries. After a new patch, ask Claude to refresh the file
  (it pulls the official announcement feeds + patch notes), `npm run build`, reopen,
  click import. Entries whose exact dates weren't announced yet carry a "TBC —
  verify in-game" note and stay out of next actions until a refresh confirms them.
- **Paste (AI)** (Timeline): for any game — copy the generated
  prompt, hand it to any AI, paste the JSON it returns, review, import.
  Handles code fences and skips malformed rows; times are read in the game's
  server timezone.

## The daily loop

1. Play your game(s).
2. Open Memoria and punch in what's actually left, right on the card: click the
   value box and type, or step with the keyboard — **A −10 · S −1 · D +1 · F +10**,
   Enter saves. Click the cap number ("/200") to change it when your max shifts
   (rank-ups, events), or add one-tap spend shortcuts in game ⚙ → Quick spend.
   Tick the dailies.
3. That's it — projections and next actions recalibrate from your entry.

## Quality of life

- Game ⚙ is deliberately lean: identity, resets, resources, tasks. Events live
  on the Timeline.
- **Endgame cycles** ship as preset tasks with real 2026 cadences (Stygian 35d,
  HSR endgame refresh 14d, Shiyu/Deadly Assault 14d, ToA/WhiWa 28d, …) — all
  editable per game via ⚙ → Tasks, like everything else.
- **Safe to sleep**: evenings (20:00–05:00) each card shows either "sleep
  safe" or the time it caps within your sleep window (Settings → sleepHours).
- **In-app next actions**: the dashboard keeps upcoming caps, resets and event
  deadlines visible while Memoria is open.
- **Stable card order**: cards never re-sort themselves while you're entering
  values — when urgency changes, a "↻ Sort by urgency" button appears instead.
- **Reset warnings**: undone tasks turn amber under 2 hours from their reset
  and pulse red with a countdown under 20 minutes.

## After a patch / new event

- **New banner/event:** Timeline → _+ Event_ (10 seconds; toggle "daily touch" if it needs logins).
- **Cap or regen changed:** game card → ⚙ → edit the number.
- **New game:** Dashboard → _Add game_ → pick a preset or make a custom one.
- Preset defaults live in [shared/src/presets.ts](shared/src/presets.ts) if you want to fix them at the source.

## Notes

- Preset values (caps, rates, reset times) are best-effort defaults — verify against your
  server/rank and edit in the app. The NTE preset is explicitly marked as needing
  verification.
- Merging (import, and the launcher's state file) is last-write-wins per row on
  `updatedAt`, with soft-delete tombstones — never a wholesale replace.
- Nothing runs while the app is closed: reminders, resets and deadlines are
  computed when you open it.
