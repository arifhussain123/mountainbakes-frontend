'use client';

import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { apiCall } from '@/utils/api';
import { useProducts } from '@/lib/queries';import { DataTable } from '@/components/shared/DataTable';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PackingMaterialsPage } from '@/components/packing-materials/PackingMaterialsPage';
import { ProductForm } from './ProductForm';
import { ChangePriceDialog } from './ChangePriceDialog';
import type { Product } from '@mb/shared';
import { createColumnHelper } from '@tanstack/react-table';
import { toast } from 'sonner';
import { Pencil, Trash2, Coins, Power } from 'lucide-react';

const col = createColumnHelper<Product>();

export function ProductsPage() {
  const { token } = useAuth();
  const qc = useQueryClient();
  const [editProduct, setEditProduct] = useState<Product | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [pricingProduct, setPricingProduct] = useState<Product | null>(null);
  const [showPricing, setShowPricing] = useState(false);

  // A price change on another device reaches this table without a reload.
  const productsQ = useProducts(token);
  const products = productsQ.data ?? [];
  const loading = productsQ.isLoading;

  /** Shared cache invalidation — refreshes this table and every other price consumer. */
  function loadProducts() { qc.invalidateQueries({ queryKey: ['products'] }); }

  useEffect(() => {
    if (productsQ.isError) toast.error('Failed to load products');
  }, [productsQ.isError]);

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
              <p className="text-sm text-muted-foreground">{products.length} products in catalog</p>
            </div>
            <Button onClick={() => { setEditProduct(null); setShowForm(true); }}>+ Add Product</Button>
          </div>

          <DataTable columns={columns} data={products} loading={loading} searchPlaceholder="Search products, SKUâ€¦" />
        </TabsContent>

        <TabsContent value="packing" className="mt-4">
          <PackingMaterialsPage />
        </TabsContent>
      </Tabs>

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-lg">
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
