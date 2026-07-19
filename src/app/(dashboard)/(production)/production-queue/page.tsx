import { Topbar } from '@/components/layout/Topbar';
import { ProductionQueuePage } from '@/components/production/ProductionQueuePage';

export default function Page() {
  return (
    <>
      <Topbar title="Production Queue" />
      <div className="p-6">
        <ProductionQueuePage />
      </div>
    </>
  );
}
