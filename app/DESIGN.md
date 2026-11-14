# Memoria design

## Direction

**Thesis:** A quiet, flat workspace for daily game progress and upcoming events. The games bring the colour; the app brings order and time.

**Story:** Find the game that needs attention, update energy, tick tasks, then check what ends soon.

**Material:** A graphite ground (an off-white one in light mode), hairline rules, no cards around content. Sections are told apart by spacing and a small label over a hairline. Rows have no fill at rest, a quiet fill under a hovering pointer, and a pressed fill with an inset edge when chosen. Floating things (sheets, menus, popovers, the phone dock) are the only raised surfaces.

**Colour:** A game's two logo colours identify it: its logo, its title, its energy meter and its timeline lane. Amber and red are reserved for deadlines and always come with their number. Gold marks a pinned event. The accent marks the selected route, focus, text selection, links and the one primary action; nothing else carries colour. Players choose a colour palette (Memoria, Catppuccin, Kanagawa, Rosé Pine, Gruvbox, Tokyo Night) and an accent within it in Settings → General; every palette is derived in `palettes.ts`, which lifts any colour below AA on its own surfaces.

**Type:** DM Sans for language and numbers, tabular figures wherever a value can change (`.numeral`). Secondary detail may be light italic (`.aside`), but never a time, a date or a count: those are what the product exists to show. A game's own title face is used only for the heading of its page; lists and the timeline use DM Sans in the game's colour.

## Tokens

Use the semantic tokens in `src/index.css`; no raw Tailwind palette colours. The JS mirrors in `theme.ts`, `ui-store.ts` and the pre-paint script in `index.html` must agree with CSS. The theme follows the device unless one is chosen in Settings → General. Memoria's palette is the stylesheet; other palettes are written onto the root element, and the pre-paint script repeats the last one from `memoria-paint` so a reload never flashes.

- Desktop body 16px, metadata 14px, labels and captions 13px. Phone body 17px, metadata 15px, labels 14px, captions 13px. Keep text scaling enabled.
- Text contrast meets WCAG AA. Decorative colour never carries body text.
- Touch targets are at least 44px; desktop controls may be denser.

## Layout

The routes are Timeline, Today, Pulls and Settings. Today opens by default. A game's page belongs to Today: the Today tab stays selected on it, and one back arrow (or browser Back, or Alt+Left) returns to the same scroll position and focus.

The app bar holds the brand, the routes on desktop, and the Add menu. Sync is announced to screen readers and shown in words only when it needs attention; Refresh appears only after loading or syncing failed. A waiting update is a dot on Settings, and only a new major or minor version opens the full-screen update page.

**Today** is one ranked list of games. Each row is two lines: the game and its countdown, then an energy meter, the value and what the countdown is for. A ring shows daily progress. Meters share one track length so they compare down the list. On desktop the selected game's controls sit beside the list on the same ground, separated by a hairline; on a phone a row opens the game's page. Codes sit below the games. Paused games sit in a compact group at the end.

**A game's page** shows, from 1280px, the last and next livestream, Catch up and notes on the left; energy, then Daily, Cycle, Weekly and Monthly tasks in the middle; events on the right. The order is fixed; a task can be hidden from the card in Game settings. The large logo flips between its faces, and its ring turns with the flip, never on its own.

**Timeline** shows events as time bars or a list, one week back and three weeks ahead, under one row of controls: game filter, Timeline or List, Show finished, Edit. A current feed says nothing; a game whose calendar is behind says so on its lane, and where the feed came from is in the Calendar changes sheet. Choosing an event opens its quick view, not the editor.

**Settings** has a menu beside one section from 900px and every section on one page below that. Game edits save as they are made.

Every value is entered by hand. A reading says how old it is ("Updated 13m ago"); a value seeded when a game was added reads "Starting estimate".

First-run setup picks games and servers. After it, three hints appear once each, where they apply: energy, tasks, and the Timeline. There is no tour.

## Motion

Motion explains a change of state; it is never decoration. Keep the coin flip, the tick, the strike-through, numbers counting to a new value, rows gliding to a new place, and the logo travelling between a row and its page. Nothing loops while idle except the small breathing dot on an urgent game, which pauses off screen, in hidden tabs and under reduced motion. Reduced motion changes the view immediately. Route content is usable at once.

## Validation

Run `npm run check` and the relevant Playwright specs. Inspect desktop, phone, small phone and light mode for overflow, focus, touch targets, contrast and preserved edits. A design change does not change storage or sync.
