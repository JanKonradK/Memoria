# Memoria design

## Direction

**Thesis:** A quiet, flat workspace for daily game progress and upcoming events. The games bring the colour; the app brings order and time.

**Story:** Find the game that needs attention, update energy, tick tasks, then check what ends soon.

**Material:** A graphite ground (an off-white one in light mode), hairline rules, no cards around content. Sections are told apart by spacing and a small label over a hairline. Rows have no fill at rest, a quiet fill under a hovering pointer, and a pressed fill with an inset edge when chosen. Floating things (sheets, menus, popovers) are the only raised surfaces.

**Colour:** A game's two logo colours identify it: its logo, its title, its energy meter and its timeline lane. Amber and red are reserved for deadlines and always come with their number. Gold marks a pinned event. The accent marks the selected route, focus, text selection, links and the one primary action; nothing else carries colour. Players choose a colour palette (Memoria, Catppuccin, Kanagawa, Rosé Pine, Gruvbox, Tokyo Night) and an accent within it in Settings → General; every palette is derived in `palettes.ts`, which lifts any colour below AA on its own surfaces.

**Type:** DM Sans for language and numbers, tabular figures wherever a value can change (`.numeral`). Secondary detail may be light italic (`.aside`), but never a time, a date or a count: those are what the product exists to show. A game's own title face is used only for the heading of its page; lists and the timeline use DM Sans in the game's colour.

## Tokens

Use the semantic tokens in `src/index.css`; no raw Tailwind palette colours. The JS mirrors in `theme.ts`, `ui-store.ts` and the pre-paint script in `index.html` must agree with CSS. The theme follows the device unless one is chosen in Settings → General. Memoria's palette is the stylesheet; other palettes are written onto the root element, and the pre-paint script repeats the last one from `memoria-paint` so a reload never flashes.

- Desktop body 16px, metadata 14px, labels and captions 13px. Phone body 17px, metadata 15px, labels 14px, captions 13px. Keep text scaling enabled.
- Text contrast meets WCAG AA. Decorative colour never carries body text.
- Touch targets are at least 44px; desktop controls may be denser.

## Layout

**The rail** is the app's one navigation. Its edge follows the screen's shape: a column down the left on a wide screen, where height is scarce, and a bar across the top on a tall one (a phone, an upright tablet), where width is. Today and Calendar lead; then every game in the player's own order, its logo over two hairlines (its stamina bar in the game's colour, the bar's bank in its second) and how long until it next needs the player (rose under two hours, amber under eight); then Add game and Settings. The rail never re-sorts, so a game is always where the player left it. The open game is marked by a pin in its own colour. Ctrl+1 to Ctrl+9 open the first nine games. Across the top the games scroll sideways and the open one is kept in view; page bars stick under it. Today carries the number of steps left. Sync trouble and a Refresh retry appear in the rail only when something failed; a waiting update is a dot on Settings, and only a new major or minor version opens the full-screen update page.

There is no app-wide bar. **Each page has its own bar**: what the page is, its views, and its actions. Adding starts where the thing lives: a game from the rail, an event from the Calendar's bar or a game's Events tab, a reminder from Settings → Reminders.

**Today** opens by default and shows Steps or Games. Steps is one ordered to-do list across games: a strip of the next 24 hours (now, quiet hours, a logo at each cap, reset and event end), then the steps grouped by when they are due: within the hour, this evening before quiet hours, before each reset, and this week. Each step is done in place: its energy value, its tick or its count. An energy step carries the bar's bank under its value as a thin meter and figure. Many events of one game ending together are one step. Finished steps fold into Done today. Livestreams, what starts tomorrow and codes sit beside the list on a PC. Games is the ranked list of games, each row two lines (the game and its countdown, then its energy meter), with the selected game's controls beside it on a PC.

