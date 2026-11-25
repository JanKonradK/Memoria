# Memoria

**One dashboard for every gacha you play: what are you about to waste, and when?**

Memoria tracks energy, dailies, weeklies, events and banners across ten preset games (Genshin Impact, Honkai: Star Rail, Zenless Zone Zero, Wuthering Waves, Neverness to Everness, Love and Deepspace, Umamusume: Pretty Derby, Goddess of Victory: NIKKE, Arknights: Endfield and CookieRun: Crumble) plus custom games, each on its own server clock. It runs on Windows, Android and the web, works offline by default, and never touches game memory or hooks game processes. Opt-in on-device **Connections** add HoYoLAB and SKPORT live numbers, one-tap check-in and code claiming, read-only pull history import (local PC cache or UIGF v4 / WuWa JSON), and multi-field confirm-before-save screenshot reading.

**[Download the latest release](https://github.com/JanKonradK/Memoria/releases/latest)** · [Guide](docs/guide.md) · [Report a problem](https://github.com/JanKonradK/Memoria/issues)

![Today: every game ranked by what caps first, a coin flip and a daily ticked off](docs/screenshots/clip-today.png)

## What it does

- **Today** ranks your games by what is lost first and lists everything that caps, ends or resets in the next two days.
- **Timeline** holds every event, banner, reset and livestream, from a calendar that updates between releases.
- **Quests** follows each game's story: main-story acts, world-quest series and character stories, ticked off part by part, with the characters in each.
- **Pulls & Codes** tracks savings, pity (UIGF v4 / WuWa JSON import and Windows read-only cache scans) and free F2P pulls per version, plus a dedicated **Codes** tab on each game with one-tap HoYoLAB claiming when linked.
- **Connections (optional)** reads HoYoLAB Real-Time Notes (Genshin, HSR, ZZZ) and SKPORT (Endfield) via an isolated window, the bundled **Memoria Browser Connect** extension or pasted cookies (sealed with Windows DPAPI / Android Keystore, never in backups or sync), and captures bars, tasks, endgame cycles and savings from screenshots (`Ctrl+Shift+M` / `Shift+S` / Android Share) with confirmation before saving.
- **Appearance** offers eight looks, six colour palettes, an infinity-to-M mark with selectable colours, shadings and tiles, and six app backdrops.
- **Reminders** arrive before resets, caps and event ends, as anything from a silent note to a ringing alarm with snooze.
- **Sync** keeps a PC and a phone in step over Wi-Fi (or away from home over Tailscale or a self-hosted encrypted Cloudflare relay), end-to-end encrypted, with no server holding plaintext.
- **Keyboard** shortcuts include `A/S/D/F` energy stepping, `Enter` to move down Today steps, `Shift+S` / `Ctrl+Shift+M` screenshot capture, `Alt+1..5` navigation and `?` for the full reference.

### Timeline and Pulls

![The Timeline of events and banners, then free pulls per version across games](docs/screenshots/clip-timeline-pulls.png)

### Quests

![Following a main-story act part by part, done or partly done](docs/screenshots/clip-quests.png)

### On a phone, and reminders

<p align="center">
  <img src="docs/screenshots/clip-phone.png" width="300" alt="Memoria on a phone: Today, Timeline, Pulls and Quests" />
  <img src="docs/screenshots/phone-today.png" width="300" alt="Today on a phone" />
</p>

![Reminder styles, from silent to a ringing alarm](docs/screenshots/reminders.png)

## Install

- **Windows:** download `Memoria-setup-x64.exe` and run it. No administrator prompt; it updates itself. If Windows SmartScreen warns, choose **More info → Run anyway** (the installer is not code-signed yet).
- **Android:** download `Memoria-android.apk` on the phone and open it (Android 7+). Updates install over the existing app, or through [Obtainium](https://obtainium.imranr.dev).

Then add your games, type in your energy, and tick dailies as you finish them. The [guide](docs/guide.md) covers syncing a phone, reminders, backups and the rest.

## Development

React, TypeScript and Vite, with a Rust (Tauri) Windows host and a Capacitor Android app; domain logic lives in `shared/`. See the [developer guide](docs/development.md) and the [roadmap](docs/roadmap.md).
