import { Topbar } from '@/components/layout/Topbar';
import { BranchStockMatrix } from '@/components/production/BranchStockMatrix';

export default function Page() {
  return (
    <>
      <Topbar title="Branch Stock" />
      <div className="p-4 sm:p-6">
        <BranchStockMatrix />
      </div>
    </>
  );
}
