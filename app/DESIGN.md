---
name: Memoria
description: Jewelry on charcoal — chrome panels that recede so each game's own colour reads as an edge, a title and a tube.
colors:
  ground: '#000000'
  surface-hi: '#131316'
  surface-lo: '#0c0c0e'
  surface-hover-hi: '#1a1a1e'
  surface-hover-lo: '#121215'
  inset: '#08080a'
  line: '#232329'
  line-strong: '#34343c'
  text: '#f4f4f6'
  text-dim: '#9a9aa4'
  text-mute: '#63636d'
  critical: '#ff5a48'
  critical-bg: '#241009'
  soon: '#f0a83c'
  soon-bg: '#231a08'
  ok: '#46c795'
  later: '#74747e'
  tag-event: '#5b8def'
  tag-banner: '#c084fc'
  tag-cycle: '#46c795'
  tag-patch: '#938c7b'
  tag-maintenance: '#ff5a48'
  tag-daily: '#f0a83c'
  tag-weekly: '#80f4ff'
typography:
  title:
    fontFamily: "var(--game-title-font, 'DM Sans', system-ui, sans-serif)"
    fontSize: '1.0625rem'
    fontWeight: 600
    lineHeight: '1.5rem'
    letterSpacing: '-0.01em'
  heading:
    fontFamily: "'DM Sans', system-ui, sans-serif"
    fontSize: '1.25rem'
    fontWeight: 600
    lineHeight: '1.75rem'
  lead:
    fontFamily: "'DM Sans', system-ui, sans-serif"
    fontSize: '1rem'
    fontWeight: 500
    lineHeight: '1.5rem'
  body:
    fontFamily: "'DM Sans', system-ui, sans-serif"
    fontSize: '0.8125rem'
    fontWeight: 400
    lineHeight: '1.125rem'
  meta:
    fontFamily: "'DM Sans', system-ui, sans-serif"
    fontSize: '0.75rem'
    fontWeight: 400
    lineHeight: '1rem'
  label:
    fontFamily: "'DM Sans', system-ui, sans-serif"
    fontSize: '0.625rem'
    fontWeight: 500
    lineHeight: '0.875rem'
    letterSpacing: '0.09em'
  numeral:
    fontFamily: "'IBM Plex Mono', ui-monospace, monospace"
    fontSize: '0.875rem'
    fontWeight: 500
    lineHeight: '1.125rem'
    letterSpacing: '-0.01em'
  numeral-lead:
    fontFamily: "'IBM Plex Mono', ui-monospace, monospace"
    fontSize: '1.75rem'
    fontWeight: 500
    lineHeight: '2rem'
    letterSpacing: '-0.02em'
rounded:
  xs: '4px'
  sm: '6px'
  md: '10px'
  lg: '14px'
  game: '22px'
  pill: '999px'
spacing:
  xs: '4px'
  sm: '8px'
  md: '12px'
  lg: '16px'
  xl: '24px'
  xxl: '40px'
components:
  panel:
    backgroundColor: 'linear-gradient(180deg, {colors.surface-hi}, {colors.surface-lo})'
    textColor: '{colors.text}'
    rounded: '{rounded.md}'
    padding: '12px'
  card:
    backgroundColor: 'raking gradients from gameRim(trio) over gameWash(primary)'
    borderColor: 'none — urgency only'
    boxShadow: 'inset top highlight + neutral cast'
    rounded: '{rounded.game}'
    padding: '12px'
  button-primary:
    backgroundColor: '{colors.inset}'
    textColor: '{colors.text}'
    borderColor: '{colors.line-strong}'
    rounded: '{rounded.sm}'
    padding: '5px 12px'
  button-ghost:
    backgroundColor: 'transparent'
    textColor: '{colors.text-dim}'
    borderColor: '{colors.line}'
    rounded: '{rounded.sm}'
    padding: '5px 12px'
  input:
    backgroundColor: '{colors.inset}'
    textColor: '{colors.text}'
    borderColor: '{colors.line}'
    rounded: '{rounded.sm}'
    padding: '5px 8px'
    typography: '{typography.numeral}'
  chip:
    backgroundColor: 'mix(tag-kind, {colors.inset}, 32%)'
    textColor: 'mix(tag-kind, #ffffff, 78%)'
    rounded: '{rounded.xs}'
    padding: '2px 6px'
    typography: '{typography.label}'
  tube:
    backgroundColor: '{colors.inset}'
    rounded: '{rounded.pill}'
    height: '10px'
