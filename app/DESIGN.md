# Memoria design

## Direction contract

**Thesis:** A unified, softly rounded glass workspace for daily game progress and upcoming events.

**Own world:** Game colors identify games and tint the light in each card. Urgency colors identify deadlines. Graphite chrome frames rounded, translucent game surfaces with a fine reflected edge and a soft shadow below.

**Story:** Find the game that needs attention, update energy, complete tasks, then check upcoming events.

**First viewport:** Today leads with approaching caps and unfinished routines. Desktop places one ranked list on the left and the selected game's real, editable card on the right. Phone shows the list above two primary tabs. The Tonight summary closes the list at every width.

**Form:** DM Sans for language and numbers, with tabular figures wherever a value can change. Secondary detail is light italic, not bold. A game's name is set in that game's own title face, in the weight, case and spacing its round logo uses, and nothing else is. Standard cards and sheets use 32px corners with progressive continuous corner support. Compact overview cards use 24px corners. Controls use nested 10px, 16px and 24px curves; navigation and segmented controls use capsules. Glass light is static; motion follows presses, progress, and navigation.

## Reference and composition

The September 2026 card refinement adds rounder, more expressive glass surfaces at the owner's request. The owner's Apple navigation reference extends this material across the complete app: a floating translucent dock, sliding active capsule, curved panels and clear blue navigation selection. It does not add marketing sections to the application.

The selected composition keeps top navigation on desktop and bottom navigation on phone. It fits the existing game controls and Tonight summary. Concept images are exploratory: invented data, portraits, search, feeds, and slogans are not product requirements. The implementation uses semantic HTML, CSS, existing SVG icons, and owner-supplied game images.

## Tokens

Use the semantic tokens in `src/index.css`. JS theme mirrors in `theme.ts`, `ui-store.ts`, and the pre-paint script must agree with CSS.

- Dark: graphite ground, slightly raised neutral panels, soft white text.
- Light: cool off-white ground, white panels, dark neutral text.
- Four fill steps, four border steps, three scrims. No raw Tailwind palette colors.
- Floating dialogs and popovers share one shadow token. Game surfaces add a soft, downward shadow and an inset top highlight through the shared card material.
- Shared radii: 10px badges, 16px inputs and nested controls, 24px larger controls, 32px cards and sheets, 999px capsules. Continuous corner shaping is progressive; conventional curves remain the fallback.
- Desktop body 16px, metadata 14px, labels and captions 13px. Phone body 17px, metadata 15px, labels 14px, captions 13px. Keep browser and system text scaling enabled.
- Text contrast meets WCAG AA. Decorative colors never carry body text.

## Identity

Preserve each game's saved colors, title font, image, and account label. Use color in badges, titles, energy levels, and meaningful tags. A game's palette supplies the translucent card tint and reflected light. Keep text readable over the brightest part of that material. Urgency takes priority over game color for warnings.

DM Sans ships Latin and Latin Extended. A name in a script its title face lacks falls back to the system face.

## Layout and interaction

Today and Calendar are the two primary routes. Settings is a header utility. There is no separate Games overview: Today is the one list of games, and each game has its own page.
Calendar contains Events and Livestreams. The Calendar tab stays selected for both views.
Calendar's controls sit in one toolbar at the top of its page, not in the app bar: the Events and Livestreams switch, the game filter, the view switch, Find, and Finished.
They share one capsule style and one height. In a narrow window the toolbar wraps; no control shrinks below its label and the row never scrolls sideways.
The app bar holds the brand, the two routes, and the utilities. Settings keeps the game filter there.
Today opens by default. A game's page lives on the internal `home` route, which holds nothing else; without a game it returns to Today. The Today tab stays selected on a game's page and selecting it goes back.

