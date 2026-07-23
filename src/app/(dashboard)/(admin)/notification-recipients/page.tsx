import { Topbar } from '@/components/layout/Topbar';
import { NotificationRecipientsPage } from '@/components/settings/NotificationRecipientsPage';

export default function Page() {
  return (
    <>
      <Topbar title="Notification Recipients" />
      <div className="p-6">
        <NotificationRecipientsPage />
      </div>
    </>
  );
}
