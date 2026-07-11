# ⚡ TechnoGG — Gacha Daily / Energy / Event Tracker

One dashboard for every gacha you play: live energy projections, dailies/weeklies/monthlies
that reset on each game's *server* time, an event timeline, and Discord/Telegram pings before
you waste regen or miss a reset.

Ships with editable presets for **Genshin, HSR, ZZZ, Wuthering Waves and NTE** — every
cap, regen rate and reset time is data you can change in the app in seconds when a patch
changes something.

## Layout

```
app/     React PWA (Vite + Tailwind + Framer Motion) — installable on PC and phone
worker/  Cloudflare Worker — sync API (D1) + cron alert engine (Discord/Telegram)
shared/  All the math: energy projection, reset periods, urgency, alerts, merge
```

## Run it locally

```sh
npm install
npm run dev        # app on http://localhost:5183 (works fully offline, no server needed)
npm test           # unit tests for the shared calculation core
```

The app is completely usable without the worker — data lives in IndexedDB on the device.
The worker adds two things: **sync between devices** and **alerts while the app is closed**.

## Desktop shortcut (Windows)

```sh
npm run build              # the launcher serves app/dist
npm run install:desktop    # puts a TechnoGG shortcut on the Desktop
```

The shortcut opens the app in its own window and keeps serving on the **fixed port
17817** — the port must never change, because all data (IndexedDB) is tied to the
origin `http://127.0.0.1:17817`. Launching twice reuses the running instance.
After a `npm run build`, just reopen the window to pick up the new version.

If you deploy to Cloudflare (below), create `desktop/config.json` with
`{ "url": "https://technogg.<your-subdomain>.workers.dev" }` — the shortcut then
opens the hosted, always-synced app instead of a local server.

## Deploy the sync + alerts server (Cloudflare, free tier)

```sh
cd worker
npx wrangler login
npx wrangler d1 create technogg          # paste the printed id into wrangler.jsonc
npm run db:migrate                       # creates tables (remote)
npx wrangler secret put SYNC_TOKEN       # invent a long random string
cd ..
npm run deploy                           # builds the app + deploys worker serving it
```

Then open `https://technogg.<your-subdomain>.workers.dev`:

1. **Settings → Sync server**: enter the URL and your token → *Save & sync now*.
2. **Settings → Notifications**: paste a Discord webhook URL (channel settings → Integrations →
   Webhooks) and/or a Telegram bot token + chat id (create a bot with @BotFather, message it once,
   read your chat id from `https://api.telegram.org/bot<TOKEN>/getUpdates`).
3. Hit **Send test ping**.
4. Install the PWA: browser menu → *Install app* (desktop) / *Add to Home Screen* (phone).

The worker cron runs every 10 minutes and pings you when: energy will cap within your
threshold (or is already capped), dailies/weeklies/monthlies are undone close to reset,
an event is about to end, or a one-off reminder is due. Quiet hours are respected and
every alert fires exactly once (re-armed each time you enter a new energy snapshot).

## HoYoLAB auto-import (Genshin / Star Rail / ZZZ)

Skip manual entry entirely for HoYo games. **Settings → HoYoLAB auto-import**:
log in at hoyolab.com, F12 → **Network** tab → reload → click any hoyolab.com
request → copy the whole `cookie:` request header → paste it in, hit *Detect &
link accounts*. (`document.cookie` does NOT work — the login token is HttpOnly.
Alternative: F12 → Application → Cookies → copy `ltoken_v2`/`ltmid_v2`/`ltuid_v2`.)
From then on:

- live energy/stamina/battery snapshots (+ HSR reserve), caps auto-corrected
- dailies auto-ticked when finished & claimed; expeditions, realm currency,
  weekly discounts, transformer & co. shown as chips on the card
- refreshes every 5 min while open; the deployed worker also refreshes on its
  10-minute cron, so Discord/Telegram alerts fire on live values while
  everything is closed
- **Timeline → ⤓ HoYoLAB** imports current events & banners from the public
  announcement feeds (GI + ZZZ are rich; HSR publishes via its in-game
  calendar, so its feed is often empty)

