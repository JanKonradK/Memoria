---
name: Void
description: A dark shelf that stays out of the way so each game keeps its own face.
colors:
  surface-void: '#000000'
  surface-shelf: '#0b0a12'
  surface-riser: '#141020'
  surface-float: '#2b2347'
  fg: '#f8fafc'
  fg-soft: '#e2e8f0'
  fg-muted: '#94a3b8'
  fg-dim: '#6e7d93'
  fg-faint: '#475569'
  fg-invert: '#0b0a12'
  accent: '#7c5cff'
  accent-2: '#d946ef'
  accent-fg: '#c4b5fd'
  gold: '#e8b45a'
  gold-hi: '#f5d68a'
  gold-lo: '#c78a2e'
  rose: '#ff6fa5'
  ok: '#34d399'
  ok-fg: '#6ee7b7'
  warn: '#fbbf24'
  warn-fg: '#fde68a'
  danger: '#f43f5e'
  danger-fg: '#fda4af'
  fill-1: 'rgba(255, 255, 255, 0.03)'
  fill-2: 'rgba(255, 255, 255, 0.06)'
  fill-3: 'rgba(255, 255, 255, 0.10)'
  fill-4: 'rgba(255, 255, 255, 0.16)'
  line-hairline: 'rgba(255, 255, 255, 0.08)'
  line-edge: 'rgba(255, 255, 255, 0.14)'
  line-strong: 'rgba(255, 255, 255, 0.22)'
  line: 'rgba(200, 180, 255, 0.12)'
  scrim-well: 'rgba(0, 0, 0, 0.35)'
  scrim-veil: 'rgba(0, 0, 0, 0.60)'
  scrim-modal: 'rgba(0, 0, 0, 0.85)'
typography:
  hero:
    fontFamily: "var(--game-title-font, ui-rounded, 'Segoe UI', system-ui, sans-serif)"
    fontSize: '3rem'
    fontWeight: 900
    lineHeight: '3.25rem'
    letterSpacing: '-0.02em'
  display:
    fontFamily: "var(--game-title-font, ui-rounded, 'Segoe UI', system-ui, sans-serif)"
    fontSize: '2.25rem'
    fontWeight: 900
    lineHeight: '2.5rem'
    letterSpacing: '-0.02em'
  heading:
    fontFamily: "ui-rounded, 'Segoe UI', system-ui, sans-serif"
    fontSize: '1.5rem'
    fontWeight: 900
    lineHeight: '2rem'
    letterSpacing: '-0.01em'
  title:
    fontFamily: "ui-rounded, 'Segoe UI', system-ui, sans-serif"
    fontSize: '1.125rem'
    fontWeight: 700
    lineHeight: '1.75rem'
  lead:
    fontFamily: "ui-rounded, 'Segoe UI', system-ui, sans-serif"
    fontSize: '1rem'
    fontWeight: 700
    lineHeight: '1.5rem'
  body:
    fontFamily: "ui-rounded, 'Segoe UI', system-ui, sans-serif"
    fontSize: '0.875rem'
    fontWeight: 400
    lineHeight: '1.25rem'
  meta:
    fontFamily: "ui-rounded, 'Segoe UI', system-ui, sans-serif"
    fontSize: '0.75rem'
    fontWeight: 500
    lineHeight: '1.125rem'
  label:
    fontFamily: "ui-rounded, 'Segoe UI', system-ui, sans-serif"
    fontSize: '0.6875rem'
    fontWeight: 600
    lineHeight: '1rem'
    letterSpacing: '0.06em'
  caption:
    fontFamily: "ui-rounded, 'Segoe UI', system-ui, sans-serif"
    fontSize: '0.625rem'
    fontWeight: 900
    lineHeight: '0.875rem'
    letterSpacing: '0.08em'
rounded:
  sm: '0.375rem'
  md: '0.5rem'
  lg: '0.75rem'
  xl: '1rem'
  card: '1.5rem'
  full: '9999px'
spacing:
  hair: '0.25rem'
  tight: '0.5rem'
  snug: '0.75rem'
  base: '1rem'
  loose: '1.5rem'
  section: '2rem'
