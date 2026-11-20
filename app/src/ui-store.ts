import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import {
  DEFAULT_PALETTE,
  FAMILIES,
  findPalette,
  isPaletteId,
  PALETTE_PROPERTIES,
  paletteVars,
  surfacesOf,
} from './palettes';

export const UI_STORAGE_KEY = 'memoria-ui';
/**
 * Every previous name this store has shipped under, newest first. The app has
 * been renamed twice (TechnoGG → Void → Memoria) and these are device-only
 * display preferences — losing them is not catastrophic, but a user who has set
 * a theme should not have it silently reset by a rename.
 */
const LEGACY_UI_STORAGE_KEYS = ['void-ui', 'technogg-ui'] as const;

export function migrateLegacyUiStorage(): void {
  if (typeof localStorage === 'undefined' || localStorage.getItem(UI_STORAGE_KEY) !== null) return;
  for (const legacyKey of LEGACY_UI_STORAGE_KEYS) {
    const legacyValue = localStorage.getItem(legacyKey);
    if (legacyValue === null) continue;
    try {
      localStorage.setItem(UI_STORAGE_KEY, legacyValue);
      // Only drop the source once the copy is known to have landed, so a quota
      // failure leaves a later load something to retry from.
      if (localStorage.getItem(UI_STORAGE_KEY) === legacyValue) localStorage.removeItem(legacyKey);
    } catch {
      // Keep the source intact so a later load can retry the migration.
    }
    return;
  }
}

migrateLegacyUiStorage();

/** The rail's places. `home` is one game's page; `timeline` is the Calendar. */
export type Tab = 'today' | 'home' | 'timeline' | 'settings';
/** A game page's own tabs. Pulls, Quests and News (Catch up) live inside each game. */
export type GameTab = 'track' | 'events' | 'pulls' | 'quests' | 'news';
export const GAME_TABS: readonly GameTab[] = ['track', 'events', 'pulls', 'quests', 'news'];
/** Today as one ordered list of steps across games, or as the ranked games. */
export type TodayView = 'steps' | 'games';
export type Theme = 'dark' | 'light';
/** What the player chose. System follows the device, which is the default. */
export type ThemePreference = Theme | 'system';

/** The device's own light or dark setting. */
export function systemTheme(): Theme {
  try {
    return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}
export const resolveTheme = (preference: ThemePreference): Theme =>
  preference === 'system' ? systemTheme() : preference;
/** The Calendar's ways of seeing the same events. */
export type TimelineView = 'lanes' | 'agenda' | 'month' | 'soon';
export const TIMELINE_VIEWS: readonly TimelineView[] = ['lanes', 'agenda', 'month', 'soon'];
/** How much time the Calendar's timeline spans: a week, four weeks, or a season (nine weeks). */
export type TimelineRange = 'week' | 'month' | 'season';

/**
 * The theme is a token re-point on the root element — see index.css. Nothing
 * below the token layer knows a theme exists, so this is the only place in the
 * app that touches the DOM for it.
 */
/**
 * The page ground per theme. Must match --color-surface-0 in index.css, the
 * literals in index.html's pre-paint script, and THEME_GROUND re-exported from
 * theme.ts — design-tokens.test.ts asserts all four agree.
 *
 * It lives here rather than in theme.ts because theme.ts imports this store for
 * its hooks, and a colour constant is not worth an import cycle.
 */
export const THEME_GROUND: Record<Theme, string> = { dark: '#0c0d0f', light: '#f6f7f9' };

/** What the pre-paint script in index.html reads: the properties for each theme, so a reload paints the chosen palette first. */
export const PAINT_STORAGE_KEY = 'memoria-paint';

/** The accent chosen for a palette family, or null for that family's default. */
export function accentFor(accents: Partial<Record<string, string>>, palette: string): string | null {
  return accents[findPalette(palette).family.id] ?? null;
}

export function applyTheme(theme: Theme, palette: string = DEFAULT_PALETTE, accent: string | null = null): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.dataset.theme = theme;
  for (const property of PALETTE_PROPERTIES) root.style.removeProperty(property);
  for (const [property, value] of Object.entries(paletteVars(palette, theme, accent))) {
    root.style.setProperty(property, value);
  }
  // The pre-paint script in index.html sets this too, but only on load. Without
  // it here, switching theme leaves the mobile browser chrome and installed PWA
  // system UI the old colour until the next reload.
  const ground = surfacesOf(palette, theme).ground;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', ground);
  try {
    const paint = (forTheme: Theme) => ({
      ground: surfacesOf(palette, forTheme).ground,
      vars: paletteVars(palette, forTheme, accent),
    });
    localStorage.setItem(PAINT_STORAGE_KEY, JSON.stringify({ dark: paint('dark'), light: paint('light') }));
  } catch {
    // Without storage the palette still applies; a reload just paints Memoria first.
  }
}

