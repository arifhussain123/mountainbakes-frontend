import { Topbar } from '@/components/layout/Topbar';
import { StockPage } from '@/components/stock/StockPage';

export default function Page() {
  return (
    <>
      <Topbar title="Stock" />
      <div className="p-6">
        <StockPage />
      </div>
    </>
  );
}
