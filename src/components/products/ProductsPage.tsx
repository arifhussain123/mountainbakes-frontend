'use client';

import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { apiCall } from '@/utils/api';
import { useCategories } from '@/lib/queries';
import { qk } from '@/lib/queryKeys';
import { GenericDataTable } from '@/components/data-engine';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PackingMaterialsPage } from '@/components/packing-materials/PackingMaterialsPage';
import { ProductForm } from './ProductForm';
import { ChangePriceDialog } from './ChangePriceDialog';
import type { FilterConfig, Product } from '@mb/shared';
import { createColumnHelper } from '@tanstack/react-table';
import { toast } from 'sonner';
import { Pencil, Trash2, Coins, Power, Plus } from 'lucide-react';
import { Fab } from '@/components/shared/Fab';

const col = createColumnHelper<Product>();

export function ProductsPage() {
  const { token } = useAuth();
  const qc = useQueryClient();
  const [editProduct, setEditProduct] = useState<Product | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [pricingProduct, setPricingProduct] = useState<Product | null>(null);
  const [showPricing, setShowPricing] = useState(false);

  const [total, setTotal] = useState<number | null>(null);
  const categoriesQ = useCategories(token);

  /**
   * Shared cache invalidation — refreshes this table and every other price
   * consumer. Two prefixes: the POS and price screens read `['products']`,
   * this table reads the Data Engine's `['data', 'products']`.
   */
  function loadProducts() {
    qc.invalidateQueries({ queryKey: ['products'] });
    qc.invalidateQueries({ queryKey: qk.dataResource('products') });
  }

  const filters = useMemo<FilterConfig[]>(
    () => [
      { key: 'categoryId', label: 'Category', type: 'select', placeholder: 'All Categories', placement: 'bar' },
      {
        key: 'isActive',
        label: 'Status',
        type: 'boolean',
        placement: 'bar',
        options: [
          { value: 'true', label: 'Active' },
          { value: 'false', label: 'Inactive' },
        ],
      },
      { key: 'price', label: 'Price (Rs.)', type: 'number-range' },
    ],
    [],
  );
  const filterOptions = useMemo(
    () => ({ categoryId: (categoriesQ.data ?? []).map((c) => ({ value: c.id, label: c.name })) }),
    [categoriesQ.data],
  );

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Remove "${name}" from the catalog?`)) return;
    try {
      await apiCall(`/api/products/${id}`, { method: 'DELETE' }, token);
      loadProducts();
      toast.success(`${name} removed`);
    } catch {
      toast.error('Delete failed');
    }
  }

  async function handleActivate(id: string, name: string) {
    try {
      await apiCall(`/api/products/${id}`, { method: 'PUT', body: JSON.stringify({ isActive: true }) }, token);
      loadProducts();
      toast.success(`${name} activated`);
    } catch {
      toast.error('Activate failed');
    }
  }

  const columns = [
    col.accessor('name', {
      header: 'Product',
      // The cell already stacks name over SKU, so it fills the card head alone.
      meta: { mobile: 'title' },
      cell: (info) => (
        <div>
          <p className="font-medium">{info.getValue()}</p>
          <p className="text-xs text-muted-foreground font-mono">{info.row.original.sku}</p>
        </div>
      ),
    }),
    col.accessor('categoryName', { header: 'Category' }),
    col.accessor('price', {
      header: 'Price',
      cell: (info) => <span className="font-semibold text-primary">Rs.{info.getValue()?.toLocaleString()}</span>,
    }),
    col.accessor('costPrice', {
      header: 'Cost',
      cell: (info) => <span className="text-muted-foreground">Rs.{info.getValue()?.toLocaleString()}</span>,
    }),
    col.accessor('isActive', {
      header: 'Status',
      enableSorting: false,
      meta: { mobile: 'badge' },
      cell: (info) => (
        <Badge variant={info.getValue() ? 'default' : 'secondary'}>
          {info.getValue() ? 'Active' : 'Inactive'}
        </Badge>
      ),
    }),
    col.display({
      id: 'actions',
      header: 'Actions',
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            title="Change price"
            onClick={() => { setPricingProduct(row.original); setShowPricing(true); }}
          >
            <Coins className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            title="Edit product"
            onClick={() => { setEditProduct(row.original); setShowForm(true); }}
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          {row.original.isActive ? (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-destructive hover:text-destructive"
              title="Deactivate product"
              onClick={() => handleDelete(row.original.id, row.original.name)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-emerald-600 hover:text-emerald-600"
              title="Activate product"
              onClick={() => handleActivate(row.original.id, row.original.name)}
            >
              <Power className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      ),
    }),
  ];

  return (
    <div className="space-y-4">
      {/* Two catalogues, deliberately never mixed: bakery products have prices and
          are sold; packing materials are service items supplied with a demand. */}
      <Tabs defaultValue="products">
        <TabsList>
          <TabsTrigger value="products">Products</TabsTrigger>
          <TabsTrigger value="packing">Packing Materials</TabsTrigger>
        </TabsList>

        <TabsContent value="products" className="mt-4 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">Products</h2>
              <p className="text-sm text-muted-foreground">
                {total === null ? 'Loading…' : `${total.toLocaleString()} products in catalog`}
              </p>
            </div>
            {/* Mobile gets this as the FAB below instead. */}
            <Button
              className="hidden md:inline-flex"
              onClick={() => { setEditProduct(null); setShowForm(true); }}
            >
              + Add Product
            </Button>
          </div>

          <GenericDataTable<Product>
            resource="products"
            columns={columns}
            filters={filters}
            filterOptions={filterOptions}
            defaultSort={{ key: 'name', direction: 'asc' }}
            searchPlaceholder="Search products, SKU, code…"
            cache="static"
            exportFileName="mountain-bakes-products"
            onPage={(page) => setTotal(page.total)}
            emptyTitle="No products found"
          />

          {/* Inside the tab panel on purpose: the Packing Materials tab owns its
              own add action, so a FAB rendered at page level would fire the wrong
              one while that tab is showing. */}
          <Fab
            onClick={() => { setEditProduct(null); setShowForm(true); }}
            icon={Plus}
            label="Add product"
          />
        </TabsContent>

        <TabsContent value="packing" className="mt-4">
          <PackingMaterialsPage />
        </TabsContent>
      </Tabs>

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="md:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editProduct ? 'Edit Product' : 'Add Product'}</DialogTitle>
          </DialogHeader>
          <ProductForm
            product={editProduct}
            onSuccess={() => { setShowForm(false); loadProducts(); }}
          />
        </DialogContent>
      </Dialog>

      <ChangePriceDialog
        product={pricingProduct}
        open={showPricing}
        onOpenChange={setShowPricing}
        onSuccess={loadProducts}
      />
    </div>
  );
}
