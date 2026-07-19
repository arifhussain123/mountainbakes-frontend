import { Topbar } from '@/components/layout/Topbar';
import { ProductionReturnsPage } from '@/components/production/ProductionReturnsPage';

export default function Page() {
  return (
    <>
      <Topbar title="Product Returns" />
      <div className="p-4 sm:p-6">
        <ProductionReturnsPage />
      </div>
    </>
  );
}