Today uses the existing urgency and energy calculations. The configured sleep window sets the attention interval.
Each row is two lines: the game and its countdown, then an energy meter, the value, and what the countdown is for. A ring shows daily progress.
What the countdown is for gives way last. A narrower list drops the reading's age, then the account name; a phone-width list moves that label to a line of its own, wrapped to two lines at most.
Meters share one track length so fill levels compare down the list. The meter keeps the game's color; the countdown carries urgency in amber or red, always with its number.
The list is one column at every width. The pair is capped and centered on very wide windows.
Paused games sit in a compact Paused group below the priority groups.
Select a row on desktop to put that game's controls beside the list, on the same flat ground and separated by one hairline; there is no tinted card. A game's actions (Launch, Manage events, Edit, and in the pane Open full page) sit in its heading, beside its name; there is no bar at the foot. On a phone they take the row under the name. Adding an event belongs to the app bar's Add menu, which scopes the new event to the game in view; the events panel keeps its own Add event because it also opens inside the game editor. Pause tracking sits with the card's other settings under Edit, and a paused card shows Resume tracking beside its paused note.
A game's page has two columns from 900px: resources with Daily, Cycle, Weekly and Monthly under them on the left, and that game's events on the right. Each event has a tick; a finished event stays in its section, struck through, below the unfinished ones, so the tick can be taken back. An event played in parts shows one segment per part under its name, in the game's color; ticking a part ticks those before it, the last ticked part unticks itself, and the event is done when all are ticked. Its tick fills by sector to match. The part count is a guess from the event's name and notes (a login event is 7, or the day count it states; a reward of 300 to 999 premium currency is 5; 1000 or more is 4), and the event editor's Parts field overrides it. On the page the heading logo is large enough to carry the full two-line name.
On a phone, a row opens the game's page. Browser Back returns to Today.
Each row and each game heading leads with the game's round logo: a ring in the two colours of that game's logo, turning slowly, around the game's short name in its title face. Inside the ring is a coin. Its front carries the game's full name, drawn from the outlined artwork in `docs/logos` for a preset game and set in the game's title face for a custom one; its back carries the short name. Every logo shows the front until its coin is flipped. The logo in a game's heading and in an event's quick view is the control that flips it: the coin leaps forward, turns two and a half times and lands on its other side, and the ring hurries round while it is in the air. A flip is remembered on the device and applies to that game's logo everywhere, and to every account of the same game. Under reduced motion the coin simply changes side and the ring is still.
Tonight follows the groups in the list column, flat like the list with a hairline heading and no card: daily progress, the sleep check, and what closes, has arrived, or arrives across every game. It is as tall as its tickets and scrolls with the page.
Notices about a home timezone correction or new preset routines appear above the list.
Settings, Calendar's list and Livestreams use the same flat language as Today: sections sit on the page ground under a small label and a hairline, rows have no fill at rest and a quiet fill on hover, and secondary detail is light italic. Settings' game rows lead with the round logo. The Calendar timeline's ruler and lanes sit on the page with no board around them, and each lane is headed by the game's round logo and name. The Add game picker, the layout editor's items, the events panel and the notices follow the same rows and rules; a notice is a line with a rule down its left edge, not a box. Cards remain only where something floats: dialogs, sheets, menus and toasts.
Choosing an event anywhere but the editor's own lists (a timeline bar, a Tonight ticket, a row on a game's page) opens its quick view, not the editor: the game, the time left, its parts as tickable segments, its notes, and at the foot Edit on the left with Pin and Mark done on the right. A pinned event is one you mean to do, and gold is its colour everywhere. Calendar opens with a Pinned strip above both views: one chip per pinned event that is still to do, soonest first, each opening its quick view. On the timeline a pinned event's whole lane row takes a gold wash, and its bar a gold border, a halo and a pin before its name. In the list its row has a gold rule down the left edge, the same wash, and a pin control beside Mark done. On the game's page it carries the pin and is listed first in its section.
Today carries no explainer sentences. A heading states its window once, as in "next 9h".

Every value is entered by hand, on the card. Memoria reads no account, screenshot or game window.
A card's status line says when its main energy value was entered, as in "Updated 13m ago". A value seeded when the game was added reads "Starting estimate".
A Today row shows the same age; its accessible description says Estimated in full.
Device sync status does not represent a new game reading.

The Windows app shows Launch in a card's heading once the owner has picked what it starts, under Edit, in a native file dialog. It starts that program or shortcut. The choice stays on that PC. Other platforms show no such control, and no control that only opens a card may be labelled as opening a game.
Calendar shows the public feed status beside its date range. A failed check keeps saved events and exposes Retry update.
Android Settings exposes Reminders on this device and its permission control. No permission request occurs before the user enables reminders.

All features are available on Android, including the Samsung S23 Ultra. A Today row opens the same complete game controls as desktop. A single back arrow returns to Today. The game selector filters Timeline, Livestreams, and Settings.

