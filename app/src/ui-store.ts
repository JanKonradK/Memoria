import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Tab = 'home' | 'timeline' | 'settings';
export type TimelineView = 'lanes' | 'agenda';
export type DashboardLayout = 'nexus' | 'cards';
export type TextSize = 's' | 'm' | 'l' | 'xl';

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
  dashboardLayout: DashboardLayout;
  textSize: TextSize;
  setTab(tab: Tab): void;
  openSheet(sheet: NonNullable<SheetRoute>): void;
  closeSheet(): void;
  setReserveOpen(id: string, open: boolean | undefined): void;
  setTimelineView(view: TimelineView): void;
  setDashboardLayout(layout: DashboardLayout): void;
  setTextSize(size: TextSize): void;
}

export const useUI = create<UIStore>()(
  persist(
    (set) => ({
      tab: 'home',
      sheet: null,
      reserveOpen: {},
      timelineView: 'lanes',
      dashboardLayout: 'nexus',
      textSize: 'm',
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
      setDashboardLayout: (dashboardLayout) => set({ dashboardLayout }),
      setTextSize: (textSize) => {
        applyTextSize(textSize);
        set({ textSize });
      },
    }),
    {
      name: 'technogg-ui',
      partialize: (state) => ({
        timelineView: state.timelineView,
        dashboardLayout: state.dashboardLayout,
        textSize: state.textSize,
      }),
      merge: (persisted, current) => {
        const merged = { ...current, ...(persisted as Partial<UIStore>) };
        // The removed 'cockpit' layout may still be in older persisted state.
        if (merged.dashboardLayout !== 'nexus' && merged.dashboardLayout !== 'cards') {
          merged.dashboardLayout = 'nexus';
        }
        return merged;
      },
    },
  ),
);
