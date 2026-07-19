import { Topbar } from '@/components/layout/Topbar';
import { PriceHistoryPage } from '@/components/products/PriceHistoryPage';

export default function Page() {
  return (
    <>
      <Topbar title="Price History" />
      <div className="p-6">
        <PriceHistoryPage />
      </div>
    </>
  );
}
