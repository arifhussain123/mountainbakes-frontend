import { Topbar } from '@/components/layout/Topbar';
import { NewOrdersPage } from '@/components/production-orders/NewOrdersPage';

export default function Page() {
  return (
    <>
      <Topbar title="New Orders" />
      <div className="p-6">
        <NewOrdersPage />
      </div>
    </>
  );
}
