import { Topbar } from '@/components/layout/Topbar';
import { MyTicketsPage } from '@/components/tickets/MyTicketsPage';

export default function Page() {
  return (
    <>
      <Topbar title="Help Desk" />
      <div className="p-6">
        <MyTicketsPage />
      </div>
    </>
  );
}
