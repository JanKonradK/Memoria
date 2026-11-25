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
import type { NoteSort } from '@memoria/shared';
import { isGlyphId, isLogoStyle, type GlyphId, type LogoStyle } from './game-glyphs';
import { DEFAULT_ICON_SET, isIconSet, type IconSet } from './icon-sets';
import { applyLook, DEFAULT_DETAIL, DEFAULT_LOOK, isDetail, isLookId, type Detail, type LookId } from './looks';
import {
  applyBrand,
  DEFAULT_BACKDROP,
  DEFAULT_MARK_BACKING,
  DEFAULT_MARK_COLOUR,
  DEFAULT_MARK_SHADING,
  isBackdropId,
  isMarkBackingId,
  isMarkColourId,
  isMarkShadingId,
  pickBrand,
  type BackdropId,
  type MarkBackingId,
  type MarkColourId,
  type MarkShadingId,
} from './brand';

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

/** The rail's places. `home` is one game's page; `timeline` is the Calendar; `notes` every game's notes. */
export type Tab = 'today' | 'home' | 'timeline' | 'notes' | 'settings';
/** A game page's own tabs. Pulls, Quests, News (Catch up) and Notes live inside each game. */
export type GameTab = 'track' | 'events' | 'codes' | 'pulls' | 'quests' | 'news' | 'notes';
export const GAME_TABS: readonly GameTab[] = ['track', 'events', 'codes', 'pulls', 'quests', 'news', 'notes'];
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

export type SettingsSection =
  | 'games'
  | 'general'
  | 'appearance'
  | 'reminders'
  | 'sync'
  | 'connections'
  | 'device'
  | 'updates'
  | 'data'
  | 'activity';

export type SheetRoute =
  | { kind: 'game'; gameId: string; section?: GameEditorSection }
  | { kind: 'addGame' }
  | { kind: 'event'; gameId?: string; eventId?: string }
  /** The quick view of an existing event; its editor is the `event` route. */
  | { kind: 'eventPeek'; eventId: string }
  | { kind: 'reminder' }
  /** The guide: what each part of the app is, shown in miniature. */
  | { kind: 'guide' }
  /** Every keyboard shortcut, opened with `?` or from Settings. */
  | { kind: 'shortcuts' }
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
  /** Which way the game's page moved last, for its entrance: a swipe can say, else the tab order does. */
  gameTabDirection: 1 | -1;
  setGameTab(tab: GameTab, direction?: 1 | -1): void;
  /** The open game's tabs, in order, as its page shows them. The swipe steps through these. */
  gameTabs: readonly GameTab[];
  setGameTabs(tabs: readonly GameTab[]): void;
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
  /** The last game whose page was open, for a swipe from Today towards Games. Session only. */
  lastGameId: string | null;
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
  /** The app's form (looks.ts). Remembered on this device. */
  look: LookId;
  setLook(look: LookId): void;
  /** Elaborate shows the words; Minimal only the facts and controls. Remembered on this device. */
  detail: Detail;
  setDetail(detail: Detail): void;
  /** The mark's metal, its lighting, its tile, and the app's backdrop (brand.ts). Remembered on this device. */
  markColour: MarkColourId;
  setMarkColour(colour: MarkColourId): void;
  markShading: MarkShadingId;
  setMarkShading(shading: MarkShadingId): void;
  markBacking: MarkBackingId;
  setMarkBacking(backing: MarkBackingId): void;
  backdrop: BackdropId;
  setBackdrop(backdrop: BackdropId): void;
  /**
   * Shows which options the Microsoft Store and Google Play Pro tier would
   * hold (entitlements.ts). Off by default, and off nothing is locked.
   */
  previewStoreLocks: boolean;
  setPreviewStoreLocks(on: boolean): void;
  /** Vibration on touch: swipes, scrubs and ticks. Remembered on this device. */
  vibration: boolean;
  setVibration(on: boolean): void;
  /** The dock's game shelf, on a tall screen. Opens with a game's page, closes with any other place. Session only. */
  shelfOpen: boolean;
  setShelfOpen(open: boolean): void;
  /** The side rail's game list, on a wide screen. Open unless folded away. Remembered on this device. */
  railGamesOpen: boolean;
  setRailGamesOpen(open: boolean): void;
  /** The places' icon set (nav-icons.tsx). Remembered on this device. */
  iconSet: IconSet;
  setIconSet(set: IconSet): void;
  /** How game icons are drawn unless a game has its own choice. Remembered on this device. */
  logoStyle: LogoStyle;
  setLogoStyle(style: LogoStyle): void;
  /** A game's own icon choice, by logoKey: a style, and the symbol when it is Symbol. */
  gameIcons: Record<string, GameIconChoice>;
  setGameIcon(key: string, choice: GameIconChoice | null): void;
  /** How the Notes page lays notes out. Remembered on this device. */
  notesView: NotesView;
  setNotesView(patch: Partial<NotesView>): void;
  /** A short notice with an Undo, over the dock. Session only. */
  undoNotice: UndoNotice | null;
  showUndo(text: string, undo: () => void): void;
  /** Hold the Undo while it is pointed at or focused; resuming gives back what it had left. */
  pauseUndo(): void;
  resumeUndo(): void;
  dismissUndo(): void;
}