At default text size, three complete rows fit on a 320×720 phone, where long names wrap to two lines, and five fit on a 412×915 phone above the navigation dock. Supporting labels can truncate; accessible descriptions retain their full text. Rows grow with larger text, and at twice the default size each row stacks its name, countdown and reading. Avoid repeating the game heading above the open card.

Opening a game's full page on desktop uses the same integrated page as mobile; Back restores the Today scroll position. A clock tick must never move the control being edited.

Alt+Left and browser Back follow the game back arrow. Forward reopens the game. Return restores the overview scroll and card focus. An open editor handles Back first and retains its unsaved-change guard. A typed energy value commits before return; Escape still cancels that field's draft.

Task rows share one control and one state path. Names wrap on phones. Dailies, cycles, weekly and monthly tasks retain their group labels and reset countdowns. Energy projections and all time calculations use shared domain functions.

The event page opens in List view on phones. Timeline remains available, including event reordering. Distinguish event categories and server/account scope. Long reminders remain readable.

Primary phone targets are at least 44px. Content, notices, and sheets clear the bottom navigation and device safe areas. Phone landscape uses a compact header. Desktop controls can be denser.

## Editors

Device sync comes first in Settings. The primary flow is Connect my phone or tablet on the PC, then Scan PC code on Android. The QR code carries the temporary code and local addresses. Keep manual entry, connection management, and troubleshooting behind optional disclosures. Connected and offline states explain what happens to saved progress. A failed or cancelled replacement scan keeps the existing connection.

Use existing shared inputs, buttons, tabs, and sheets. Fields use sentence-case labels and clear grouping. Event and reminder actions remain outside the scrolling form. Game edits save automatically and expose a Done button. Preserve validation, dirty drafts, cancel behavior, deletion safeguards, and account scope.

The game editor has five tabs: Energy, Tasks, Events, Reminders and Game. Quick spends sit under Energy; the server, resets, appearance, notes, pause and delete sit under Game. The sheet keeps one height across tabs. A row that opens a panel has a named Delete button; a one-line row ends in a ✕. Resources and routines expand in place. Resource order is editable without changing readings. Priority tasks lead their group. Reset settings show the local daily reset time and all supported server zones. Game reminders can be added and edited in place; their draft survives tab changes.

A short touch on an energy stepper changes it once. A long touch repeats after 350ms. A scroll or cancelled gesture changes nothing. Keyboard operation remains available.

## Motion and performance

Motion explains a state change. Use a short directional page transition and a brief task completion response. Energy bars use two elements and no perpetual sweep. Card highlights remain static; a touch gently compresses the card and its arrow responds to the same press. Route content is usable immediately; do not stagger access to controls.

Urgent game cards use a small status dot with a 3.2-second breath. Borders stay neutral, and overview energy bars keep the game’s identity color. Status text remains readable without relying on color. The pulse pauses offscreen, in hidden tabs, on hover, and during keyboard interaction. Reduced motion shows a static dot. Game expansion uses one critically damped spring for its crop and content crossfade, with the same physics for card movement. Reversals preserve motion. Collapsing cards stay above resting cards until they settle. Navigation fades gently over 260ms. Energy levels glide with a transform, without a perpetual sweep. Dialogs use a small 8px arrival and a faster exit. Phone sheets use one transform for entrance, direct dragging, snap-back, and dismissal, so the surface follows the finger without a jump.

Respect reduced motion. Lazy-load routes and motion features. Reuse the shared derived-data cache; do not duplicate domain calculations in components.

At every width, a game opens a full page with a plain identity heading and one Edit control. Do not nest that page inside another glass card. One back arrow restores the Today position and keyboard focus. The game's logo travels between its row and the page heading as a view transition, and only the logo: the page is not cross-faded, and its content arrives with a short transform/opacity slide. Keep the fixed header and navigation still. When Today's order changes, a row glides to its new place so the eye can follow it. A pressed row shrinks slightly at once. Whatever leaves (a menu, a notice, a backdrop) accelerates away on the exit curve rather than decelerating, and a chevron turns over the same 260ms as the panel it opens. Pinning washes the gold in over 260ms, and the pinned chips glide over when one joins or leaves. Hover fills apply only where the device has a hovering pointer: on a touch screen the state would stay under the last tap and light up whichever row a reorder moved there. A number that changes on Today or in Tonight counts to its new value over a quarter of a second instead of swapping. Reduced motion changes the view immediately. Rapid reversal must keep the final controls usable. Task completion stays close to its original control: a small check response and one fading outline, without particles over nearby rows.

