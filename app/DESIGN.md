# Memoria design

## Direction contract

**Thesis:** A unified, softly rounded glass workspace for daily game progress and upcoming events.

**Own world:** Game colors identify games and tint the light in each card. Urgency colors identify deadlines. Graphite chrome frames rounded, translucent game surfaces with a fine reflected edge and a soft shadow below.

**Story:** Find the game that needs attention, update energy, complete tasks, then check upcoming events.

**First viewport:** Desktop keeps game summaries beside Tonight. Phone presents readable game summaries, energy levels, and daily progress above a floating glass navigation dock.

**Form:** DM Sans for language, IBM Plex Mono for compact measurements, and each game's saved title font. Standard cards and sheets use 32px corners with progressive continuous corner support. Compact overview cards use 24px corners. Controls use nested 10px, 16px and 24px curves; navigation and segmented controls use capsules. Glass light is static; motion follows presses, progress, and navigation.

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

All font subsets remain available. Never remove non-Latin support to reduce a bundle.

## Layout and interaction

All features are available on Android, including the Samsung S23 Ultra. The phone overview opens the same complete game controls as desktop. A single back arrow returns to the overview. Tonight & reminders opens the full summary. Cards select a game on Dashboard; the game selector filters Timeline, Livestreams, and Settings.

Phone cards lead with the game name, then server, account and daily progress on one line. A compact energy reading and bar lead to the next deadline. The whole card opens its workspace; a small arrow marks that action. Daily progress shows the completed and total counts. Its ring earns a check only when all dailies are complete. The overview has no visible page heading. Games and Tonight remain available through the view control.

Use 8px gaps and compact padding in the overview. At default text size, four complete games fit on a 320×720 phone and five fit on a 412×915 phone above the navigation dock. Supporting labels can truncate; accessible descriptions retain their full text. Cards can grow with larger text. Smaller desktop windows use the same compact cards in two or three columns. Avoid repeating the game heading above the open card.

Desktop retains the three-column stage with equal widths and the configurable Tonight position. Opening a game uses the same integrated page as mobile; Back restores the overview position. Card order stays fixed until Refresh. A clock tick must never move the control being edited.

Alt+Left and browser Back follow the game back arrow. Forward reopens the game. Return restores the overview scroll and card focus. An open editor handles Back first and retains its unsaved-change guard. A typed energy value commits before return; Escape still cancels that field's draft.

Task rows share one control and one state path. Names wrap on phones. Dailies, cycles, weekly and monthly tasks retain their group labels and reset countdowns. Energy projections and all time calculations use shared domain functions.

The event page opens in List view on phones. Timeline remains available, including event reordering. Distinguish event categories and server/account scope. Long reminders remain readable.

Primary phone targets are at least 44px. Content, notices, and sheets clear the bottom navigation and device safe areas. Phone landscape uses a compact header. Desktop controls can be denser.

## Editors

Phone and computer connection comes first in Settings. The primary flow is Connect my phone on the PC, then Scan PC code on Android. The QR code carries the temporary code and local addresses. Keep manual entry, connection management, and troubleshooting behind optional disclosures. Connected and offline states explain what happens to saved progress. A failed or cancelled replacement scan keeps the existing connection.

Use existing shared inputs, buttons, tabs, and sheets. Fields use sentence-case labels and clear grouping. Event and reminder actions remain outside the scrolling form. Game edits save automatically and expose a Done button. Preserve validation, dirty drafts, cancel behavior, deletion safeguards, and account scope.

The game editor opens on Energy, then exposes Tasks, Resets, Reminders, Quick spend, and Game identity. Resources and routines expand in place. Resource order is editable without changing readings. Priority tasks lead their group. Reset settings show the local daily reset time and all supported server zones. Game reminders can be added and edited in place; their draft survives tab changes. Appearance and deletion stay under Game.

A short touch on an energy stepper changes it once. A long touch repeats after 350ms. A scroll or cancelled gesture changes nothing. Keyboard operation remains available.

## Motion and performance

Motion explains a state change. Use a short directional page transition and a brief task completion response. Energy bars use two elements and no perpetual sweep. Card highlights remain static; a touch gently compresses the card and its arrow responds to the same press. Route content is usable immediately; do not stagger access to controls.

