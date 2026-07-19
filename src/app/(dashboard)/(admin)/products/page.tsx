import { Topbar } from '@/components/layout/Topbar';
import { ProductsPage } from '@/components/products/ProductsPage';

export default function Page() {
  return (
    <>
      <Topbar title="Products" />
      <div className="p-6">
        <ProductsPage />
      </div>
    </>
  );
}
