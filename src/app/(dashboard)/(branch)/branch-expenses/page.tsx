import { Topbar } from '@/components/layout/Topbar';
import { ExpensesPage } from '@/components/expenses/ExpensesPage';

export default function Page() {
  return (
    <>
      <Topbar title="Shop Expenses" />
      <div className="p-6">
        <ExpensesPage />
      </div>
    </>
  );
}
