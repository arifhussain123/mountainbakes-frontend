import { Topbar } from '@/components/layout/Topbar';
import { ProductionReportsPage } from '@/components/production/ProductionReportsPage';

export default function Page() {
  return (
    <>
      <Topbar title="Production Reports" />
      <div className="p-4 sm:p-6">
        <ProductionReportsPage />
      </div>
    </>
  );
}
