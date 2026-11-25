# Roadmap

What is still open after Beta 0.6.0. The November 2026 improvement plan that produced 0.1.0 is done and retired; its record is the git history and `docs/releases/0.1.0.md`.

## Shipped recently

- **Opt-in live game numbers (`Settings → Connections`).** HoYoLAB Real-Time Notes (Genshin, HSR, ZZZ with `sg-public-api` + `bbs-api-os`, endgame cycles, daily check-in and one-tap code/check-in claiming) and **SKPORT** (Arknights: Endfield) work through the isolated window, the **Memoria Browser Connect** extension or pasted cookies sealed in Windows DPAPI / Android Keystore (never in backups or sync).
- **Multi-region & multi-field screenshots.** Frozen-screen 1–8 region snipping, 2× upscaled row-aware Windows OCR, Android Share, and confirm-before-save sheets covering bars, reserves, tasks, endgame cycles and savings in one atomic save.
- **Pull history, Codes tab, Appearance & relay sync.** Dedicated **Codes** tab per game, read-only PC gacha-cache scans & UIGF v4 / WuWa JSON imports on **Pulls**, infinity-to-M mark finishes & app backdrops (with a **Preview Store locks** toggle for planned Pro tiers), and optional self-hosted encrypted Cloudflare relay sync (`relay/`).

## To decide

- **Companion adapters for remaining games.** Wuthering Waves (Global) has no public live-waveplate companion API; KuroBBS Global, Infold, Cygames, Hotta and Devsisters remain candidates only if stable, read-only user endpoints become available. Until then, the local confirm-before-save screenshot reader covers every game safely.

## Next

- **A weekly line under All clear** ("7 of 7 days, 0 capped"). Needs a per-day record of dailies done and energy capped, which the app does not keep yet.
- **Install patches on the next start** on Windows, so a waiting patch needs no click. Today it waits as a dot on Settings until **Restart and update**.
- **Reduce `motion` bundle further.** `domMax` was already slimmed down to `domAnimation` (~6.4 KB gzipped); check whether sheet drag and coin flip can eventually drop the remaining runtime chunk without regressing gestures.

## Outside the repository

- **Code signing** for `Memoria-setup-x64.exe` and `Memoria.exe`, then a **winget** listing: `docs/winget.md`.
