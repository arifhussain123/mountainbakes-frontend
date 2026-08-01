import { SalesPage } from '@/components/sales/SalesPage';

export default function Page() {
  return (
    <div className="p-4 sm:p-6">
      <SalesPage mode="production" />
    </div>
  );
}
