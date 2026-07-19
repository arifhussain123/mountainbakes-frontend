import { Topbar } from '@/components/layout/Topbar';
import { BranchOrdersPage } from '@/components/orders/BranchOrdersPage';

export default function Page() {
  return (
    <>
      <Topbar title="Orders" />
      <div className="p-6">
        <BranchOrdersPage />
      </div>
    </>
  );
}
