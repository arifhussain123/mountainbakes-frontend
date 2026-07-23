import { Topbar } from '@/components/layout/Topbar';
import { SupportCenterPage } from '@/components/support/SupportCenterPage';

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
