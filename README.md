# ⚡ Void — Gacha Daily / Energy / Event Tracker

One dashboard for every gacha you play: live energy projections, dailies/weeklies/monthlies
that reset on each game's _server_ time, an event timeline, and Discord/Telegram pings before
you waste regen or miss a reset.

Ships with editable presets for **Genshin, HSR, ZZZ, Wuthering Waves and NTE** — every
cap, regen rate and reset time is data you can change in the app in seconds when a patch
changes something.

## Layout

```
app/     React PWA (Vite + Tailwind) — installable on PC and phone
worker/  Cloudflare Worker — sync API (D1) + cron alert engine (Discord/Telegram)
shared/  All the math: energy projection, reset periods, urgency, alerts, merge
```

## Run it locally

```sh
npm install
npm run dev        # app on http://localhost:5183 (works fully offline, no server needed)
npm run check      # lint, format, types, shared/Worker tests, build and PWA budget
npm run test:e2e   # Playwright responsive, keyboard and accessibility journeys
```

The app is completely usable without the worker — data lives in IndexedDB on the device.
The worker adds two things: **sync between devices** and **alerts while the app is closed**.

## Local state file

The desktop launcher keeps the canonical local copy of your data in
`%APPDATA%\void\state.json` and serves it over `/api/sync`. The PWA
auto-syncs against the launcher whenever it's opened through it (no setup, the
token field stays empty), and the launcher pushes a `/api/events` ping to open
app windows whenever the file changes on disk. The hosted Cloudflare product
uses Clerk sessions and tenant-scoped D1 documents for cross-device sync and
closed-app alerts.

## Desktop shortcut (Windows)

```sh
npm run build              # the launcher serves app/dist
npm run install:desktop    # puts a Void shortcut on the Desktop
```

The shortcut opens the app in its own window and keeps serving on the **fixed port
17817** — the port must never change, because all data (IndexedDB) is tied to the
origin `http://127.0.0.1:17817`. Launching twice reuses the running instance.
After a `npm run build`, just reopen the window to pick up the new version.
The launcher also exposes `/api/state` + `/api/sync` backed by
`%APPDATA%\void\state.json`, so app windows stay in sync locally.

If you deploy to Cloudflare (below), create `desktop/config.json` with
`{ "url": "https://void.<your-subdomain>.workers.dev" }` — the shortcut then
opens the hosted, always-synced app instead of a local server.

## Deploy the hosted product

Production uses its own Clerk application, D1 database, and encryption key.
Follow [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md);
deployments apply numbered migrations and require the CI launch gates.

After signing in:

1. Existing local IndexedDB data is previewed and merged only after confirmation.
2. **Settings → Notifications**: connect a Discord webhook URL (channel settings → Integrations →
   Webhooks) and/or a Telegram bot token + chat id (create a bot with @BotFather, message it once,
   read your chat id from `https://api.telegram.org/bot<TOKEN>/getUpdates`).
3. Hit **Send test ping**.
4. Install the PWA: browser menu → _Install app_ (desktop) / _Add to Home Screen_ (phone).

The worker cron runs every 10 minutes and pings you when: energy will cap within your
threshold (or is already capped), dailies/weeklies/monthlies are undone close to reset,
an event is about to end, or a one-off reminder is due. Quiet hours are respected and
every alert fires exactly once (re-armed each time you enter a new energy snapshot).

## Getting events in

- **Bundled feed** (Timeline): the app ships with the current patches' events in
  [app/src/data/seed-events.ts](app/src/data/seed-events.ts). Whenever that file
  contains events (or corrected dates) your device doesn't have, the Timeline shows
  an "Import N" button — one click imports everything, deduped against manual
  entries. After a new patch, ask Claude to refresh the file
  (it pulls the official announcement feeds + patch notes), `npm run build`, reopen,
  click import. Entries whose exact dates weren't announced yet carry a "TBC —
  verify in-game" note and don't fire alerts until a refresh confirms them.
- **Paste (AI)** (Timeline): for any game — copy the generated
  prompt, hand it to any AI, paste the JSON it returns, review, import.
  Handles code fences and skips malformed rows; times are read in the game's
  server timezone.

## The daily loop

1. Play your game(s).
2. Open Void and punch in what's actually left, right on the card: click the
   value box and type, or step with the keyboard — **A −10 · S −1 · D +1 · F +10**,
   Enter saves. Click the cap number ("/200") to change it when your max shifts
   (rank-ups, events), or add one-tap spend shortcuts in game ⚙ → Quick spend.
   Tick the dailies.
3. That's it — projections and alerts recalibrate from your entry.

## Quality of life

- Game ⚙ is deliberately lean: identity, resets, resources, tasks. Events live
  on the Timeline.
- **Endgame cycles** ship as preset tasks with real 2026 cadences (Stygian 35d,
  HSR endgame refresh 14d, Shiyu/Deadly Assault 14d, ToA/WhiWa 28d, …) — all
  editable per game via ⚙ → Tasks, like everything else.
- **Safe to sleep**: evenings (20:00–05:00) each card shows either "sleep
  safe" or the time it caps within your sleep window (Settings → sleepHours).
- **Per-game alerts**: Settings keeps global defaults compact, with optional
  timing overrides for individual games.
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
- Hosted sync is last-write-wins per row inside an authenticated tenant document,
  with optimistic version retries to prevent concurrent lost updates.
- Normal exports are secret-free. Security and recovery details live in
  [docs/SECURITY.md](docs/SECURITY.md) and [docs/runbooks/INCIDENTS.md](docs/runbooks/INCIDENTS.md).
