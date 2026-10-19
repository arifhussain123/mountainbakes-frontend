import { ProductionOrdersPage } from '@/components/production/ProductionOrdersPage';

/**
 * Admin → Orders. The branches' production demands, on the same screen
 * Production works from (super_admin passes every guard it calls). The counter's
 * customer orders are no longer listed here; their records are untouched, and
 * OrdersPage still serves the branch's /branch-orders screen.
 */
export default function Page() {
  return (
    <div className="p-4 sm:p-6">
      <ProductionOrdersPage />
    </div>
  );
}
