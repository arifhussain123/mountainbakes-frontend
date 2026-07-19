import { Topbar } from '@/components/layout/Topbar';
import { ProductionStockPage } from '@/components/production/ProductionStockPage';

export default function Page() {
  return (
    <>
      <Topbar title="Production Stock" />
      <div className="p-4 sm:p-6">
        <ProductionStockPage />
      </div>
    </>
  );
}