---

# Design System: Memoria

## Overview

**Creative North Star: "Jewelry on charcoal"**

Memoria holds five, ten, fifteen games at once. Each one arrives with colours the
owner chose, and those colours are the only way the eye finds the right card in
under a second. The chrome's job is to be a machined charcoal housing that
recedes against an OLED ground, so the identity reads as **an edge, a title, and
a tube** — saturated and small — rather than as a painted wall.

That is the whole discipline. A **panel** stays charcoal and lets the identity sit
on its edge; a **game card** goes further and takes a raking cast from the game's
own chromatic colour, because a card is a thing you pick out of a rail rather than
a region of the page. Everything saturated is either a game asserting itself in
one of three specific roles, or urgency telling the user something is about to be
lost. Those two systems never occupy the same pixel job, and when
they collide, **urgency wins**: a critical card takes a red ring even though it is
otherwise the only thing in the product allowed to go unoutlined.

Density is high and deliberate. This is an Operate surface for someone checking
in at speed, several games deep, once or twice a day. Numbers are the content, so
every number in the product is tabular mono, and nothing may animate in a way
that delays reading one.

**Key characteristics:**

- OLED ground (`#000000`); chrome panels are a two-stop charcoal gradient with a
  grain tile, never a flat fill
- Depth from tone, gradient and grain; cards add a top highlight and a neutral cast
- Identity is a trio per game: raking cast, title ink, top highlight
- Two type voices only: DM Sans for language, IBM Plex Mono for every number
- Per-game display faces are data, not decoration
- Resources are containment tubes; completion is a ring, never a square

## Colors

### Ground and chrome

- **Ground** (`#000000` dark / `#EFEAE0` light): the canvas. On dark this is
  literal OLED black, which is also why a card's depth has to come from inside
  it. On light it is cream paper, never white.
- **Surface** (`#131316 → #0C0C0E` dark / `#F3EEE4 → #EBE4D6` light): every
  chrome panel, as a two-stop vertical gradient. The gradient is what makes light
  appear to fall from above; a flat fill at this size bands and reads plastic.
- **Surface hovered** (`#1A1A1E → #121215`): one step up, gradient preserved.
- **Inset** (`#08080A` dark / `#E4DDD0` light): flat fill for small parts that
  should not carry their own light — inputs, tube tracks, chip backgrounds,
  segmented-control wells.
- **Line** (`#232329`) and **Line strong** (`#34343C`): the 1px vocabulary.
  Hairline for resting edges, strong for selected controls and hovered chrome.

### Text ramp

**Text** (`#F4F4F6`) → **Text dim** (`#9A9AA4`) → **Text mute** (`#63636D`).
Three steps, and every one of them is used on the card fill directly. The raking
cast is strongest in the top-left corner and gone by the middle of the card, so
running text never sits on the saturated part of it.

### Urgency

Urgency owns countdowns, critical edges, and capped tubes.

- **Critical** (`#FF5A48` dark / `#C13A24` light): dying. Under the critical
  window, or already overflowing.
- **Soon** (`#F0A83C` dark / `#A2700D` light): capping. Attention, not alarm.
- **Ok** (`#46C795` dark / `#2C7A57` light): done, healthy, sleep-safe.
- **Later** (`#74747E` dark / `#8A8478` light): beyond the horizon; present but
  not asking for anything.