Urgent game cards use a small status dot with a 3.2-second breath. Borders stay neutral, and overview energy bars keep the game’s identity color. Status text remains readable without relying on color. The pulse pauses offscreen, in hidden tabs, on hover, and during keyboard interaction. Reduced motion shows a static dot. Game expansion uses one critically damped spring for its crop and content crossfade, with the same physics for card movement. Reversals preserve motion. Collapsing cards stay above resting cards until they settle. Navigation fades gently over 260ms. Energy levels glide with a transform, without a perpetual sweep. Dialogs use a small 8px arrival and a faster exit. Phone sheets use one transform for entrance, direct dragging, snap-back, and dismissal, so the surface follows the finger without a jump.

Respect reduced motion. Lazy-load routes and motion features. Reuse the shared derived-data cache; do not duplicate domain calculations in components.

At every width, a selected roster card opens a full game page with a plain identity heading and one Edit control. Do not nest that page inside another glass card. One back arrow restores the roster position and keyboard focus. Use a short transform/opacity transition on page content; full-card View Transition snapshots caused repeated layout and paint work on slower hardware. Keep the fixed header and navigation still. Reduced motion changes the view immediately. Rapid reversal must keep the final controls usable. Task completion stays close to its original control: a small check response and one fading outline, without particles over nearby rows.

## Validation

Run `npm run check` and relevant browser checks. Inspect desktop, phone, small phone, and light mode. Check overflow, keyboard focus, touch targets, form actions, contrast, and preservation of user edits. A design change does not change storage or add cross-device sync.

### Per-game editing

The dashboard has a visible Edit button. The game title is editable at the top. Each item has a separate Edit button and drag handle. Edit opens its settings, move buttons, hide, and delete actions. Task items expose cadence, checkbox/counter/timer mode, count targets, timer rules, timeline links, and priority. Settings uses the same task fields. Add item creates a task, manual counter, or energy resource without leaving the card; hidden items can also be restored there. Deletion uses the store's existing tombstones and offers Undo delete, preserving tracking history. Resets, reminders, and appearance remain in Settings.

Hold anywhere on an item for 400 ms to lift it, then drag and release to place it. A quick touch swipe still scrolls normally. Mouse dragging and keyboard arrows offer the same movement. There is no bottom widget toolbar. A lifted item follows the pointer, and nearby items move into their new positions. The drag preview is inert, so moving an item never changes a value or completes a task. Reduced motion removes position animation.

Changes save as you go. Done closes Edit. Undo layout restores only the arrangement from the start of the session; Reset restores the default grouped dashboard. Each game's layout travels through the existing backup and sync paths. Inactive tasks keep their positions. Each item occupies one full row on phone and desktop. Old backups keep their order and hidden items; obsolete width values are removed during normalization.

### Navigation and timeline material

Genshin card events appear in three sections: Teyvat, Miliastra Wonderland, then Banners. Each card section shows all active events and its next upcoming event. Cosmetic draws belong in Banners. Manage events and Timeline lanes use the same section order, including search results and finished events. Timeline reordering stays within a section and preserves the owner's order there. Other games keep their compact card summaries. Timeline keeps its inline world tags.

Official calendar entries show confirmed date ranges in the publisher's calendar timezone. They do not show hourly countdowns or send deadline alerts without a published hour. Exact notices retain their clocks. Personal edits to the time fields retain the owner's chosen schedule.

Navigation floats in a glass capsule with one persistent moving selection. On phones the dock clears the safe area and content reserves its full height; all four routes retain text labels and touch targets. Blue marks the selected route. Content and urgency retain their own colours. Settings and broadcasts use the same large curved surfaces. Inputs and nested controls use smaller curves.

Timeline keeps the existing list and duration views, filters, completion actions and event editing. Its heading explains the visible range; rounded groups separate status and date information. Data bars retain accurate time geometry. Glass is concentrated in navigation and floating tools, with quiet legible content surfaces beneath it.

Paused accounts keep a compact identity row with a Resume action. Their events are absent from both views, counts, search, and finished-event results until tracking resumes. Resume opens the lane and moves keyboard focus to the restored account. Saved events and other accounts are unchanged. Event editing groups details, schedule, and tracking rules; each tracking toggle explains its effect.

### Route continuity and control clarity

Returning to a tab restores its page or timeline-board scroll position for the current game scope. Timeline view, search and finished-event choices last for the current app session; they do not travel through sync or override another device's preferred layout. Lazy pages restore scroll after their content mounts. Workspace navigation still owns the card-to-controls transition and its return focus.

Sheet drags recover if pointer capture is lost. Primary touch controls use 44px targets. Timeline list completion has a visible action label. Long selected game and account names truncate in the closed control and wrap in the open choice list, which stays inside the viewport. Import backup exposes keyboard focus on its visible label. Advanced shared-folder instructions are optional details beneath the direct sync actions.
