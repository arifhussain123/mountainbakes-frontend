import { create } from 'zustand';

// Client-only UI state. Server state (settings, products, orders, …) lives in
// TanStack Query — see lib/queries.ts and hooks/useSettings.ts — so it is fetched,
// cached, deduped and invalidated in one place rather than mirrored here.
interface AppStore {
  // Sidebar — the mobile drawer
  sidebarOpen: boolean;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;

  // Sidebar — the tablet icon rail (md → lg only; ignored on mobile and desktop)
  sidebarCollapsed: boolean;
  toggleSidebarCollapsed: () => void;
}

export const useAppStore = create<AppStore>((set) => ({
  // Sidebar
  //
  // MUST default to false. This flag only drives the MOBILE drawer: Sidebar
  // pins itself open at md+ with `md:relative md:translate-x-0`, so desktop
  // ignores it entirely. Defaulting to true meant the drawer and its black
  // overlay covered the whole app on a phone's first paint, and the user had to
  // dismiss it before seeing any content.
  sidebarOpen: false,
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),

  sidebarCollapsed: false,
  toggleSidebarCollapsed: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
}));
