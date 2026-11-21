# Round 3: rail, game page width, Notes, Month, Ending soon

Asked for on 2026-11-21, after Beta 0.4.0. Everything here gets built in this round; nothing is
left as "later".

## 1. The rail on a PC (and any wide screen)

What is wrong: each place is a 72×58 block, and the current one is a solid filled block
(white in Clean and Instrument, accent in Arcade). Next to the game coins they look heavy,
and Settings at the foot looks the same.

- **Order down the side:** Today, Calendar, Notes, Games (the game list opens under Games),
  and Settings alone at the foot. The upright dock keeps Calendar · Games · Today · Notes · Settings.
- Alt+1…Alt+5 follow the order on screen, so on a PC Alt+1 is Today.
- **Shape:** the dock's model. A small pill (44×28) sits behind the icon only and the name
  sits under it in small type. Only the current place has the pill. Hover shows a faint pill.
  Each look already colours the dock's pill (`--dock-pill`, `--dock-pill-fg`), so the rail
  uses the same tokens and every look keeps its own character.
- The rail narrows from 88px to 76px. Icons go from 22px to 19px, names to 11px, and the
  logo mark shrinks to 30px.
- The badge (Today's count) and the dots sit on the pill's corner, not the block's corner.
- The game coins keep their meters and countdowns, at 64px wide.

## 2. The game page's Track tab on a wide screen

What is wrong (screenshot at 2000px): energy takes the widest column, about 630px, for three
short bars, with empty space under them. Events, the column with the long names, is held to
380px, so its names are cut off.

- Three columns: `energy minmax(300px, 0.8fr) · tasks 1fr · events 1fr`, with a 36px gap
  instead of 44px.
- From 1280px to 1499px the events column gets at least 320px; from 1500px on it grows with
  the tasks column.
- Two columns (900–1279px) and one column (a phone) stay as they are.

## 3. Notes

What is wrong:

- One fixed box per game, resized by a drag handle. Making a box taller in the first row
  also makes that row taller in the grid, so the lone box on the row below gets pushed to the
  bottom. That is the "squashed" box.
- Notes cannot be split up, coloured, pinned, sorted, ticked off, or written without a game.

New model (synced, in `@memoria/shared`):

```ts
interface Note extends Syncable {
  id: string;
  gameId: string | null; // null: a note of its own, not tied to a game
  title: string; // may be empty
  body: string; // plain text; "- [ ] x" / "- [x] x" lines are checklist items
  color?: NoteColor; // 'game' | 'red' | 'amber' | 'green' | 'blue' | 'violet' | 'pink'
  pinned?: boolean;
  sort: number;
}
```

- `notes` becomes a record collection: validated, merged by id, tombstoned, capped at 2,000.
- **Moving old notes over:** the first time 0.5 opens, a game's old notes text becomes that
  game's first note, with the id `notes-<gameId>`, and the old text is cleared. Every device
  derives the same id, so two devices doing this at once still end up with one note.
- Deleting a game tombstones its notes.

The Notes page:

- **Masonry columns** (CSS columns), so a tall card never stretches its neighbours. Boxes
  grow with their text; there is no drag handle.
- **New note** button, for a game or for no game. Each game's group also has a small "+".
- **Grouping:** by game (each game's notes under its name, with general notes first), or one
  flat wall.
- **Sort:** pinned first, then your own order (newest first), last edited, or title A–Z.
- **Filter chips:** All, General, and one chip per game that has notes.
- **Density:** Comfortable or Compact. Compact shows four lines of each note until it is opened.
- Search covers titles, bodies, game names and account names.
- Page choices (grouping, sort, density) are kept per device in the UI store.

A note card:

- Title (optional), body, and a tint in its colour. **Game** uses the game's own colour.
- Click to edit in place, with an auto-growing title field and text box. Esc or clicking away
  saves.
- Checklist lines show as tickable boxes when not editing; ticking rewrites that line.
  "N of M" shows in the footer.
- Footer: game logo and name (on the flat wall), "Edited 3h ago" (or a sync mark and "3h" in
  Minimal).
- Menu (⋯): Pin or Unpin, Colour (swatches), Move to game…, Duplicate, Delete (with an Undo
  toast if toasts exist, else a confirm).
- Phone: swipe a note right to pin it and left to unpin it, the same verbs as rows elsewhere.

A game's Notes tab shows the same cards for that game only, with "New note".

## 4. Calendar → Month

What is wrong: long events (3–6 weeks) draw as bars across every week, so each week is a wall
of the same bars plus "+41 more". It says nothing about any single day, and the panel says
"Nothing ends or starts" on most days.

New month, a **deadline month**:

- A cell lists what **ends** on that day (the last day it can be played, as everywhere else),
  as up to three chips: the game's colour, then the name. Done ones are struck through and
  faint. Anything over three shows as "+N".
- Starts show as a small "▸ 2 start" line with game dots.
- Maintenance (hatch) and livestream (diamond) marks stay.
- A cell's ground warms with how many unfinished events end that day (0, 1, 2, 3+), so the
  busy days stand out at a glance.
- Past days are faint, and today is ringed.
- A **summary line over the grid** for the month shown: "14 end this month · 9 left · busiest
  Tue 1 Dec (6)".
- **The day panel:** Ends (tickable), Starts, Also (maintenance, livestreams), and **Still
  running**: undone events open on that day, ending soonest first, so even a quiet day offers
  something to do. On today it reads "Running now".
- On a phone the cells keep dots (the game colours of what ends) and the panel sits below.

## 5. Calendar → Ending soon

What is wrong: four equal columns, with Today often empty, and nothing that says what to do
first or that it is worth getting ahead.

- **A header line:** "Nothing ends today: a good day to get ahead" / "2 end today, 1 left";
  "This week: 4 of 10 done".
- **Load strip:** the next 14 days as small columns, each a stack of unfinished endings in
  game colours. Days with 3 or more are marked as pile-ups. Clicking a day scrolls to it in
  the columns.
- **Do next:** up to 4 picks, scored and explained with small reason chips:
  - ends soon (the score rises as fewer days are left)
  - "Pile-up Mon 30": it ends on a day where 3 or more end
  - "+420 Primogems": its reward
  - "2 of 3 parts": started already
  - pinned
  - Banners, maintenance and livestreams are never picks.
  - Each pick has Done and Open.
- **The columns stay**, but an empty column folds to a slim "Nothing ends today" note, so the
  rest of the board gets the room.

The scoring and the load are pure functions in `@memoria/shared` (`get-ahead.ts`), with unit
tests.

## Verification

- Unit: the notes model (validate, merge, adopt the old notes), checklist toggling, get-ahead
  scoring, deadline load, month digest.
- e2e: rail order on a PC, the notes page (new, edit, colour, pin, checklist, delete),
  Month cells and panel, Ending soon picks.
- Shots at phone, tablet and PC in every look. Then `npm run check` and the full e2e.
- Install on the tablet.
