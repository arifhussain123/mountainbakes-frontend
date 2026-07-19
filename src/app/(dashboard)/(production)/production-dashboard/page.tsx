import { Topbar } from '@/components/layout/Topbar';
import { ProductionDashboard } from '@/components/production/ProductionDashboard';

export default function Page() {
  return (
    <>
      <Topbar title="Production Dashboard" />
      <div className="p-4 sm:p-6">
        <ProductionDashboard />
      </div>
    </>
  );
}
