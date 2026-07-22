import { Topbar } from '@/components/layout/Topbar';
import { SupportCenterPage } from '@/components/tickets/SupportCenterPage';

export default function Page() {
  return (
    <>
      <Topbar title="Support Center" />
      <div className="p-6">
        <SupportCenterPage />
      </div>
    </>
  );
}