export type GameEditorSection = 'game' | 'resets' | 'resources' | 'spend' | 'tasks' | 'reminders' | 'events';

export type SettingsSection = 'games' | 'general' | 'reminders' | 'sync' | 'device' | 'updates' | 'data' | 'activity';

export type SheetRoute =
  | { kind: 'game'; gameId: string; section?: GameEditorSection }
  | { kind: 'addGame' }
  | { kind: 'event'; gameId?: string; eventId?: string }
  /** The quick view of an existing event; its editor is the `event` route. */
  | { kind: 'eventPeek'; eventId: string }
  | { kind: 'reminder' }
  /** The guide: what each part of the app is, shown in miniature. */
  | { kind: 'guide' }
  /** What a game added since the player last caught up. */
  | null;

interface UIStore {
  tab: Tab;
  sheet: SheetRoute;
  reserveOpen: Record<string, boolean>;
  /** Game logos turned to their short-name side, by logo key. Remembered on this device. */
  logoFlipped: Record<string, true>;
  flipLogo(key: string): void;
  theme: Theme;
  focusedGameId: string | null;
  /** The tab open on a game's page. Session only; opening another game keeps it. */
  gameTab: GameTab;
  setGameTab(tab: GameTab): void;
  /** Steps or Games on Today. Remembered on this device. */
  todayView: TodayView;
  setTodayView(view: TodayView): void;
  /** The game whose card sits beside Today's list. Null follows the most urgent game. */
  todayGameId: string | null;
  setTodayGameId(gameId: string | null): void;
  /** Session-only route controls survive navigation, without entering backups. */
  timelineView: TimelineView | null;
  timelineShowFinished: boolean;
  /** Games the Calendar hides, by id. Its own filter: opening a game never sets it. Session only. */
  timelineHiddenGameIds: string[];
  toggleTimelineGame(gameId: string): void;
  /** Null follows the window: a week on a phone, four weeks wider. Session only. */
  timelineRange: TimelineRange | null;
  setTimelineRange(range: TimelineRange): void;
  setTimelineView(view: TimelineView): void;
  setTimelineShowFinished(show: boolean): void;
  /** Set when first-run setup finishes: only a new install sees the hints. */
  setFocusedGameId(gameId: string | null): void;
  setTab(tab: Tab): void;
  /** The Settings pane shown beside its menu on wide windows. Session only. */
  settingsSection: SettingsSection;
  /**
   * A section was asked for by name (Device sync from a sync warning, say).
   * On a narrow screen Settings opens on its menu unless one was.
   */
  settingsPicked: boolean;
  /** Back to the menu on a narrow screen. */
  closeSettingsSection(): void;
  openSettings(section: SettingsSection): void;
  openSheet(sheet: NonNullable<SheetRoute>): void;
  closeSheet(): void;
  setReserveOpen(id: string, open: boolean | undefined): void;
  setTheme(theme: Theme): void;
  /** A once-a-year choice, made in Settings. */
  themePreference: ThemePreference;
  setThemePreference(preference: ThemePreference): void;
  toggleTheme(): void;
  /** A palette flavour id from palettes.ts. */
  palette: string;
  /** The accent chosen per palette family; a missing family uses its default. */
  accents: Partial<Record<string, string>>;
  setPalette(palette: string): void;
  setAccent(accent: string): void;
}

