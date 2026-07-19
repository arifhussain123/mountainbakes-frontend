import { Topbar } from '@/components/layout/Topbar';
import { OrdersPage } from '@/components/orders/OrdersPage';

export default function Page() {
  return (
    <>
      <Topbar title="All Orders" />
      <div className="p-6">
        <OrdersPage />
      </div>
    </>
  );
}
