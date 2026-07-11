import { create } from 'zustand';

export type Tab = 'home' | 'timeline' | 'stats' | 'settings';

export type SheetRoute =
  | { kind: 'game'; gameId: string }
  | { kind: 'addGame' }
  | { kind: 'event'; gameId?: string; eventId?: string }
  | { kind: 'reminder' }
  | { kind: 'hoyoImport' }
  | { kind: 'pasteEvents' }
  | null;

interface UIStore {
  tab: Tab;
  sheet: SheetRoute;
  setTab(tab: Tab): void;
  openSheet(sheet: NonNullable<SheetRoute>): void;
  closeSheet(): void;
}

export const useUI = create<UIStore>((set) => ({
  tab: 'home',
  sheet: null,
  setTab: (tab) => set({ tab }),
  openSheet: (sheet) => set({ sheet }),
  closeSheet: () => set({ sheet: null }),
}));
