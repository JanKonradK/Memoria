import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const UI_STORAGE_KEY = 'void-ui';
export const LEGACY_UI_STORAGE_KEY = 'technogg-ui';

export function migrateLegacyUiStorage(): void {
  if (typeof localStorage === 'undefined' || localStorage.getItem(UI_STORAGE_KEY) !== null) return;
  const legacyValue = localStorage.getItem(LEGACY_UI_STORAGE_KEY);
  if (legacyValue === null) return;
  try {
    localStorage.setItem(UI_STORAGE_KEY, legacyValue);
    if (localStorage.getItem(UI_STORAGE_KEY) === legacyValue) {
      localStorage.removeItem(LEGACY_UI_STORAGE_KEY);
    }
  } catch {
    // Keep the source intact so a later load can retry the migration.
  }
}

migrateLegacyUiStorage();

export type Tab = 'home' | 'timeline' | 'settings';
export type TimelineView = 'lanes' | 'agenda';
export type TimelineRange = '7d' | '30d' | '90d';
export type DashboardLayout = 'nexus' | 'cards';
export type TextSize = 's' | 'm' | 'l' | 'xl';
export type FocusColumns = 'one' | 'two' | 'auto';

export const TIMELINE_RANGE_DAYS: Record<TimelineRange, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
};

export const TEXT_SIZE_SCALE: Record<TextSize, number> = {
  s: 0.9,
  m: 1,
  l: 1.12,
  xl: 1.28,
};

export function applyTextSize(textSize: TextSize): void {
  if (typeof document !== 'undefined') {
    document.documentElement.style.setProperty('--ui-scale', String(TEXT_SIZE_SCALE[textSize]));
  }
}

export type SheetRoute =
  | { kind: 'game'; gameId: string }
  /** The game's live card in a dialog — controls, not settings. */
  | { kind: 'gameCard'; gameId: string }
  | { kind: 'addGame' }
  | { kind: 'event'; gameId?: string; eventId?: string }
  | { kind: 'reminder' }
  | { kind: 'pasteEvents' }
  | null;

interface UIStore {
  tab: Tab;
  sheet: SheetRoute;
  reserveOpen: Record<string, boolean>;
  timelineView: TimelineView;
  timelineRange: TimelineRange;
  dashboardLayout: DashboardLayout;
  textSize: TextSize;
  focusColumns: FocusColumns;
  setTab(tab: Tab): void;
  openSheet(sheet: NonNullable<SheetRoute>): void;
  closeSheet(): void;
  setReserveOpen(id: string, open: boolean | undefined): void;
  setTimelineView(view: TimelineView): void;
  setTimelineRange(range: TimelineRange): void;
  setDashboardLayout(layout: DashboardLayout): void;
  setTextSize(size: TextSize): void;
  setFocusColumns(value: FocusColumns): void;
}

export const useUI = create<UIStore>()(
  persist(
    (set) => ({
      tab: 'home',
      sheet: null,
      reserveOpen: {},
      timelineView: 'lanes',
      timelineRange: '30d',
      dashboardLayout: 'nexus',
      textSize: 'm',
      focusColumns: 'auto',
      setTab: (tab) => set({ tab }),
      openSheet: (sheet) => set({ sheet }),
      closeSheet: () => set({ sheet: null }),
      setReserveOpen: (id, open) =>
        set((state) => {
          const reserveOpen = { ...state.reserveOpen };
          if (open === undefined) delete reserveOpen[id];
          else reserveOpen[id] = open;
          return { reserveOpen };
        }),
      setTimelineView: (timelineView) => set({ timelineView }),
      setTimelineRange: (timelineRange) => set({ timelineRange }),
      setDashboardLayout: (dashboardLayout) => set({ dashboardLayout }),
      setTextSize: (textSize) => {
        applyTextSize(textSize);
        set({ textSize });
      },
      setFocusColumns: (focusColumns) => set({ focusColumns }),
    }),
    {
      // Device-only display preferences are intentionally shared by every identity in this browser.
      name: UI_STORAGE_KEY,
      partialize: (state) => ({
        timelineView: state.timelineView,
        timelineRange: state.timelineRange,
        dashboardLayout: state.dashboardLayout,
        textSize: state.textSize,
        focusColumns: state.focusColumns,
      }),
      merge: (persisted, current) => {
        const merged = { ...current, ...(persisted as Partial<UIStore>) };
        // The removed 'cockpit' layout may still be in older persisted state.
        if (merged.dashboardLayout !== 'nexus' && merged.dashboardLayout !== 'cards') {
          merged.dashboardLayout = 'nexus';
        }
        if (merged.timelineRange !== '7d' && merged.timelineRange !== '30d' && merged.timelineRange !== '90d') {
          merged.timelineRange = '30d';
        }
        return merged;
      },
    },
  ),
);
