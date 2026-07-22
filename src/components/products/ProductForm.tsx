'use client';

import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useAuth } from '@/hooks/useAuth';
import { apiCall } from '@/utils/api';
import { useCategories } from '@/lib/queries';
import { CreateProductSchema, type Product } from '@mb/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { z } from 'zod';

const schema = CreateProductSchema.extend({
  isActive: z.boolean().optional(),
});
type FormInput = z.infer<typeof schema>;

export function ProductForm({ product, onSuccess }: { product?: Product | null; onSuccess?: () => void }) {
  const { token } = useAuth();
  const [submitting, setSubmitting] = useState(false);

  const categoriesQ = useCategories(token);
  const categories = categoriesQ.data ?? [];
  const catLoading = categoriesQ.isLoading;

  useEffect(() => {
    if (categoriesQ.isError) toast.error('Could not load categories');
  }, [categoriesQ.isError]);

  const form = useForm<FormInput>({
    resolver: zodResolver(schema),
    defaultValues: product ? {
      name: product.name,
      categoryId: product.categoryId,
      sku: product.sku,
      price: product.price,
      costPrice: product.costPrice,
      description: product.description,
      isActive: product.isActive,
    } : { name: '', categoryId: '', sku: '', price: 0, costPrice: 0, description: '' },
  });

  async function onSubmit(data: FormInput) {
    setSubmitting(true);
    try {
      if (product) {
        await apiCall(`/api/products/${product.id}`, { method: 'PUT', body: JSON.stringify(data) }, token);
        toast.success('Product updated');
      } else {
        await apiCall('/api/products', { method: 'POST', body: JSON.stringify(data) }, token);
        toast.success('Product created');
      }
      onSuccess?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save product');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2 space-y-1">
          <Label>Product Name</Label>
          <Input {...form.register('name')} placeholder="Chocolate Cake" />
          {form.formState.errors.name && <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>}
        </div>

        <div className="space-y-1">
          <Label>Category</Label>
          <Select
            items={categories.map((c) => ({ value: c.id, label: c.name }))}
            value={form.watch('categoryId') || null}
            onValueChange={(v) => form.setValue('categoryId', (v as string) ?? '', { shouldValidate: true })}
          >
            <SelectTrigger className="w-full"><SelectValue placeholder="Select category" /></SelectTrigger>
            <SelectContent>
              {catLoading ? (
                <SelectItem value="__loading" disabled>Loadingâ€¦</SelectItem>
              ) : categories.length === 0 ? (
                <SelectItem value="__empty" disabled>No categories yet â€” add one under Categories</SelectItem>
              ) : (
                categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)
              )}
            </SelectContent>
          </Select>
          {form.formState.errors.categoryId && <p className="text-xs text-destructive">{form.formState.errors.categoryId.message}</p>}
        </div>

        <div className="space-y-1">
          <Label>SKU</Label>
          <Input {...form.register('sku')} placeholder="CAKE-001" />
          {form.formState.errors.sku && <p className="text-xs text-destructive">{form.formState.errors.sku.message}</p>}
        </div>

        <div className="space-y-1">
          <Label>Selling Price (Rs.)</Label>
          <Input type="number" {...form.register('price', { valueAsNumber: true })} placeholder="2500" disabled={!!product} />
          {product ? (
            <p className="text-xs text-muted-foreground">Use the Change Price action (coins icon) to update pricing — it records history and an effective date.</p>
          ) : form.formState.errors.price ? (
            <p className="text-xs text-destructive">{form.formState.errors.price.message}</p>
          ) : null}
        </div>

        <div className="space-y-1">
          <Label>Cost Price (Rs.)</Label>
          <Input type="number" {...form.register('costPrice', { valueAsNumber: true })} placeholder="1800" />
        </div>

        <div className="col-span-2 space-y-1">
          <Label>Description</Label>
          <Input {...form.register('description')} placeholder="Optional descriptionâ€¦" />
        </div>

        {product && (
          <div className="col-span-2 flex items-center justify-between rounded-md border p-3">
            <div className="space-y-0.5">
              <Label>Active</Label>
              <p className="text-xs text-muted-foreground">Inactive products stay in the catalog but are hidden from ordering.</p>
            </div>
            <Switch
              checked={form.watch('isActive') ?? false}
              onCheckedChange={(v) => form.setValue('isActive', v, { shouldValidate: true })}
            />
          </div>
        )}
      </div>

      <Button type="submit" className="w-full" disabled={submitting}>
        {submitting ? 'Savingâ€¦' : product ? 'Update Product' : 'Add Product'}
      </Button>
    </form>
  );
}