### Game identity

A game carries up to three owner-supplied colours. They are **never replaced** —
a pale primary stays pale jewelry rather than being dark-filtered into mud — but
they are lifted toward a tinted variant of their own hue when the current ground
would make them illegible. Never toward pure white or black, which bleaches an
owner's colour into grey.

| Role      | Job                                                                                                            |
| --------- | -------------------------------------------------------------------------------------------------------------- |
| Primary   | The base card wash and the timeline bar                                                                        |
| Secondary | Title ink and the lead tube tone                                                                               |
| Accent    | Icon rim and small highlights                                                                                  |
| Rim       | The card's raking cast and its top highlight: accent → secondary → primary, skipping near-white and near-black |

### Tag hues

Every tag kind has a fixed hue so a chip is recognisable before it is read.
Event `#5B8DEF`, banner `#C084FC`, cycle `#46C795`, patch `#938C7B`,
maintenance `#FF5A48`, daily `#F0A83C`, weekly `#80F4FF`. A chip is that hue
mixed 32% into inset for its fill and 78% toward white for its ink.

### Named rules

**The Two Systems Rule.** Colour means urgency or it means a game-trio role. It
never means both on the same pixel job, and urgency outranks identity wherever
they compete.

**The Raking Light Rule.** A game card is lit from a corner, not filled in. Its
cast comes from two raking gradients over the chrome — the identity colour at 32%
from the top-left running out by 62%, and the secondary at 16% from the
bottom-right — above a 7% base wash. One flat vertical tint at the same strength
reads as a tinted rectangle; the two angles are what make it read as an object
with light falling across it.

**The Cast Comes From The Chromatic Member Rule.** The gradients are sourced from
`gameRim`'s pick, never from the primary. Several games' primaries are near-white
creams, and tinting charcoal with a cream lightens it without carrying any hue at
all — which is exactly how two different games ended up looking like the same grey
card. Whatever colour the card casts, it has to be a colour someone could name.

**The Lift, Never Bleach Rule.** An illegible game colour walks toward a tinted
lift of its own hue until it clears 3.2:1, retaining at least ~40% of the source.
Substituting white, black or grey is a bug.

**The Trio Answers Before The Lift Does Rule.** A lift is the second answer, not
the first. `gameTitleInk` walks primary → secondary → accent for a member that
already clears 3:1 against the current ground, and only lifts when none does.
This is what a two-colour game is _for_: Wuthering Waves ships a pale `#d3dae0`
and a navy `#27396f`, and each theme simply gets the one that was always right
for it, unmodified. Lifting the pale one instead produced `#7a7e82` — a grey
belonging to no game, which is the Bleach failure arriving by a different road.
Games that supply no dark option still lift, and should.

**The Ground Is An Argument Rule.** Legibility is a relationship, not a property,
so every colour helper takes the surface it is being painted against. There is
exactly one source for that hex — `THEME_GROUND` in `theme.ts`, reached through
`useGround()`. A component that writes `#000000` or `#efeae0` inline has forked
the stylesheet; `design-tokens.test.ts` asserts the JS mirror against `index.css`
and against `index.html`'s pre-paint script, which cannot import and so must be
checked.

**The No Raw Palette Rule.** A component may not name a Tailwind palette class.
Every colour arrives through a token or through a trio helper.

**The Owner Palette Is Not A Token Rule.** A game's trio is data, not design
system. Those hexes are sampled from someone else's app icon and logo — Genshin's
Mora gold, NIKKE's accent red, Endfield's signal yellow — so they cannot be
expressed as, or snapped to, our semantic scale without becoming a different
game's colour. That is the whole failure `game-color.ts` exists to prevent.

They live in exactly one place, `shared/src/presets.ts`, and they reach a pixel
only through a trio helper that takes the ground as an argument. So the rules
above still bind them: an owner colour is lifted, never bleached, and never
painted raw.

