import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Tab = 'home' | 'timeline' | 'settings';
export type TimelineView = 'lanes' | 'agenda';

export type SheetRoute =
  | { kind: 'game'; gameId: string }
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
  setTab(tab: Tab): void;
  openSheet(sheet: NonNullable<SheetRoute>): void;
  closeSheet(): void;
  setReserveOpen(id: string, open: boolean | undefined): void;
  setTimelineView(view: TimelineView): void;
}

export const useUI = create<UIStore>()(
  persist(
    (set) => ({
      tab: 'home',
      sheet: null,
      reserveOpen: {},
      timelineView: 'lanes',
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
    }),
    {
      name: 'technogg-ui',
      partialize: (state) => ({ timelineView: state.timelineView }),
    },
  ),
);
