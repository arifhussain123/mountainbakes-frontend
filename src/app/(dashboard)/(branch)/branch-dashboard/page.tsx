import { Topbar } from '@/components/layout/Topbar';
import { BranchDashboard } from '@/components/dashboard/BranchDashboard';

export default function Page() {
  return (
    <>
      <Topbar title="Branch Dashboard" />
      <div className="p-6">
        <BranchDashboard />
      </div>
    </>
  );
}
