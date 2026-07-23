import { Topbar } from '@/components/layout/Topbar';
import { HelpDeskPage } from '@/components/support/HelpDeskPage';

export default function Page() {
  return (
    <>
      <Topbar title="Help Desk" />
      <div className="p-6">
        <HelpDeskPage />
      </div>
    </>
  );
}