The design-colour detector is therefore scoped off for that one file in
`.impeccable/config.json`. Scoped to the file, not waived per value — every game
added later ships three more hexes, and a per-value list would need extending
forever to say something the file already says. A raw hex anywhere else,
including in `game-color.ts` itself, is still a finding.

**The Stroke Weight Belongs To The Theme Rule.** The same 1.75px icon stroke
reads a full weight heavier as dark-on-cream than as light-on-black, because the
pale ground eats none of it. Weight comes from `--icon-stroke` via the `.icon`
class, never from a `strokeWidth` attribute — an SVG presentation attribute
cannot take a `var()`, only the CSS property can. Icons that looked overblown in
light mode were never the wrong size.

## Typography

**Language:** DM Sans — 400, 500, 600 only.
**Numbers:** IBM Plex Mono, tabular, everywhere without exception.
**Game display faces**, stored on `Game.titleFont` and editable per game:
Cinzel (fantasy serif), Orbitron (geometric sci-fi), Rajdhani (condensed urban
tech), Exo 2 (wide modern sans), Space Grotesk (sharp contemporary). These are
open-licence approximations, never ripped proprietary game faces.

### Hierarchy

- **Title** (600, 1.0625rem): a game's name on its card, set in that game's own
  face. Its timeline lane uses the same step. The name is deliberately NOT display
  size: a card has to be scannable at notification density, and a 30px name pushes
  the reading and the deadline apart until they stop being one glance.
- **Heading** (600, 1.25rem): page and panel headings.
- **Lead** (500, 1rem): dialog and sheet titles.
- **Body** (400, 0.8125rem): running text, task names, ticket names.
- **Meta** (400, 0.75rem): secondary running text and helper lines.
- **Label** (500, 0.625rem, 0.09em, uppercase): every field label and section
  header. One rule, applied everywhere.
- **Numeral** (mono, 500, 0.875rem) and **Numeral lead** (mono, 500, 1.75rem):
  readings, caps, clocks, countdowns. The lead size is for the countdown that
  owns a card's right side.

### Named rules

**The Mono Is For Measurement Rule.** IBM Plex Mono appears where there is a
number, a clock or a duration. It is never a costume for "technical" — no mono
labels, no mono headings, no mono body.

**The One Display Face Per Card Rule.** A card shows exactly two families: the
game's face on its name, DM Sans on everything else. A game face never leaks onto
rows, chips or numerals.

## Layout

**The full window is the canvas.** There is no max-width column and no reserved
floating-rail clearance — chrome lives at the top edge, so content owns
everything below it.

**Shell:** a single app bar carrying the wordmark, a live clock, the segmented
route control, urgency counts, and the theme control. The wordmark cluster has a
fixed width so it cannot shift between routes.

**The dashboard is a three-column stage** — left game rail, hub, right game rail
— whose columns redistribute on focus via a `grid-template-columns` transition
(`0.34s cubic-bezier(0.4, 0, 0.2, 1)`). The focused rail gains space, the hub
compresses, the far rail yields. Expanding a card animates
`grid-template-rows: minmax(0, 0fr) → minmax(0, 1fr)`, never `height: auto`.

**Rhythm** is a six-step scale — `4 / 8 / 12 / 16 / 24 / 40px`. Gaps between
cards take the top of the scale; padding inside them takes the bottom.

### Named rules

**The Stable Order Rule.** Card order never changes as a side effect of data
changing. Re-sorting is an explicit control the user presses, because entry is
the hot path and a layout that reflows under the cursor costs a keystroke.

That control is Refresh. The dashboard used to grow a second "Sort by urgency"
button whenever its order went stale, which is two buttons for one idea — bring
what I am looking at up to date. Refresh bumps `orderEpoch` in the UI store and
the dashboard reseals from an effect, so the two can live on opposite sides of
the app without knowing about each other.

## Elevation & Depth