components:
  button-primary:
    backgroundColor: '{colors.accent}'
    textColor: '#ffffff'
    rounded: '{rounded.lg}'
    padding: '0.5rem 1rem'
    height: '2.75rem'
    typography: '{typography.body}'
  button-primary-hover:
    backgroundColor: '{colors.accent-2}'
  button-ghost:
    backgroundColor: '{colors.fill-2}'
    textColor: '{colors.fg-soft}'
    rounded: '{rounded.lg}'
    padding: '0.5rem 1rem'
    height: '2.75rem'
    typography: '{typography.body}'
  button-ghost-hover:
    backgroundColor: '{colors.fill-3}'
  button-danger:
    backgroundColor: '{colors.fill-2}'
    textColor: '{colors.danger-fg}'
    rounded: '{rounded.lg}'
    padding: '0.5rem 1rem'
    height: '2.75rem'
  input:
    backgroundColor: '{colors.fill-2}'
    textColor: '{colors.fg}'
    rounded: '{rounded.lg}'
    padding: '0.5rem 0.75rem'
    height: '2.75rem'
    typography: '{typography.body}'
  input-focus:
    backgroundColor: '{colors.fill-3}'
  card:
    backgroundColor: '{colors.surface-shelf}'
    textColor: '{colors.fg-soft}'
    rounded: '{rounded.card}'
    padding: '1rem'
  row:
    backgroundColor: '{colors.fill-1}'
    textColor: '{colors.fg-soft}'
    rounded: '{rounded.lg}'
    padding: '0.5rem 0.75rem'
    height: '2.25rem'
  pill:
    backgroundColor: '{colors.fill-2}'
    textColor: '{colors.fg-dim}'
    rounded: '{rounded.sm}'
    padding: '0 0.25rem'
    typography: '{typography.caption}'
  pill-warn:
    backgroundColor: '{colors.fill-2}'
    textColor: '{colors.warn-fg}'
  popover:
    backgroundColor: '{colors.surface-float}'
    textColor: '{colors.fg-soft}'
    rounded: '{rounded.lg}'
    padding: '0.25rem'
---

# Design System: Void

## Overview

**Creative North Star: "The Collector's Shelf"**

Void holds five, ten, fifteen games at once, and each one already has a face —
its own accent, its own gradient partner, its own title font, its own cover art.
The system's job is not to have a personality. Its job is to be **the shelf**: a
dark, even, precisely-built structure that recedes so completely that the eye
lands on the objects sitting on it. Every design decision is judged by one
question: does this make the shelf more visible, or the games more visible? The
shelf always loses.

That produces a specific kind of restraint. The chrome is achromatic — blacks,
whites at low alpha, and a grey text ramp. Chromatic color on the shelf itself
is rationed to exactly two jobs: **the accent violet marks what is
interactive**, and **the status trio marks what is about to go wrong**. Anything
else colored on screen is a game asserting itself, which is the point. When a
card glows amber, that is not decoration; the user has ninety minutes before
something resets.

Density is deliberately high — this is an Operate surface for someone checking
in at speed, several games deep, often twice a day. Rows are 36px, type runs
small and tight, and whitespace is spent on separating _games_ from each other
rather than on padding inside them. The interface should feel like a well-made
rack, not a poster.

**Key Characteristics:**

- True black canvas (`#000000`), never a dark grey — the shelf disappears on OLED
- Achromatic chrome; all saturated color is either a game's identity or a warning
- Depth by tonal step and 1px hairline, never by drop shadow (except what floats)
- Small, tight, tabular type; numerals are the content
- Per-game title fonts and accents are load-bearing, not ornament
- Nothing re-sorts, reflows, or animates while the user is entering a number

## Colors

An achromatic shelf carrying a rationed accent, a three-note status language, and
whatever colors the games themselves bring.

### Primary

- **Signal Violet** (`#7c5cff`): the only color that means "you can act on this".
  Primary buttons, active nav, focus rings, selected states. Never used as a
  background wash, never as decoration on a card.
- **Signal Magenta** (`#d946ef`): the gradient partner and hover destination for
  Signal Violet. It exists to give the primary action a direction, not to be used
  alone.
- **Lilac Ink** (`#c4b5fd`): accent-colored _text_ and iconography on dark, where
  Signal Violet itself would fail contrast at small sizes.

### Secondary

- **Shelf Gold** (`#e8b45a`): the aggregate/overview register. Reserved for
  cross-game surfaces — the Event Horizon panel, the nav rail's active hex, the
  app mark. Gold says "this is about all your games at once".
- **Signal Rose** (`#ff6fa5`): reserved for the timeline's now-marker and
  deadline emphasis. Distinct from danger red on purpose.

### Tertiary

The status trio. Each carries a **base** (fills, strokes, rings) and an **-fg**
(text and icons on dark), because the base values do not clear AA at caption
sizes.

