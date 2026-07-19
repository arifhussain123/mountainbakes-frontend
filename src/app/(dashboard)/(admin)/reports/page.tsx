import { Topbar } from '@/components/layout/Topbar';
import { ReportsPage } from '@/components/reports/ReportsPage';

export default function Page() {
  return (
    <>
      <Topbar title="Reports & Analytics" />
      <div className="p-6">
        <ReportsPage />
      </div>
    </>
  );
}