**No drop shadows.** Depth is tone, gradient, grain, and a 1px edge against the
ground. On a true-black OLED canvas a soft shadow is invisible where it should be
subtle and a grey smear where it is not.

- **Panel** — the two-stop surface gradient plus grain, no border. Depth comes
  from the wash sitting against black.
- **Card** — the same gradient washed with the game's primary, plus a saturated
  1px rim. The rim is the only reason a card has an outline at all.
- **Float** — dialogs and popovers get `surface` plus a `line-strong` ring and a
  real shadow, because they genuinely leave the page.

### Named rules

**The Card Is Lit, Not Outlined Rule.** A game card has NO saturated border. A
1px ring all the way round reads as a fence — it separates the card from the page
instead of raising it off it. Depth is: a highlight along the top edge in the
game's own colour, a body that runs from lit at the top to shaded at the base,
and a neutral cast shadow. Only urgency may draw a ring, and only critical.

**The Shadow Is Neutral And Offset Rule.** Against an OLED ground a cast shadow
has almost nothing to fall on, so most of the depth happens INSIDE the card. What
shadow there is must carry a real y-offset and stay neutral. `0 0 Npx <colour>`
is a halo — decoration wearing depth's clothes — and is banned outright;
`0 0 0 1px <colour>` is a ring, which is a different thing and is allowed.

## Shapes

Six radii: `4px` chips and checkboxes, `6px` buttons and hover fills, `10px`
panels, `14px` bands, `22px` **game cards and nothing else**, and pill for
**meter tracks only**. A pill on anything that is not a track is a mistake — this
system's parts should read as parts, not as lozenges.

The game card's `22px` is deliberately the softest corner in the product. It is
the one object a user thinks of as a discrete thing rather than as a region of
the page, and the corner is most of what gives it that.

## Components

### Reactor tube (signature)

A containment tube, not a progress bar. Progress bars say "a task is advancing";
this reads as a vessel holding something that accumulates and can overflow, which
is what energy actually is.

Layers, bottom to top: a concave track, a shaded liquid with a meniscus at its
leading edge, a travelling charge highlight, embossed containment ribs, and a
glass lip. The level **glides** to a new reading over ~520ms rather than
snapping, so a typed figure reads as the vessel filling to it.

The highlight runs **only while the resource is still charging**. A full tube goes
visually still, and that stillness is the signal that it is wasting.

### Completion ring (signature)

Completion is always a ring, never a square. The ring is segmented — one arc per
item — with the gap specified in arc **length** rather than as a fraction of the
sector, so it stays visually constant whether the ring has two segments or twelve.
Butt caps, because round caps overhang by half the stroke and swallow the gap.

The burst fires **only when the last segment lands**. Ticking three of four is
progress; ticking the fourth is the moment worth marking.

### Game card (signature)

**Notification density: three bands and no more.**

1. The game's name in its own face, the resource it measures beneath it, and the
   expand chevron.
2. The reading (`—/200`, tabular mono) beside the tube.
3. A footer rule carrying the short-code badge, the next deadline, and its
   countdown in urgency colour.

Roughly 110px tall. The card must be readable in the half-second it takes to scan
a rail, which is the whole argument for the density — a taller card with the same
content reads as a panel, and you stop scanning panels.

It wears the `22px` corner, the raking cast, a saturated 1px rim, and one more
thing that does most of the work: a **2px glint along the top edge**, the game's
two colours running out to nothing at both ends. Without it the card is filled in;
with it the card is lit.

The badge in the footer is how a user picks the right card out of a rail, so it
takes the lifted identity colour rather than the raw one — a near-white primary
drew an invisible badge on the cream ground.

Expanded, the card carries everything for that game — resources, windows, cycles,
tasks.

**What it does not carry:** no status dot, and no decorative field behind the
content. Both were tried and both lost — the dot duplicated a countdown that was
already coloured, and the field cost a per-frame repaint to say nothing.

### Chips

Fixed hue per kind, `4px` radius, uppercase label type. Section names
(Closing, Arriving) are never chips.

