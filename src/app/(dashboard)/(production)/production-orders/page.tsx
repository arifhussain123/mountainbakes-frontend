import { Topbar } from '@/components/layout/Topbar';
import { ProductionOrdersPage } from '@/components/production/ProductionOrdersPage';

export default function Page() {
  return (
    <>
      <Topbar title="Production Orders" />
      <div className="p-4 sm:p-6">
        <ProductionOrdersPage />
      </div>
    </>
  );
}
