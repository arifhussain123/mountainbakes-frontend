import { Topbar } from '@/components/layout/Topbar';
import { SalesPage } from '@/components/sales/SalesPage';

export default function Page() {
  return (
    <>
      <Topbar title="Sales" />
      <div className="p-6">
        <SalesPage />
      </div>
    </>
  );
}