- **Safe Green** (`#34d399` / text `#6ee7b7`): done, sleep-safe, complete.
- **Reset Amber** (`#fbbf24` / text `#fde68a`): under two hours to a reset;
  attention, not alarm.
- **Waste Red** (`#f43f5e` / text `#fda4af`): capped, overflowing, or under
  twenty minutes. The strongest thing on screen.

### Neutral

- **Void** (`#000000`): the page canvas. Pure black, no ambient gradient wash.
- **Shelf** (`#0b0a12`): cards and panels — a near-black with a whisper of violet.
- **Riser** (`#141020`): raised regions _inside_ a card, and tooltips.
- **Float** (`#2b2347`): popovers and select menus only — the one surface that is
  genuinely above the page.
- Text ramp: **Bright** (`#f8fafc`) primary → **Soft** (`#e2e8f0`) secondary →
  **Muted** (`#94a3b8`) tertiary → **Dim** (`#6e7d93`, the AA floor for caption
  text on black) → **Faint** (`#475569`, decorative strokes only, never text).
- **Invert** (`#0b0a12`): text sitting on a light or accent-filled surface.

### The Overlay Ladder

On-card surfaces are white at low alpha rather than opaque greys, so a game's
accent tint reads through them. Four steps, and only four:

- `fill-1` (3%): zone backgrounds, alternating rows
- `fill-2` (6%): resting controls — inputs, ghost buttons, pills
- `fill-3` (10%): hover
- `fill-4` (16%): active, selected, pressed

Borders are the same idea in three white steps — `line-hairline` (8%) for the
default 1px rule, `line-edge` (14%) for an emphasised control edge, and
`line-strong` (22%) for selected controls and Float surfaces — plus one
chromatic exception, `line` (violet-white 12%), which is the card perimeter and
nothing else.

### Named Rules

**The Shelf Is Grey Rule.** No chrome element may name a chromatic color. If a
pixel is saturated, it is a game's identity, an interactive affordance, or a
warning — and you must be able to say which of the three out loud.

**The Two-Slot Status Rule.** Never paint status text in the base status color.
Base values (`ok`, `warn`, `danger`) are for fills, rings and strokes; the `-fg`
values are for text and icons. Mixing them is the most common contrast failure
in this codebase.

**The No Raw Palette Rule.** A component may not reference a Tailwind palette
class — no `text-slate-300`, no `bg-rose-400/10`, no `ring-amber-300/25`. Every
color arrives through a token. There are no exceptions for "just this one label".

## Typography

**UI Font:** `ui-rounded, 'Segoe UI', system-ui, -apple-system, sans-serif` —
the system's rounded face, which reads warm at small sizes without costing a
download.

**Game Title Fonts:** five bundled families, chosen per game and stored on
`Game.titleFont`: Marcellus (fantasy serif), Rajdhani (sci-fi condensed),
Archivo Black (heavy urban), Michroma (wide tech), Baloo 2 (playful rounded).

**Character:** the shelf speaks in one quiet rounded voice at small sizes and
heavy weights; the games shout in five different ones. That contrast is the
typographic idea of the whole product. A game's title is the only place a second
family is permitted.

### Hierarchy

- **Hero** (900, 3rem, −0.02em): the focus-layout game name and the auth
  landing headline. Two places in the product; if you need a third, you don't.
- **Display** (900, 2.25rem, −0.02em): game names on a normal card, in that
  game's own family.
- **Heading** (900, 1.5rem, −0.01em): page-level `<h1>` — Settings, Event
  timeline, error and auth screens.
- **Title** (700, 1.125rem): panel and card headings within a page.
- **Lead** (700, 1rem): sheet and dialog titles, the primary CTA.
- **Body** (400, 0.875rem/1.25rem): default running text, inputs, task names.
- **Meta** (500, 0.75rem/1.125rem): secondary running text — countdowns, hints,
  helper lines, table cells. The single largest category in the app.
- **Label** (600, 0.6875rem, 0.06em, uppercase): field labels, section headers.
- **Caption** (900, 0.625rem, 0.08em, uppercase): pills, badges, unit suffixes.
  **This is the floor.** Nothing renders smaller.

Numerals in any resource value, countdown, cap or delta are **tabular** without
exception, so digits do not jitter while a value is being stepped.

### Named Rules

**The Ten-Pixel Floor Rule.** 0.625rem is the smallest type in the product. The
former 0.5rem `micro` step is retired — 8px uppercase text on black is not
readable, and every former use folds up into Caption.

