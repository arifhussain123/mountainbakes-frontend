import { Topbar } from '@/components/layout/Topbar';
import { PriceListPage } from '@/components/products/PriceListPage';

export default function Page() {
  return (
    <>
      <Topbar title="Price List" />
      <div className="p-6">
        <PriceListPage />
      </div>
    </>
  );
}
