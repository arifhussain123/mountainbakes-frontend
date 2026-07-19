import { Topbar } from '@/components/layout/Topbar';
import { AdminDashboard } from '@/components/dashboard/AdminDashboard';

export default function DashboardPage() {
  return (
    <>
      <Topbar title="Dashboard" />
      <div className="p-6">
        <AdminDashboard />
      </div>
    </>
  );
}
