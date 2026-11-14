# Roadmap

What is still open after Beta 0.1.0. The November 2026 improvement plan that produced 0.1.0 is done and retired; its record is the git history and `docs/releases/0.1.0.md`.

## To decide

- **Account import for HoYoverse games.** HoYoLAB's Real-Time Notes report Resin, Trailblaze Power, Battery, commissions, expeditions and weekly bosses for Genshin, HSR and ZZZ, and would end typing for those three. It is an unofficial use of a site API, in a grey area of the terms, and needs the player's HoYoLAB token, which must stay per device (Windows DPAPI, Android Keystore) and out of state, backups and sync. It would reverse "Memoria does not read accounts" in `app/PRODUCT.md`. Opt-in only, and the app must stay fully usable without it. No equivalent is known for Wuthering Waves global or NTE.

## Next

- **A weekly line under All clear** ("7 of 7 days, 0 capped"). Needs a per-day record of dailies done and energy capped, which the app does not keep yet.
- **Install patches on the next start** on Windows, so a waiting patch needs no click. Today it waits as a dot on Settings until **Restart and update**.
- **A smaller motion dependency.** `motion` adds a 61 KB features chunk for sheets, toasts, one slide-in and the coin flip; check whether the flip and the sheet drag can share something smaller and move the rest to CSS.

## Outside the repository

- **Code signing** for `Memoria-setup-x64.exe` and `Memoria.exe`, then a **winget** listing: `docs/winget.md`.
- **Cloudflare:** the old `technolibrary` Worker still builds from this repository and comments on pull requests. Delete it in the Cloudflare dashboard (Workers & Pages → technolibrary → Settings → Delete), or disconnect its Git repository there.
