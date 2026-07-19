'use client';

import { useEffect, useState } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useAuth } from '@/hooks/useAuth';
import { apiCall } from '@/utils/api';
import { useProducts } from '@/lib/queries';
import { usePriceRealtime } from '@/hooks/usePriceRealtime';
import { CreateOrderSchema, type CreateOrderInput, type Customer, type PaymentMethod } from '@mb/shared';
import { PAYMENT_METHODS, PAYMENT_METHOD_LABELS } from '@/utils/constants';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Trash2, Plus } from 'lucide-react';
import { toast } from 'sonner';

export function OrderForm({ onSuccess }: { onSuccess?: () => void }) {
  const { token, user } = useAuth();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [submitting, setSubmitting] = useState(false);

  usePriceRealtime();

  // isActive:true — must stay qk.products(true); the unfiltered key would admit
  // inactive products into the picker.
  const productsQ = useProducts(token, { isActive: true });
  const products = productsQ.data ?? [];

  const form = useForm<CreateOrderInput>({
    resolver: zodResolver(CreateOrderSchema),
    defaultValues: {
      branchId: user?.branchId || '',
      customerId: '',
      items: [{ productId: '', qty: 1, discount: 0 }],
      paymentMethod: 'cash',
      deliveryCharges: 0,
      notes: '',
    },
  });

  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'items' });

  useEffect(() => {
    if (user?.branchId) form.setValue('branchId', user.branchId);
  }, [user, form]);

  useEffect(() => {
    if (!token) return;
    apiCall<{ customers: Customer[] }>('/api/customers', {}, token)
      .then((c) => setCustomers(c.customers ?? []))
      .catch((err) => {
        console.error('Failed to load customers', err);
        toast.error('Could not load customers');
      });
  }, [token]);

  useEffect(() => {
    if (productsQ.isError) toast.error('Could not load products');
  }, [productsQ.isError]);

  // Computed totals
  const items = form.watch('items');
  const deliveryCharges = form.watch('deliveryCharges') || 0;
  const subtotal = items.reduce((sum, item) => {
    const product = products.find((p) => p.id === item.productId);
    if (!product) return sum;
    return sum + product.price * (item.qty || 0) - (item.discount || 0);
  }, 0);
  const grandTotal = subtotal + Number(deliveryCharges);

  async function onSubmit(data: CreateOrderInput) {
    setSubmitting(true);
    try {
      const result = await apiCall<{ orderNumber: string; grandTotal: number }>(
        '/api/orders',
        { method: 'POST', body: JSON.stringify(data) },
        token
      );
      toast.success(`Order ${result.orderNumber} created â€” Rs.${result.grandTotal.toLocaleString()}`);
      form.reset();
      onSuccess?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create order');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
      {/* Customer */}
      <div className="space-y-3">
        <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Customer</h3>
        <div className="space-y-1">
          <Label>Select Customer</Label>
          <Select
            items={customers.map((c) => ({ value: c.id, label: `${c.name} - ${c.phone}` }))}
            value={form.watch('customerId') || null}
            onValueChange={(v) => form.setValue('customerId', (v as string) ?? '', { shouldValidate: true })}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select customerâ€¦" />
            </SelectTrigger>
            <SelectContent>
              {customers.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name} â€” {c.phone}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {form.formState.errors.customerId && (
            <p className="text-xs text-destructive">{form.formState.errors.customerId.message}</p>
          )}
        </div>
      </div>

      <Separator />

      {/* Items */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Items</h3>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => append({ productId: '', qty: 1, discount: 0 })}
          >
            <Plus className="h-3.5 w-3.5 mr-1" /> Add Item
          </Button>
        </div>

        <div className="space-y-3">
          {fields.map((field, i) => {
            const selectedProduct = products.find((p) => p.id === form.watch(`items.${i}.productId`));
            return (
              <div key={field.id} className="grid grid-cols-12 gap-2 items-end">
                <div className="col-span-5">
                  {i === 0 && <Label className="text-xs">Product</Label>}
                  <Select
                    items={products.map((p) => ({ value: p.id, label: `${p.name} - Rs.${p.price}` }))}
                    value={form.watch(`items.${i}.productId`) || null}
                    onValueChange={(v) => form.setValue(`items.${i}.productId`, (v as string) ?? '')}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="Select productâ€¦" />
                    </SelectTrigger>
                    <SelectContent>
                      {products.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name} â€” Rs.{p.price}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-2">
                  {i === 0 && <Label className="text-xs">Qty</Label>}
                  <Input
                    type="number"
                    min={1}
                    className="h-9"
                    {...form.register(`items.${i}.qty`, { valueAsNumber: true })}
                  />
                </div>
                <div className="col-span-2">
                  {i === 0 && <Label className="text-xs">Discount</Label>}
                  <Input
                    type="number"
                    min={0}
                    className="h-9"
                    placeholder="0"
                    {...form.register(`items.${i}.discount`, { valueAsNumber: true })}
                  />
                </div>
                <div className="col-span-2">
                  {i === 0 && <Label className="text-xs">Price</Label>}
                  <div className="h-9 flex items-center px-2 bg-muted rounded-md text-sm font-medium">
                    Rs.{selectedProduct ? selectedProduct.price : 'â€”'}
                  </div>
                </div>
                <div className="col-span-1 flex justify-center">
                  {fields.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 text-destructive"
                      onClick={() => remove(i)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <Separator />

      {/* Payment & Charges */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label>Payment Method</Label>
          <Select defaultValue="cash" onValueChange={(v) => form.setValue('paymentMethod', v as PaymentMethod)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAYMENT_METHODS.map((m) => (
                <SelectItem key={m} value={m}>{PAYMENT_METHOD_LABELS[m]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>Delivery Charges</Label>
          <Input
            type="number"
            min={0}
            placeholder="0"
            {...form.register('deliveryCharges', { valueAsNumber: true })}
          />
        </div>
      </div>

      <div className="space-y-1">
        <Label>Notes (optional)</Label>
        <Input placeholder="Special instructionsâ€¦" {...form.register('notes')} />
      </div>

      {/* Totals */}
      <div className="bg-muted/50 rounded-lg p-4 space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Subtotal</span>
          <span>Rs.{subtotal.toLocaleString()}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Delivery</span>
          <span>Rs.{Number(deliveryCharges).toLocaleString()}</span>
        </div>
        <Separator />
        <div className="flex justify-between font-bold text-base">
          <span>Grand Total</span>
          <span className="text-primary">Rs.{grandTotal.toLocaleString()}</span>
        </div>
      </div>

      <Button type="submit" className="w-full" disabled={submitting} size="lg">
        {submitting ? 'Creating Orderâ€¦' : 'Create Order'}
      </Button>
    </form>
  );
}