export const useUI = create<UIStore>()(
  persist(
    (set, get) => ({
      tab: 'today',
      sheet: null,
      reserveOpen: {},
      logoFlipped: {},
      flipLogo: (key) =>
        set((state) => {
          const logoFlipped = { ...state.logoFlipped };
          if (logoFlipped[key]) delete logoFlipped[key];
          else logoFlipped[key] = true;
          return { logoFlipped };
        }),
      theme: resolveTheme('system'),
      focusedGameId: null,
      gameTab: 'track',
      setGameTab: (gameTab) => set({ gameTab }),
      todayView: 'steps',
      setTodayView: (todayView) => set({ todayView }),
      timelineView: null,
      timelineShowFinished: false,
      timelineHiddenGameIds: [],
      toggleTimelineGame: (gameId) =>
        set((state) => ({
          timelineHiddenGameIds: state.timelineHiddenGameIds.includes(gameId)
            ? state.timelineHiddenGameIds.filter((id) => id !== gameId)
            : [...state.timelineHiddenGameIds, gameId],
        })),
      timelineRange: null,
      setTimelineRange: (timelineRange) => set({ timelineRange }),
      setTimelineView: (timelineView) => set({ timelineView }),
      setTimelineShowFinished: (timelineShowFinished) => set({ timelineShowFinished }),
      setFocusedGameId: (focusedGameId) => set({ focusedGameId }),
      todayGameId: null,
      setTodayGameId: (todayGameId) => set({ todayGameId }),
      setTab: (tab) => set(tab === 'settings' ? { tab, settingsPicked: false } : { tab }),
      settingsSection: 'games',
      settingsPicked: false,
      openSettings: (settingsSection) => set({ tab: 'settings', settingsSection, settingsPicked: true }),
      closeSettingsSection: () => set({ settingsPicked: false }),
      openSheet: (sheet) => set({ sheet }),
      closeSheet: () => set({ sheet: null }),
      setReserveOpen: (id, open) =>
        set((state) => {
          const reserveOpen = { ...state.reserveOpen };
          if (open === undefined) delete reserveOpen[id];
          else reserveOpen[id] = open;
          return { reserveOpen };
        }),
      setTheme: (theme) => {
        applyTheme(theme, get().palette, accentFor(get().accents, get().palette));
        set({ theme, themePreference: theme });
      },
      themePreference: 'system',
      setThemePreference: (themePreference) => {
        const theme = resolveTheme(themePreference);
        applyTheme(theme, get().palette, accentFor(get().accents, get().palette));
        set({ theme, themePreference });
      },
      palette: DEFAULT_PALETTE,
      accents: {},
      setPalette: (palette) => {
        applyTheme(get().theme, palette, accentFor(get().accents, palette));
        set({ palette });
      },
      setAccent: (accent) => {
        const { palette, theme } = get();
        const accents = { ...get().accents, [findPalette(palette).family.id]: accent };
        applyTheme(theme, palette, accent);
        set({ accents });
      },
      toggleTheme: () => get().setTheme(get().theme === 'dark' ? 'light' : 'dark'),
    }),
    {
      // Device-only display preferences are intentionally shared by every identity in this browser.
      name: UI_STORAGE_KEY,
      // The reserve disclosure is now opt-in rather than self-opening, which
      // only works if the opt-in survives a reload — otherwise every visit
      // re-hides a counter the user just said they wanted to watch.
      partialize: (state) => ({
        theme: state.theme,
        themePreference: state.themePreference,
        palette: state.palette,
        accents: state.accents,
        reserveOpen: state.reserveOpen,
        logoFlipped: state.logoFlipped,
        todayView: state.todayView,
      }),
      merge: (persisted, current) => {
        // Rebuilt from a whitelist rather than spread over the defaults. This
        // store has retired several knobs (text size, focus columns, the Cards
        // layout, the Tonight position, the timeline view and range), and a
        // spread carries every one of them forward as inert junk on the devices
        // that still have them persisted. Only what is named here survives a
        // reload.
        const stored = (persisted ?? {}) as Partial<UIStore>;
        const reserveOpen =
          stored.reserveOpen && typeof stored.reserveOpen === 'object'
            ? Object.fromEntries(Object.entries(stored.reserveOpen).filter(([, open]) => typeof open === 'boolean'))
            : current.reserveOpen;
        // A theme saved before the preference existed was a choice; keep it.
        const themePreference: ThemePreference =
          stored.themePreference === 'system' || stored.themePreference === 'dark' || stored.themePreference === 'light'
            ? stored.themePreference
            : stored.theme === 'dark' || stored.theme === 'light'
              ? stored.theme
              : 'system';
        return {
          ...current,
          themePreference,
          theme: resolveTheme(themePreference),
          palette: isPaletteId(stored.palette) ? stored.palette : DEFAULT_PALETTE,
          accents:
            stored.accents && typeof stored.accents === 'object'
              ? Object.fromEntries(
                  Object.entries(stored.accents).filter(
                    ([family, accent]) => typeof accent === 'string' && FAMILIES.some((known) => known.id === family),
                  ),
                )
              : {},
          reserveOpen,
          logoFlipped:
            stored.logoFlipped && typeof stored.logoFlipped === 'object'
              ? Object.fromEntries(
                  Object.keys(stored.logoFlipped)
                    .filter((key) => stored.logoFlipped![key] === true)
                    .map((key) => [key, true as const]),
                )
              : current.logoFlipped,
          todayView: stored.todayView === 'games' ? 'games' : 'steps',
        };
      },
    },
  ),
);