**The One Family Per Card Rule.** A card may show exactly two families: the
game's title font on its name, and the UI font on everything else. Game fonts
never leak into rows, pills, or numerals.

**The Three Voices Rule.** A game card speaks at exactly three sizes, and you
must be able to name each one: the game's **name** (Display/Heading), the
**resource readout** (Title, 900, in the game's accent — the only element at
that size), and the **list** (Body). Metadata sits below all three. If the
number the user opened the app to read is the same size as a task name, the
card has no hierarchy — that is the state this rule exists to prevent.

## Layout

A single page container — `max-width: 2160px`, `padding-inline: 0.75rem`
(`1.5rem` from 40rem up) — is shared by every tab so edges align across
navigation. Bottom padding always reserves the floating nav rail's height
(`7rem`, `6rem` from 64rem up); content laid out beneath the rail is genuinely
unclickable.

**Breakpoints** follow Tailwind's defaults, with `40rem` (sm) as the one that
matters most: it is where row heights compress from touch (`2.75rem`) to
pointer (`2.25rem`), and where maintenance rows collapse to `1.5rem`. Controls
are `min-height: 2.75rem` below `40rem` and `2.25rem` above — a real touch
target on the phone, a dense one on the desktop the product is authored for.

**The dashboard has two spatial modes.** _Cards_ is a masonry of independent
game cards. _Nexus_ is a three-column stage — left rail, hub, right rail — whose
columns redistribute on focus via a `grid-template-columns` transition
(`0.34s cubic-bezier(0.4, 0, 0.2, 1)`); the focused rail gains space, the hub
compresses, the far rail yields. Expanding a card animates
`grid-template-rows: minmax(0, 0fr) → minmax(0, 1fr)`, never `height: auto`.

**Rhythm** is a six-step spacing scale — `0.25 / 0.5 / 0.75 / 1 / 1.5 / 2rem`.
Gaps _between_ game cards use the top of that scale; padding _inside_ them uses
the bottom. Space separates games from each other, not content from its own
container.

### Named Rules

**The Stable Order Rule.** Card order never changes as a side effect of data
changing. When urgency reordering becomes available, it appears as an explicit
control the user presses. A layout that reflows under the cursor costs a
keystroke, and entry is the hot path.

## Elevation & Depth

**This system does not use drop shadows for depth.** Depth is a tonal step plus
a 1px hairline, and nothing else. On a true-black OLED canvas a soft shadow is
invisible where it should be subtle and a grey smear where it is not; the
layered-glass treatment the codebase grew was paying full raster cost for an
effect the panel never actually showed.

Three levels, and a card may only ever be one step above what it sits on:

- **Flush** — `fill-1` over the parent, no border. Zones and alternating rows.
- **Raised** — `surface-shelf` (or `fill-2` on a card) with a `line-hairline`
  inset ring and a 6% white top-edge highlight. Cards, panels, controls.
- **Float** — `surface-float`, `line-strong` ring, _and_ a real shadow, because
  it genuinely leaves the page. Only three things qualify: modal dialogs,
  popovers/selects, and the floating nav rail.

### Shadow Vocabulary

- **Float** (`box-shadow: 0 16px 48px -24px rgba(0,0,0,0.9)`): the only shadow
  token. Applies solely to the three Float-level surfaces above.

### Named Rules

**The One Step Rule.** A surface may sit exactly one tonal level above its
parent. A card inside a card inside a panel is a layout mistake, not a depth
opportunity.

**The Shadows Float Only Rule.** If it does not overlay the page, it gets no
shadow. Cards, rows, buttons, inputs, and pills are all shadowless.

## Shapes

Corners are generous and consistent, on a six-step radius scale: `0.375rem`
(pills, tooltips), `0.5rem` (menu items, small controls), `0.75rem` (buttons,
inputs, rows — the workhorse), `1rem` (inner panels), `1.5rem` (game cards, the
signature radius), and full (badges, ticks, toggles, nav hexes).

The recurring silhouette is the **stadium**: a shape with circular caps and flat
sides that stretches to fit its label. It is used for the game badge, energy
pills, and the nav rail, and it exists because user-authored short codes vary in
width — a fixed circle or hexagon clips `WuWa` where a stadium does not.

The second signature form is the **incomplete ring**: a 20px circle with a
deliberate gap in its stroke, used for task ticks, timer progress, segmented
counts, and around every game badge. The gap is the language — it reads as
"not finished yet" even where no progress data exists (default sweep `0.82`).

