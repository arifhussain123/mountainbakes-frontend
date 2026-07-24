import { create } from 'zustand';

// Client-only UI state. Server state (settings, products, orders, …) lives in
// TanStack Query — see lib/queries.ts and hooks/useSettings.ts — so it is fetched,
// cached, deduped and invalidated in one place rather than mirrored here.
interface AppStore {
  // Sidebar
  sidebarOpen: boolean;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
}

export const useAppStore = create<AppStore>((set) => ({
  // Sidebar
  sidebarOpen: true,
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
}));
