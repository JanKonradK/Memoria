import { create } from 'zustand';

export type Tab = 'home' | 'timeline' | 'settings';

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
  setTab(tab: Tab): void;
  openSheet(sheet: NonNullable<SheetRoute>): void;
  closeSheet(): void;
  setReserveOpen(id: string, open: boolean | undefined): void;
}

export const useUI = create<UIStore>((set) => ({
  tab: 'home',
  sheet: null,
  reserveOpen: {},
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
}));