## Components

### Buttons

- **Shape:** workhorse radius (`0.75rem`), `2.75rem` tall on touch, `2.25rem`
  from `40rem` up.
- **Primary:** Signal Violet → Signal Magenta gradient, white text, `line-edge`
  ring. Exactly one per view. No shadow.
- **Ghost:** `fill-2` background, Soft text, `line-hairline` ring; hover to
  `fill-3`. The default for everything that is not _the_ action.
- **Danger:** `fill-2` background with Waste Red _-fg_ text and a danger-tinted
  ring — destructive actions are named by their text, not by a red slab.
- **Hover / Active:** brightness and fill step only; `active:scale(0.97)`.
  Transitions run `140ms` on the standard ease.

### Cards / Containers

- **Corner:** `1.5rem` — the signature radius; nothing else in the app uses it.
- **Background:** `surface-shelf`, with the game's accent permitted as a very
  low-alpha tint so the card reads as belonging to that game.
- **Border:** 1px `line-edge` inset ring plus a 6% white top highlight.
- **Shadow:** none.
- **Padding:** `1rem`; `0.75rem` on the phone.
- **Urgent state:** a 2px inset `danger` ring animating opacity `0.25 → 1` over
  `2.2s`. Animated on a pseudo-element, never on the card's own `box-shadow`.

### Inputs / Fields

- **Style:** `fill-2` background, `line-hairline` ring, workhorse radius, Body
  type, Dim placeholder. Number inputs are tabular and ship without native
  spinners — the product provides its own steppers.
- **Focus:** background steps to `fill-3`; the focus ring is a 2px outline in
  `color-mix(in oklab, accent 70%, white)` that follows the element's own radius.
- **Compound editors** expose exactly one ring around the whole pill via
  `.focus-ring-group`, never a second one around the inner input.

### Pills

- **Style:** `fill-2` background, Caption type, uppercase, `0.375rem` radius,
  `0.25rem` horizontal padding.
- **Variants:** neutral (Dim text), warn (`warn-fg`), paused (Muted), and a dark
  variant (`scrim-well` over a light card image).

### Navigation

- A floating rail of circular hexes, bottom-left, Float elevation. Active hex is
  ringed in Shelf Gold with a Caption uppercase label beneath.
- The rail's background is click-through, but the hexes are not — any content
  laid out beneath them is unreachable, which is why the page container always
  reserves rail clearance.

### Game Badge (signature)

The game's short code set in its own accent color, inside a stadium tinted with
a `accent → accent-2` gradient at 14–22% alpha, wrapped in an incomplete ring
whose sweep encodes checklist progress (`0.82` when no data is available). Three
sizes — 20 / 24 / 32px — sized by inline padding rather than an estimated
per-character width, because estimation undercounts wide glyphs.

### Energy Row (signature)

The hot path. A whole-pill click target carrying the resource name, a tabular
current/cap readout, and stepper controls bound to **A −10 · S −1 · D +1 ·
F +10** with Enter to save. It may grow a collapsible twin row for reserve
capacity. Nothing in this component may animate on data change.

## Do's and Don'ts

### Do:

- **Do** route every color through a token. The palette is closed.
- **Do** use `-fg` status values for text and base status values for fills.
- **Do** express depth as one tonal step plus a `line-hairline` ring.
- **Do** keep numerals tabular anywhere a value can change.
- **Do** let the game's accent, cover art and title font carry the personality of
  a card; keep the card's own chrome grey.
- **Do** reserve Shelf Gold for genuinely cross-game surfaces.
- **Do** animate `grid-template-rows`, `opacity` and `transform` — properties the
  compositor can handle — and put pulses on pseudo-elements.
- **Do** honour `prefers-reduced-motion` on every new animation.

### Don't:

- **Don't** name a Tailwind palette color in a component. Not once.
- **Don't** put a drop shadow on anything that does not overlay the page.
- **Don't** render text below `0.625rem`.
- **Don't** introduce a fifth overlay alpha, a fourth border alpha, or a ninth
  type step. The ladders are closed; if something needs a value between two
  steps, one of the two is wrong.
- **Don't** use a native `title` attribute for tooltips — the browser leaves them
  on screen after the element is gone. Use the Radix `Tooltip`.
- **Don't** let a card re-order, reflow or resize itself in response to data
  arriving while the user may be typing.
- **Don't** let a game's title font escape onto rows, pills or numerals.
- **Don't** wash the canvas with an ambient gradient. It is `#000000`.