### Timeline

A Gantt with a mono month/week ruler, **dashed** grid rules and a **solid** now-rule
— the dashes read as scaffolding so the bars own the only continuous lines on the
surface. Event names ride **inside** their bars.

Lane titles are set in the game's own display face at Title size, in the colour
that lane was assigned. Bars take that same colour mixed into the track: an event
at 62%, a banner at 28%, and a **cycle at 34% — the same hue, lighter**, because a
cycle is the same game's window rather than a different kind of object. A grey
treatment would have said the wrong thing. Maintenance is the exception and stays
critical-coloured.

A bar's label ink is chosen from the fill that was **actually painted**, not from
the game's raw colour: the fill is the ink mixed into the track, so a pale primary
lands mid-grey and a fixed white label would sit on it at roughly 2:1.

Consecutive instances of the **same** cycle are joined by a soft cubic hand-off
drawn on an overlay that stretches to the row stack, so a curve's endpoints land
on the bars it claims to join at any row height. A cycle is one recurring thing,
and the curve says "this is that again" — which a stack of unrelated bars cannot.
Nothing else is ever connected.

The range control offers **7d and 30d**. 90d was retired: at that scale every bar
collapsed to a sliver and the ruler stopped being readable.

**The Distinct Lanes Rule.** Colours are assigned in one pass across all games so
the timeline and the dashboard agree and no two lanes land in the same region of
hue and lightness. At the ends of the lightness range hue stops being perceptible,
so two near-whites are treated as clashing however far apart their hues measure —
without that, a cream and a blush white draw two identical lanes.

### App bar

Wordmark in tracked DM Sans, live clock in mono, a segmented route control in an
inset well, **the current route's own actions**, and the theme control at the far
right. It wraps until it genuinely fits; forcing one row on a landscape phone put
the right-hand group on top of the actions and made visible, enabled controls
unclickable.

Routes publish their buttons into the bar through a portal rather than a store
slice, so a page's controls cannot outlive the page. The bar carries no counts:
"2 critical, 1 soon" restated what the cards already say in colour, and the space
was worth more as the one place every action lives.

### Attention rail (the hub)

The stage's centre column is a rail, not a stack of panels. One status line — how
many dailies are done, and whether the night is safe — then three bands in a
fixed order: **Closing**, **Just arrived**, **Arriving**. Only the last stretches.

Every row below the status line is the same ticket: badge, name, countdown. The
eye runs down one column instead of re-learning a layout per section, and a
quiet evening costs three short bands rather than three collapsible panels each
stretching to say "Nothing".

## Motion

Focus expand and shrink, tube charge highlight, tube glide on commit, ring
completion burst, and the commit flash. **Nothing else.** Every one of them is
either the response to something the user just did or a state that is genuinely
changing on its own.

`prefers-reduced-motion` is honoured globally and must remain so.

## Do's and Don'ts

### Do

- **Do** route every colour through a token or a trio helper.
- **Do** let the rim, title and tube carry a game's identity, and keep the fill
  charcoal.
- **Do** set every number in tabular mono.
- **Do** give urgency the win when it collides with identity.
- **Do** express depth as tone, gradient, grain and a 1px edge.
- **Do** lift an illegible game colour toward its own hue, never toward grey.
- **Do** animate `grid-template-rows`, `opacity` and `transform`.

### Don't

- **Don't** flood a card with a game's colour. Seven percent, then stop.
- **Don't** put a drop shadow on anything that does not overlay the page.
- **Don't** use mono for anything that is not a number, a clock or a duration.
- **Don't** use emoji, celestial motifs, or pure-white light-mode cards.
- **Don't** let a game's display face escape onto rows, chips or numerals.
- **Don't** use a pill radius on anything that is not a meter track.
- **Don't** let a card re-order or reflow itself while the user may be typing.
- **Don't** name a Tailwind palette colour in a component.