**A game's page** has the game's coin, name, server and reset in its bar, its tabs (Track, Events, Pulls, Quests, News), then Play and Edit. Track shows energy, tasks (Daily, Cycle, Weekly, Monthly), and the game's events with its notes, in three columns on a PC. Events manages every event of the game. Pulls holds its savings, pity and version history; Quests its story progress; News its version notes, livestreams and codes. A tab shows only when the game has something for it. The coin flips between its faces, and its ring turns with the flip, never on its own. Browser Back and Alt+Left return to where the game was opened from.

**A stamina bar and its bank are one instrument.** The bank is whatever holds what the bar cannot: its own reserve (Reserved Trailblaze Power, Backup Battery Charge, Waveplate Crystals, Photo Paper Supply) or a counter crafted from it, paired by name (Condensed Resin with Original Resin). On a game's page the bank is the bar's second row, the same name, stepper, tube and verdict one size down, hung from the bar on a rule; a paired counter is not shown again on its own. Today's step and the rail show it read-only.

**The Calendar** shows the same events four ways: Timeline, Agenda, Month and Ending soon, under one bar with the game filter (a logo per game), the range (Week, 4 weeks, Season), Today, Show finished and Event. The Timeline packs events that do not overlap into shared rows, banners in their own, with a now line, the countdown inside each bar, and a tick on hover or focus. Maintenance is a hatched band, a livestream a diamond, a predicted window a dashed outline. A busy game folds to one line. The Agenda groups events by day; the Month grid packs bars per week with a panel for the chosen day; Ending soon puts unfinished events in columns by when they end. New feed events go straight onto the calendar; a failed download offers a retry, and a game whose calendar is behind says so on its lane. Choosing an event opens its quick view, not the editor. A month cell's "+N more" counts only hidden events that start or end that day; one running straight through is in the day's panel. Maintenance labels read away from the now line, which runs under the bars.

**Settings** has a menu beside one section from 900px and every section on one page below that. Game edits save as they are made.

Every value is entered by hand. A reading says how old it is ("Updated 13m ago"); a value seeded when a game was added reads "Starting estimate".

First-run setup picks games and servers, then opens the guide: four cards, each a working miniature of a part of the app (Today, a bar and its reserve, the rail, an overnight end) over one line. Settings opens it again. Nothing in the app explains itself in place: no tips, no "Got it".

**Words.** A label is the thing and its figures, never an instruction: "Original Resin 137/200", not "Spend Original Resin". Nothing repeats what a figure beside it already says. **An end in the small hours belongs to the night before**: before the player's morning (when their quiet hours end, else 09:00) it is listed on the previous day, its bar stops at that midnight, and a crescent marks its real time. Today asks for it by midnight.

## Motion

Motion explains a change of state; it is never decoration. Keep the coin flip, the tick, the strike-through, numbers counting to a new value, rows gliding to a new place, and the logo travelling between a row and its page. Nothing loops while idle except the small breathing dot on an urgent game, which pauses off screen, in hidden tabs and under reduced motion. Reduced motion changes the view immediately. Route content is usable at once.

The one piece of motion that is not a change of state is the intro, and it earns its place by covering the load. It lives in `index.html` and paints before any script: one still frame of the ground (#0c0d0f, the same as Android's launch screen and the PC window, so the hand-off is seamless), then the mark fades in as a ghost, lights up left to right, catches one glint and settles in a warm glow (about 2.5 s). The app loads and renders underneath. `splash.ts` lifts it only after the first real screen has drawn and the intro has played: the mark leans in and is gone, then the ground lifts off a finished page. If the app needs longer, the glow breathes until it is ready, and gives up at 9 s. A tap skips the rest once the app is ready. It animates only opacity and transform, on layers promoted from the first frame, so the compositor keeps it at full frame rate however busy the page is. Under reduced motion it is a short fade. Automated browsers skip it.

## Validation

Run `npm run check` and the relevant Playwright specs. Inspect desktop, phone, small phone and light mode for overflow, focus, touch targets, contrast and preserved edits. A design change does not change storage or sync.
