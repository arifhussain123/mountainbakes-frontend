import { OrdersPage } from '@/components/orders/OrdersPage';
import { ProductionOrdersPage } from '@/components/production/ProductionOrdersPage';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

/**
 * Admin → Orders. Two kinds of order live here: the branches' production
 * demands (the same screen Production works from — super_admin passes every
 * guard it calls) and the customer orders taken at the counter. A tab that is
 * not showing is unmounted, so neither one's queries run until it is opened.
 */
export default function Page() {
  return (
    <div className="p-4 sm:p-6">
      <Tabs defaultValue="production">
        <TabsList>
          <TabsTrigger value="production">Production Orders</TabsTrigger>
          <TabsTrigger value="customer">Customer Orders</TabsTrigger>
        </TabsList>

        <TabsContent value="production" className="mt-4">
          <ProductionOrdersPage />
        </TabsContent>
        <TabsContent value="customer" className="mt-4">
          <OrdersPage />
        </TabsContent>
      </Tabs>
    </div>
  );
}