export interface NotesView {
  /** Each game's notes under its name, or one wall of every note. */
  group: 'game' | 'wall';
  sort: NoteSort;
  /** Compact clips each note to a few lines until it is opened. */
  density: 'comfortable' | 'compact';
  /** All notes, general ones (no game), or one game's. */
  filter: string;
}
export const DEFAULT_NOTES_VIEW: NotesView = { group: 'game', sort: 'manual', density: 'comfortable', filter: 'all' };

export interface GameIconChoice {
  style?: LogoStyle;
  glyph?: GlyphId;
}

export interface UndoNotice {
  id: number;
  text: string;
  undo: () => void;
}
let undoTimer: ReturnType<typeof setTimeout> | undefined;
let undoSeq = 0;
/** When the latest Undo leaves; while it is held, how long it had left (0 when not held). */
let undoEnds = 0;
let undoLeft = 0;

/** A timer for the latest Undo only: a stale one finds a newer notice, or none, and leaves it. */
function armUndo(ms: number) {
  const id = undoSeq;
  clearTimeout(undoTimer);
  undoEnds = Date.now() + ms;
  undoTimer = setTimeout(() => {
    if (useUI.getState().undoNotice?.id === id) useUI.setState({ undoNotice: null });
  }, ms);
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
      gameTabDirection: 1,
      setGameTab: (gameTab, direction) =>
        set((current) => ({
          gameTab,
          gameTabDirection: direction ?? (GAME_TABS.indexOf(gameTab) >= GAME_TABS.indexOf(current.gameTab) ? 1 : -1),
        })),
      gameTabs: GAME_TABS,
      setGameTabs: (gameTabs) => set({ gameTabs }),
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
      setFocusedGameId: (focusedGameId) =>
        set(focusedGameId ? { focusedGameId, lastGameId: focusedGameId } : { focusedGameId }),
      lastGameId: null,
      todayGameId: null,
      setTodayGameId: (todayGameId) => set({ todayGameId }),
      setTab: (tab) =>
        set({ tab, shelfOpen: tab === 'home', ...(tab === 'settings' ? { settingsPicked: false } : {}) }),
      settingsSection: 'games',
      settingsPicked: false,
      openSettings: (settingsSection) =>
        set({ tab: 'settings', settingsSection, settingsPicked: true, shelfOpen: false }),
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
      look: DEFAULT_LOOK,
      setLook: (look) => {
        applyLook(look, get().detail, true);
        set({ look });
      },
      detail: DEFAULT_DETAIL,
      setDetail: (detail) => {
        applyLook(get().look, detail);
        set({ detail });
      },
      markColour: DEFAULT_MARK_COLOUR,
      setMarkColour: (markColour) => {
        set({ markColour });
        applyBrand(pickBrand(get()));
      },
      markShading: DEFAULT_MARK_SHADING,
      setMarkShading: (markShading) => {
        set({ markShading });
        applyBrand(pickBrand(get()));
      },
      markBacking: DEFAULT_MARK_BACKING,
      setMarkBacking: (markBacking) => {
        set({ markBacking });
        applyBrand(pickBrand(get()));
      },
      backdrop: DEFAULT_BACKDROP,
      setBackdrop: (backdrop) => {
        set({ backdrop });
        applyBrand(pickBrand(get()));
      },
      previewStoreLocks: false,
      setPreviewStoreLocks: (previewStoreLocks) => set({ previewStoreLocks }),
      vibration: true,
      setVibration: (vibration) => set({ vibration }),
      shelfOpen: false,
      setShelfOpen: (shelfOpen) => set({ shelfOpen }),
      railGamesOpen: true,
      setRailGamesOpen: (railGamesOpen) => set({ railGamesOpen }),
      iconSet: DEFAULT_ICON_SET,
      setIconSet: (iconSet) => set({ iconSet }),
      logoStyle: 'coin',
      setLogoStyle: (logoStyle) => set({ logoStyle }),
      gameIcons: {},
      setGameIcon: (key, choice) => {
        const next = { ...get().gameIcons };
        if (choice && (choice.style || choice.glyph)) next[key] = choice;
        else delete next[key];
        set({ gameIcons: next });
      },
      notesView: DEFAULT_NOTES_VIEW,
      setNotesView: (patch) => set({ notesView: { ...get().notesView, ...patch } }),
      undoNotice: null,
      showUndo: (text, undo) => {
        undoLeft = 0;
        set({ undoNotice: { id: ++undoSeq, text, undo } });
        armUndo(7000);
      },
      pauseUndo: () => {
        if (undoLeft || !get().undoNotice) return;
        clearTimeout(undoTimer);
        undoLeft = Math.max(1, undoEnds - Date.now());
      },
      // Let go, it gets back what it had left, never less than a moment to reach it.
      resumeUndo: () => {
        if (undoLeft) armUndo(Math.max(undoLeft, 2500));
        undoLeft = 0;
      },
      dismissUndo: () => {
        clearTimeout(undoTimer);
        set({ undoNotice: null });
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
        look: state.look,
        detail: state.detail,
        markColour: state.markColour,
        markShading: state.markShading,
        markBacking: state.markBacking,
        backdrop: state.backdrop,
        previewStoreLocks: state.previewStoreLocks,
        vibration: state.vibration,
        railGamesOpen: state.railGamesOpen,
        notesView: state.notesView,
        iconSet: state.iconSet,
        logoStyle: state.logoStyle,
        gameIcons: state.gameIcons,
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
          look: isLookId(stored.look) ? stored.look : DEFAULT_LOOK,
          detail: isDetail(stored.detail) ? stored.detail : DEFAULT_DETAIL,
          markColour: isMarkColourId(stored.markColour) ? stored.markColour : DEFAULT_MARK_COLOUR,
          markShading: isMarkShadingId(stored.markShading) ? stored.markShading : DEFAULT_MARK_SHADING,
          markBacking: isMarkBackingId(stored.markBacking) ? stored.markBacking : DEFAULT_MARK_BACKING,
          backdrop: isBackdropId(stored.backdrop) ? stored.backdrop : DEFAULT_BACKDROP,
          previewStoreLocks: stored.previewStoreLocks === true,
          railGamesOpen: stored.railGamesOpen !== false,
          vibration: stored.vibration !== false,
          notesView: readNotesView(stored.notesView),
          iconSet: isIconSet(stored.iconSet) ? stored.iconSet : DEFAULT_ICON_SET,
          logoStyle: isLogoStyle(stored.logoStyle) ? stored.logoStyle : 'coin',
          gameIcons: readGameIcons(stored.gameIcons),
        };
      },
    },
  ),
);

/** A stored Notes layout, each field checked, so an old or odd value falls back to the default. */
function readNotesView(raw: unknown): NotesView {
  const stored = (raw && typeof raw === 'object' ? raw : {}) as Partial<NotesView>;
  return {
    group: stored.group === 'wall' ? 'wall' : 'game',
    sort: stored.sort === 'edited' || stored.sort === 'title' ? stored.sort : 'manual',
    density: stored.density === 'compact' ? 'compact' : 'comfortable',
    filter: typeof stored.filter === 'string' && stored.filter ? stored.filter : 'all',
  };
}

/** Stored game icon choices, each checked; anything unknown is dropped. */
function readGameIcons(raw: unknown): Record<string, GameIconChoice> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, GameIconChoice> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue;
    const { style, glyph } = value as GameIconChoice;
    const choice: GameIconChoice = {
      ...(isLogoStyle(style) ? { style } : {}),
      ...(isGlyphId(glyph) ? { glyph } : {}),
    };
    if (choice.style || choice.glyph) out[key] = choice;
  }
  return out;
}
