import { create } from 'zustand';
import { persist } from 'zustand/middleware';

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

export type Tab = 'today' | 'home' | 'timeline' | 'history' | 'settings';
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
export type TimelineView = 'list' | 'lanes';
export const HINT_KEYS = ['energy', 'tasks', 'events'] as const;
export type HintKey = (typeof HINT_KEYS)[number];

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

export function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = theme;
  // The pre-paint script in index.html sets this too, but only on load. Without
  // it here, toggling to light leaves the mobile browser chrome and installed
  // PWA system UI black against a cream page until the next reload.
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_GROUND[theme]);
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
  /** A game closed on this PC after a real session: record what is left. */
  | { kind: 'session'; gameId: string }
  /** What a game added since the player last caught up. */
  | { kind: 'catchUp'; gameId: string }
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
  /** The game whose card sits beside Today's list. Null follows the most urgent game. */
  todayGameId: string | null;
  setTodayGameId(gameId: string | null): void;
  /** Session-only route controls survive navigation, without entering backups. */
  timelineView: TimelineView | null;
  timelineShowFinished: boolean;
  /** The Timeline's own game filter. Opening a game never sets it. Null = all games. */
  timelineGameId: string | null;
  setTimelineGameId(gameId: string | null): void;
  setTimelineView(view: TimelineView): void;
  setTimelineShowFinished(show: boolean): void;
  /** Set when first-run setup finishes: only a new install sees the hints. */
  hintsArmed: boolean;
  hintsSeen: Partial<Record<HintKey, true>>;
  armHints(): void;
  dismissHint(key: HintKey): void;
  setFocusedGameId(gameId: string | null): void;
  setTab(tab: Tab): void;
  /** The Settings pane shown beside its menu on wide windows. Session only. */
  settingsSection: SettingsSection;
  openSettings(section: SettingsSection): void;
  openSheet(sheet: NonNullable<SheetRoute>): void;
  closeSheet(): void;
  setReserveOpen(id: string, open: boolean | undefined): void;
  setTheme(theme: Theme): void;
  /** A once-a-year choice, made in Settings. */
  themePreference: ThemePreference;
  setThemePreference(preference: ThemePreference): void;
  toggleTheme(): void;
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
      timelineView: null,
      timelineShowFinished: false,
      timelineGameId: null,
      setTimelineGameId: (timelineGameId) => set({ timelineGameId }),
      setTimelineView: (timelineView) => set({ timelineView }),
      setTimelineShowFinished: (timelineShowFinished) => set({ timelineShowFinished }),
      hintsArmed: false,
      hintsSeen: {},
      armHints: () => set({ hintsArmed: true, hintsSeen: {} }),
      dismissHint: (key) => set((s) => ({ hintsSeen: { ...s.hintsSeen, [key]: true } })),
      setFocusedGameId: (focusedGameId) => set({ focusedGameId }),
      todayGameId: null,
      setTodayGameId: (todayGameId) => set({ todayGameId }),
      setTab: (tab) => set({ tab }),
      settingsSection: 'games',
      openSettings: (settingsSection) => set({ tab: 'settings', settingsSection }),
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
        applyTheme(theme);
        set({ theme, themePreference: theme });
      },
      themePreference: 'system',
      setThemePreference: (themePreference) => {
        const theme = resolveTheme(themePreference);
        applyTheme(theme);
        set({ theme, themePreference });
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
        reserveOpen: state.reserveOpen,
        logoFlipped: state.logoFlipped,
        hintsArmed: state.hintsArmed,
        hintsSeen: state.hintsSeen,
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
          reserveOpen,
          logoFlipped:
            stored.logoFlipped && typeof stored.logoFlipped === 'object'
              ? Object.fromEntries(
                  Object.keys(stored.logoFlipped)
                    .filter((key) => stored.logoFlipped![key] === true)
                    .map((key) => [key, true as const]),
                )
              : current.logoFlipped,
          hintsArmed: stored.hintsArmed === true,
          hintsSeen:
            stored.hintsSeen && typeof stored.hintsSeen === 'object'
              ? Object.fromEntries(
                  HINT_KEYS.filter((key) => stored.hintsSeen![key] === true).map((key) => [key, true as const]),
                )
              : {},
        };
      },
    },
  ),
);
