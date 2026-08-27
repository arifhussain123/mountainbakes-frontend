import { Sidebar } from '@/components/layout/Sidebar';
import { Topbar } from '@/components/layout/Topbar';
import { BottomNav } from '@/components/layout/BottomNav';
import { RealtimeBridge } from '@/components/layout/RealtimeBridge';
import { LoginHistoryBridge } from '@/components/layout/LoginHistoryBridge';
import { PushNotifications } from '@/components/pwa/PushNotifications';
import { RealtimeProvider } from '@/providers/RealtimeProvider';
import { GeofenceProvider } from '@/providers/GeofenceProvider';
import { AppRefreshProvider } from '@/hooks/useAppRefresh';

/**
 * Chrome for every signed-in screen.
 *
 * Topbar is mounted here rather than by each page: all 32 pages used to import it
 * themselves purely to pass a `title`, which meant remounting the notification
 * feed, theme controls and search dialog on every navigation. It now resolves its
 * own heading from the route (see utils/pageTitles.ts).
 *
 * `pb-20 md:pb-0` on <main> reserves room for the mobile bottom nav, which is
 * fixed and would otherwise cover the last rows of a table or a form's submit
 * button.
 *
 * GeofenceProvider sits alongside RealtimeProvider for the same reason it does:
 * one location watcher for the session. Mounted per page it would restart the GPS
 * ticker — and re-prompt for permission — on every navigation.
 *
 * AppRefreshProvider is here rather than in the root layout on the same
 * principle — one refresh timer for the session — and because there is
 * nothing to refresh on the login screen. It must sit above Topbar, whose
 * Refresh button reads it.
 */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <RealtimeProvider>
      <GeofenceProvider>
        <AppRefreshProvider>
          <div className="flex h-screen overflow-hidden bg-background">
            <RealtimeBridge />
            <LoginHistoryBridge />
            <PushNotifications />
            <Sidebar />
            <div className="flex flex-1 flex-col overflow-hidden">
              <Topbar />
              <main className="flex-1 overflow-y-auto pb-20 md:pb-0">{children}</main>
            </div>
            <BottomNav />
          </div>
        </AppRefreshProvider>
      </GeofenceProvider>
    </RealtimeProvider>
  );
}
