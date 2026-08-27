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

export type Tab = 'home' | 'timeline' | 'settings';
export type Theme = 'dark' | 'light';

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
export const THEME_GROUND: Record<Theme, string> = { dark: '#000000', light: '#efeae0' };

export function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = theme;
  // The pre-paint script in index.html sets this too, but only on load. Without
  // it here, toggling to light leaves the mobile browser chrome and installed
  // PWA system UI black against a cream page until the next reload.
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_GROUND[theme]);
}

export type SheetRoute =
  | { kind: 'game'; gameId: string }
  | { kind: 'addGame' }
  | { kind: 'event'; gameId?: string; eventId?: string }
  | { kind: 'reminder' }
  | null;

interface UIStore {
  tab: Tab;
  sheet: SheetRoute;
  reserveOpen: Record<string, boolean>;
  theme: Theme;
  /**
   * Bumped whenever the dashboard is asked to reseal its card order. Card order
   * is frozen while you are looking at it — live re-sorting made cards jump away
   * mid-interaction — so re-sorting is an explicit act. Refresh is that act, and
   * it lives in the app bar while the frozen order lives in DashboardPage, so
   * the two speak through this counter rather than through each other.
   *
   * Session-only: a stale sort order is not a preference worth persisting.
   */
  orderEpoch: number;
  setTab(tab: Tab): void;
  bumpOrderEpoch(): void;
  openSheet(sheet: NonNullable<SheetRoute>): void;
  closeSheet(): void;
  setReserveOpen(id: string, open: boolean | undefined): void;
  setTheme(theme: Theme): void;
  toggleTheme(): void;
}

export const useUI = create<UIStore>()(
  persist(
    (set, get) => ({
      tab: 'home',
      sheet: null,
      reserveOpen: {},
      theme: 'dark',
      orderEpoch: 0,
      setTab: (tab) => set({ tab }),
      bumpOrderEpoch: () => set((state) => ({ orderEpoch: state.orderEpoch + 1 })),
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
        set({ theme });
      },
      toggleTheme: () => get().setTheme(get().theme === 'dark' ? 'light' : 'dark'),
    }),
    {
      // Device-only display preferences are intentionally shared by every identity in this browser.
      name: UI_STORAGE_KEY,
      partialize: (state) => ({ theme: state.theme }),
      merge: (persisted, current) => {
        // Rebuilt from a whitelist rather than spread over the defaults. This
        // store has retired several knobs (text size, focus columns, the Cards
        // layout, the timeline view and range), and a spread carries every one
        // of them forward as inert junk on the devices that still have them
        // persisted. Only what is named here survives a reload.
        const stored = (persisted ?? {}) as Partial<UIStore>;
        return {
          ...current,
          theme: stored.theme === 'dark' || stored.theme === 'light' ? stored.theme : current.theme,
        };
      },
    },
  ),
);
