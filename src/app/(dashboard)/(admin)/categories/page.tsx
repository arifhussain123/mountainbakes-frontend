import { Topbar } from '@/components/layout/Topbar';
import { CategoriesPage } from '@/components/products/CategoriesPage';

export default function Page() {
  return (
    <>
      <Topbar title="Categories" />
      <div className="p-6">
        <CategoriesPage />
      </div>
    </>
  );
}
