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
          {/* `dvh`, with `vh` only as the fallback for a browser without it. On
              iOS Safari 100vh is the height with the toolbar COLLAPSED, so a
              100vh shell is taller than what is visible and the bottom of every
              screen sits behind the toolbar. 100dvh is what is actually on show. */}
          <div className="flex h-screen overflow-hidden bg-background supports-[height:100dvh]:h-dvh">
            <RealtimeBridge />
            <LoginHistoryBridge />
            <PushNotifications />
            <Sidebar />
            <div className="flex flex-1 flex-col overflow-hidden">
              <Topbar />
              {/* Clears the BottomNav INCLUDING its safe-area inset. The nav is
                  56px + the inset (34px on a Face ID iPhone); a flat pb-20 left the
                  last 11px of every page underneath it. */}
              <main className="flex-1 overflow-y-auto overscroll-contain pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-0">{children}</main>
            </div>
            <BottomNav />
          </div>
        </AppRefreshProvider>
      </GeofenceProvider>
    </RealtimeProvider>
  );
}
