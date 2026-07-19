import { Sidebar } from '@/components/layout/Sidebar';
import { PresenceWatcher } from '@/components/layout/PresenceWatcher';
import { PushNotifications } from '@/components/pwa/PushNotifications';
import { RealtimeProvider } from '@/providers/RealtimeProvider';

export const dynamic = 'force-dynamic';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <RealtimeProvider>
      <div className="flex h-screen overflow-hidden bg-background">
        <PresenceWatcher />
        <PushNotifications />
        <Sidebar />
        <div className="flex-1 flex flex-col overflow-hidden">
          <main className="flex-1 overflow-y-auto">
            {children}
          </main>
        </div>
      </div>
    </RealtimeProvider>
  );
}
