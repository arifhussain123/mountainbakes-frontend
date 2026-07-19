import { Topbar } from '@/components/layout/Topbar';
import { ProductionExpensesPage } from '@/components/production/ProductionExpensesPage';

export default function Page() {
  return (
    <>
      <Topbar title="Production Expenses" />
      <div className="p-4 sm:p-6">
        <ProductionExpensesPage />
      </div>
    </>
  );
}
