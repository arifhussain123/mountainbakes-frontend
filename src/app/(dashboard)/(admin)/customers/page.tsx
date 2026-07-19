import { Topbar } from '@/components/layout/Topbar';
import { CustomersPage } from '@/components/customers/CustomersPage';

export default function Page() {
  return (
    <>
      <Topbar title="Customers" />
      <div className="p-6">
        <CustomersPage />
      </div>
    </>
  );
}
