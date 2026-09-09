# Small, reusable changes

- Apply [Ponytail](https://github.com/dietrichgebert/ponytail): read the affected flow and its callers before editing.
- Reuse existing helpers, components, styles, and installed dependencies first.
- Make small, focused changes. Preserve working behavior and unrelated code.
- Keep domain calculations in `shared/`. Keep shared UI styles in existing components and tokens.
- Extract repeated logic when real callers need it. Do not add speculative abstractions or dependencies.
- Preserve validation, data-loss handling, accessibility, and user edits.
- Do not add Claude contributor credits or co-author trailers to commits.
- Run `npm run check` and the relevant browser checks before completing a change.

## Code ownership

- `shared/src/`: domain types, validation, migrations, merge rules, and time calculations.
- `app/src/store.ts`: local state mutations and storage. Keep single-item and bulk operations on the same path.
- `app/src/selectors.ts`: derived dashboard data. Reuse shared calculations.
- `app/src/components/ui.tsx` and `primitives.tsx`: shared controls and visual elements.
- `app/src/data/seed-feed.ts`: event facts and source notes. Update this file for new events.
- `app/src/data/seed-events.ts`: import rules. Preserve owner edits, account scope, and deleted events.
- `desktop/`: local launcher and updates. `scripts/` and `app/scripts/`: build and release tools.
