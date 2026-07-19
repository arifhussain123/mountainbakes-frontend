import { Topbar } from '@/components/layout/Topbar';
import { BranchesPage } from '@/components/branches/BranchesPage';

export default function Page() {
  return (
    <>
      <Topbar title="Branches" />
      <div className="p-6">
        <BranchesPage />
      </div>
    </>
  );
}
