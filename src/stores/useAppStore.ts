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

  // Chat
  chatOpen: boolean;
  activeChatId: string | null;
  openChat: (chatId?: string | null) => void;
  closeChat: () => void;
  setActiveChatId: (id: string | null) => void;
}

export const useAppStore = create<AppStore>((set) => ({
  // Sidebar
  sidebarOpen: true,
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),

  // Settings
  settings: null,
  setSettings: (settings) => set({ settings }),

  // Chat
  chatOpen: false,
  activeChatId: null,
  openChat: (chatId) => set({ chatOpen: true, activeChatId: chatId ?? null }),
  closeChat: () => set({ chatOpen: false, activeChatId: null }),
  setActiveChatId: (id) => set({ activeChatId: id }),
}));
