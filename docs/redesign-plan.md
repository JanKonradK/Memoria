# Redesign plan

Agreed 2026-10-10 on branch `merge-games-into-today`. One phase per session; each leaves the app working.
While working, run the browser suite on `desktop` and `mobile-390` only, then all profiles once at the end of the phase.

## Decisions

- **Type:** DM Sans for everything. Secondary text uses a light italic instead of bold. Each game's name uses the face its round logo in `docs/logos` uses, in the same weight, case and spacing (Wuthering Waves is Vujahday Script). The mono numeral face is removed.
- **Game icon:** the game's full name on two lines (Genshin / Impact, Honkai: / Star Rail, Zenless / Zone Zero, Wuthering / Waves, Neverness / To Everness) inside an outer ring. The ring is two colours taken from the game's logo, interlocked like yin and yang, rotating. Only the ring moves.
- **Event parts:** inferred from the kind of event, editable per event. A 7-day login is 7 parts. A roughly 420-primogem event is 5 to 6. A 1000+ primogem event is the 3 story parts plus the free character, weapon or skin.
- **Buttons:** primary actions such as Open full page sit at the bottom of their surface, not the top.
- **Motion:** the earlier note against animating a card into its page is withdrawn; delete it from `app/DESIGN.md`. The performance floor is a Galaxy Tab S7+.

## Phases

1. **One font.** Swap the type system as decided above. Update `fonts.ts`, the font imports, the game editor, design-token tests and `app/DESIGN.md`.
2. **Today surface.** Restyle the game card and Tonight to match the flat list: page ground, hairline rules, no tinted glass rectangle. Build the new game icon. Move Open full page to the bottom of the card.
3. **Game page layout.** Left column: resources, then Daily, Cycle and Weekly beneath them. Right column: that game's events with a clear done control. Readings, Manage events, Add event and Pause move to a bottom bar.
4. **Event parts.** Add parts to the event model so they survive sync, backups and the bundled feed. Infer a default count; show N segments that tick off; the event is done when all are.
5. **Rest of the app.** Carry the flat row style into Calendar's list, Livestreams, Settings and the edit sheets.
6. **Motion.** One set of timings and easings; rows animate when they change group; pressed and completed states; numbers tick; shared transitions between a row and its page; consistent sheets. Verify on the Tab S7+.

## Open points

- The script face has one weight and thin strokes. Check game names stay readable at list-row size in phase 2; if not, the name moves beside the ring at that size.
- The bundled feed has no reward field. Reward amounts appear only in some events' notes text, so the inferred part count is a starting guess the user can change.
- Ring colours for preset games are picked by hand from each game's branding. Custom games use the two colours the user chose.

## Status

All six phases are built on `merge-games-into-today`. Still to do by hand: check motion on the Galaxy Tab S7+ (opening and closing a game, scrolling Today with the logos turning, ticking event parts).