Requests go through your own worker (or the local launcher) — cookies are
stored only in your synced state. They expire after a few months; re-paste when
errors show up. Endpoints are community-documented, not official API — a patch
can occasionally move a field.

## Stats & spending (📊 tab)

- **Premium currency projection**: enter your balance + average income/day
  (include Welkin/BP drip) + the next patch date — get "now ≈ X · at patch ≈ Y
  → Z pulls". Re-enter the balance after pulling; the patch date rolls forward
  by the patch length automatically.
- **Purchases**: track Welkin/monthly cards (30d) and Battle Passes (per
  patch). Expiring ones warn on the game card (🛒) and ping via Discord/
  Telegram 48h before; "Renewed ✓" pushes the expiry one cycle out.
- Waste + streak + heatmap for every game, in one place.

## Getting events in

- **📦 Bundled feed** (Timeline): the app ships with the current patches' events in
  [app/src/data/seed-events.ts](app/src/data/seed-events.ts). Whenever that file
  contains events (or corrected dates) your device doesn't have, the Timeline shows
  an "📦 Import N" button — one click imports everything, deduped against HoYoLAB
  imports and manual entries. After a new patch, ask Claude to refresh the file
  (it pulls the official announcement feeds + patch notes), `npm run build`, reopen,
  click import. Entries whose exact dates weren't announced yet carry a "TBC —
  verify in-game" note and don't fire alerts until a refresh confirms them.
- **⤓ HoYoLAB** (Timeline): automatic import for Genshin/ZZZ from the public
  announcement feeds.
- **📋 Paste (AI)** (Timeline): for every other game — copy the generated
  prompt, hand it to any AI, paste the JSON it returns, review, import.
  Handles code fences and skips malformed rows; times are read in the game's
  server timezone.

## The daily loop

1. Play your game(s).
2. Open TechnoGG and punch in what's actually left, right on the card: click the
   value box and type, or step with the keyboard — **A −10 · S −1 · D +1 · F +10**,
   Enter saves. Click the cap number ("/200") to change it when your max shifts
   (rank-ups, events). Tick the dailies. (HoYo games: auto-imported.)
3. That's it — projections and alerts recalibrate from your entry.

## Quality of life

- **Focus list** (Stats tab): what to build/farm next; the top goal is
  pinned on the card.
- **Teams** (Stats tab): save your comps (e.g. three ZZZ squads); click a
  member to flag them 🔧 needs building — flagged names show on the card.
- Game ⚙ is deliberately lean: identity, resets, resources, tasks. Everything
  else lives where it belongs (events → Timeline, the rest → Stats).
- **Endgame cycles** ship as preset tasks with real 2026 cadences (Stygian 35d,
  HSR endgame refresh 14d, Shiyu/Deadly Assault 14d, ToA/WhiWa 28d, …) — all
  editable per game via ⚙ → Tasks, like everything else.
- **Stats** (game ⚙ → Stats): regen wasted at cap (today / 7 days) and a
  12-week dailies heatmap with your current streak (🔥 on the card from 2 days).
- **Safe to sleep**: evenings (20:00–05:00) each card shows 🌙 — either "sleep
  safe" or the time it caps within your sleep window (Settings → sleepHours).
- **Stable card order**: cards never re-sort themselves while you're entering
  values — when urgency changes, a "↻ Sort by urgency" button appears instead.
- **Reset warnings**: undone tasks turn amber under 2 hours from their reset
  and pulse red with a countdown under 20 minutes.

## After a patch / new event

- **New banner/event:** Timeline → *+ Event* (10 seconds; toggle "daily touch" if it needs logins).
- **Cap or regen changed:** game card → ⚙ → edit the number.
- **New game:** Dashboard → *Add game* → pick a preset or make a custom one.
- Preset defaults live in [shared/src/presets.ts](shared/src/presets.ts) if you want to fix them at the source.

## Notes

- Preset values (caps, rates, reset times) are best-effort defaults — verify against your
  server/rank and edit in the app. The NTE preset is explicitly marked as needing
  verification.
- Sync is last-write-wins per row — fine for one human on two devices.
- Export a JSON backup from Settings whenever you feel paranoid.