## Validation

Run `npm run check` and relevant browser checks. Inspect desktop, phone, small phone, and light mode. Check overflow, keyboard focus, touch targets, form actions, contrast, and preservation of user edits. A design change does not change storage or add cross-device sync.

### Per-game editing

The dashboard has a visible Edit button. The game title is editable at the top. Each item has a separate Edit button and drag handle. Edit opens its settings, move buttons, hide, and delete actions. Task items expose cadence, checkbox/counter/timer mode, count targets, timer rules, timeline links, and priority. Settings uses the same task fields. Add item creates a task, manual counter, or energy resource without leaving the card; hidden items can also be restored there. Deletion uses the store's existing tombstones and offers Undo delete, preserving tracking history. Resets, reminders, and appearance remain in Settings.

Hold anywhere on an item for 400 ms to lift it, then drag and release to place it. A quick touch swipe still scrolls normally. Mouse dragging and keyboard arrows offer the same movement. There is no bottom widget toolbar. A lifted item follows the pointer, and nearby items move into their new positions. The drag preview is inert, so moving an item never changes a value or completes a task. Reduced motion removes position animation.

Changes save as you go. Done closes Edit. Undo layout restores only the arrangement from the start of the session; Reset restores the default grouped dashboard. Each game's layout travels through the existing backup and sync paths. Inactive tasks keep their positions. Each item occupies one full row on phone and desktop. Old backups keep their order and hidden items; obsolete width values are removed during normalization.

### Navigation and timeline material

Genshin card events appear in three sections: Teyvat, Miliastra Wonderland, then Banners. Each card section shows all active events and its next upcoming event. Cosmetic draws belong in Banners. Manage events and Timeline lanes use the same section order, including search results and finished events. Timeline reordering stays within a section and preserves the owner's order there. Other games keep their compact card summaries. Timeline keeps its inline world tags.

Official calendar entries show confirmed date ranges in the publisher's calendar timezone. They do not show hourly countdowns or send deadline alerts without a published hour. Exact notices retain their clocks. Personal edits to the time fields retain the owner's chosen schedule.

Navigation floats in a glass capsule with one persistent moving selection. On phones the dock clears the safe area and content reserves its full height. All three primary routes retain text labels and touch targets. Blue marks the selected route. Content and urgency retain their own colours. Settings and broadcasts use the same large curved surfaces. Inputs and nested controls use smaller curves.

Timeline keeps the existing list and duration views, filters, completion actions and event editing. Its controls are flat: one height, no capsule at rest, a fill under the pointer, and the fill and inset edge of a pressed Today row on whatever is chosen, switched on or open. Groups are told apart by spacing, not by a box each. A list row's three actions and the actions at the foot of a game follow the same rule; Play is the one filled button there. Its heading explains the visible range; rounded groups separate status and date information. Data bars retain accurate time geometry. A neutral line marks the present, under a Today capsule in the ruler; red and amber stay reserved for deadlines. A ruler date that would touch the capsule is hidden. Glass is concentrated in navigation and floating tools, with quiet legible content surfaces beneath it.

Paused accounts keep a compact identity row with a Resume action. Their events are absent from both views, counts, search, and finished-event results until tracking resumes. Resume opens the lane and moves keyboard focus to the restored account. Saved events and other accounts are unchanged. Event editing groups details, schedule, and tracking rules; each tracking toggle explains its effect.

### Route continuity and control clarity

Returning to a tab restores its page or timeline-board scroll position for the current game scope. Timeline view, search and finished-event choices last for the current app session; they do not travel through sync or override another device's preferred layout. Lazy pages restore scroll after their content mounts. Workspace navigation still owns the card-to-controls transition and its return focus.

Sheet drags recover if pointer capture is lost. Primary touch controls use 44px targets. Timeline list completion has a visible action label. Long selected game and account names truncate in the closed control and wrap in the open choice list, which stays inside the viewport. Import backup exposes keyboard focus on its visible label. Advanced shared-folder instructions are optional details beneath the direct sync actions.
