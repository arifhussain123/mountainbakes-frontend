import { Sidebar } from '@/components/layout/Sidebar';
import { Topbar } from '@/components/layout/Topbar';
import { BottomNav } from '@/components/layout/BottomNav';
import { RealtimeBridge } from '@/components/layout/RealtimeBridge';
import { PushNotifications } from '@/components/pwa/PushNotifications';
import { RealtimeProvider } from '@/providers/RealtimeProvider';

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
 */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <RealtimeProvider>
      <div className="flex h-screen overflow-hidden bg-background">
        <RealtimeBridge />
        <PushNotifications />
        <Sidebar />
        <div className="flex flex-1 flex-col overflow-hidden">
          <Topbar />
          <main className="flex-1 overflow-y-auto pb-20 md:pb-0">{children}</main>
        </div>
        <BottomNav />
      </div>
    </RealtimeProvider>
  );
}
