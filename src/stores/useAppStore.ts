import { create } from 'zustand';
import type { AppSettings } from '@mb/shared';

interface AppStore {
  // Sidebar
  sidebarOpen: boolean;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;

  // Settings
  settings: AppSettings | null;
  setSettings: (settings: AppSettings) => void;
}

export const useAppStore = create<AppStore>((set) => ({
  // Sidebar
  sidebarOpen: true,
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),

  // Settings
  settings: null,
  setSettings: (settings) => set({ settings }),
}));
