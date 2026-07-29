# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Gacha players who run **several games at once** and lose value to the games'
clocks rather than to their own skill: energy regenerating past its cap while
they sleep, dailies missed before a server reset, a banner or endgame window
closing unnoticed.

The primary user is a multi-game player on **PC and phone**, checking in one to
a few times a day around actual play sessions. The confirmed reference roster is
Genshin Impact, Honkai: Star Rail, Zenless Zone Zero, Wuthering Waves, Neverness
to Everything, Uma Musume and Dokkan — five of which ship as editable presets.

This is intended as **a real public product**, not a personal tool. Design must
hold up for someone who has never seen it: first run, empty states, and account
setup are in scope, and the hosted deployment (Clerk auth, D1 sync, scheduled
operational cleanup) is a product surface rather than private infrastructure.

## Product Purpose

One dashboard for every gacha a player runs, answering a single recurring
question: **what am I about to waste, and when?**

It projects each game's energy forward from the last reading, tracks
dailies/weeklies/monthlies against each game's _own server reset_, holds an
event and banner timeline, and keeps upcoming caps, resets and deadlines visible
in the app. Success is the player seeing what needs attention before it caps,
expires, or resets.

## Positioning

Three things a neighbouring tracker could not truthfully claim:

- **Everything is editable data, not baked-in.** Caps, regen rates, reset hours,
  reserve behaviour, task cadences and endgame cycles all ship as presets the
  user can correct in the app in seconds when a patch changes them. The product
  never becomes wrong for longer than it takes to type a number.
- **Correct per-game server time, not one global clock.** Each game carries its
  own IANA timezone, daily reset hour, weekly reset weekday and monthly reset
  day; periods and urgency are computed against that.
- **Useful with no account and no network.** The PWA is fully functional against
  IndexedDB alone. The worker adds authenticated cross-device sync, and an
  account is not required to get value.

## Operating Context

- **The daily loop**: play → open Void → type what's actually left on each card
  (direct entry, or keyboard stepping **A −10 · S −1 · D +1 · F +10**, Enter
  saves) → tick dailies → close. Projections and next actions recalibrate from that
  entry. The loop must stay measured in seconds.
- **Two devices, two postures**: a large desktop window (the primary surface,
  authored against 1440p) and a phone PWA used mid-session or in bed.
- **A Windows desktop launcher** opens the app in its own chromeless window on
  fixed port `17817` and serves the canonical local `state.json`.
- **Urgency stays in the app** — upcoming caps, resets, event deadlines and
  reminders appear in dashboard next actions while Void is open.
- **Evening check ("safe to sleep")**: between 20:00 and 05:00 each card must
  answer whether the resource survives the user's sleep window.
- **Events arrive in bulk**, either from the bundled seed feed (an "Import N"
  affordance on the Timeline) or by pasting AI-generated JSON.

## Capabilities and Constraints

**Domain objects** the UI must express: Game, Resource (regen / weekly / counter
kinds, with an overflow _reserve_ twin), Snapshot, Task (check / timer / count
modes; daily, weekly, monthly or custom cadence; optionally linked to a Timeline
window), Completion, GameEvent (banner / event / cycle / maintenance / custom),
QuickChip spend shortcuts, Reminder, Settings. AlertRule remains in the synced
model for compatibility and a possible future delivery channel, but has no
current UI or worker behavior.

**Confirmed constraints:**

- React 19 + Vite + Tailwind v4 PWA; Radix primitives for dialog, select,
  switch, toggle-group and tooltip; Motion for animation; Zustand for state.
- Offline-first against IndexedDB; last-write-wins merge on `updatedAt`, with
  soft-delete tombstones. Every syncable object is a merge participant.
- A **PWA size budget** is enforced in CI (`npm run check:pwa`), alongside lint,
  format, typecheck, unit tests and Playwright e2e including axe accessibility
  checks. Design work must survive `npm run check`.
- **All domain maths lives in `shared/`** — energy projection, reset periods,
  urgency, merge. The app layer presents; it does not compute.
- Cards must **not re-sort themselves** while the user is entering values; an
  explicit "Sort by urgency" affordance appears instead.
- Preset values are best-effort and explicitly fallible; the NTE preset is
  marked as needing verification. The UI must never present preset numbers as
  authoritative.

**Deliberately undecided:** whether a public marketing or landing surface should
exist. The product currently has no persuasion surface at all — the app shell is
the entire front door — which is a real gap now that the audience is public.

## Brand Commitments

**None are binding.** The user has confirmed the name, the mark and the visual
world are all open.

Current state, recorded as incumbent evidence rather than as commitment:

- The product is named **Void** (renamed from TechnoGG → Techno's Library →
  Void). The mark is a Möbius band with a gap where it crosses itself, on a
  gold-on-black icon.
- The interface voice is terse, second-person and unceremonious ("what am I
  about to waste"), with lowercase status phrases like "sleep safe".
- **Per-game identity is a product feature, not decoration**: every game carries
  its own accent colour, gradient partner colour, emoji or cover image, and its
  own CSS title font (five bundled options spanning fantasy serif to wide tech).
  Any design system must host that variability rather than flatten it.

## Evidence on Hand

- Real, shipped, working implementation across `app/`, `shared/`, `worker/`,
  with unit, e2e and accessibility tests.
- A bundled seed event feed at
  [app/src/data/seed-events.ts](src/data/seed-events.ts) carrying current-patch
  events, including entries explicitly flagged "TBC — verify in-game".
- Five game presets in [shared/src/presets.ts](../shared/src/presets.ts).
- Deployment, security and incident runbooks under `docs/`.

**No** testimonials, user counts, reviews, press, pricing, benchmarks or
customer logos exist. Future work must not fabricate any of them.

## Product Principles

1. **The clock is the antagonist.** Every surface earns its place by making a
   deadline visible earlier than the player would have noticed it.
2. **Entry is the hot path.** Reading a number and typing a number must be the
   fastest thing in the product; nothing may reflow, re-sort, or animate in a
   way that costs the user a keystroke.
3. **Presets are guesses; the user is the authority.** Anything the product
   asserts about a game must be visibly editable, and uncertainty must be shown,
   not hidden.
4. **Each game keeps its face.** Identity per game is functional — it is how the
   user finds the right card in under a second.
5. **Offline is the baseline, not the degraded mode.** No surface may present
   account or sync state as a precondition for value.

## Accessibility & Inclusion

- WCAG **AA contrast** is an established, enforced floor: caption colours in the
  token layer carry comments recording the ratio they were lightened to clear on
  the near-black canvas.
- Full **keyboard operation** is a product requirement, not a courtesy — the
  primary entry gesture is keyboard-first (A/S/D/F stepping).
- `prefers-reduced-motion` is honoured globally today and must remain so.
- Axe checks run in Playwright e2e and are part of the launch gates.
- Colour must never be the sole carrier of urgency; countdowns and text already
  accompany the amber/red states and must continue to.
