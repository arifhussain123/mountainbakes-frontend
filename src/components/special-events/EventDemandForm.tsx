'use client';

import { useMemo, useState } from 'react';
import { Plus, Send, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from '@/components/ui/combobox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/hooks/useAuth';
import { useMyEventDemand, useProducts, useSaveEventDemand, useSubmitEventDemand } from '@/lib/queries';
import type { Product, SpecialEventView } from '@mb/shared';
import { DemandStatusBadge } from './BranchDemandPanel';

interface DemandLine {
  productId: string;
  productName: string;
  qty: number;
  remarks: string;
}

/**
 * A branch's advance demand for one event.
 *
 * Saving keeps it a DRAFT; submitting is a separate, explicit action, because
 * once submitted Production starts planning against it and the branch can no
 * longer edit. The API enforces both of those — this form only makes the
 * distinction visible.
 */
export function EventDemandForm({ event }: { event: SpecialEventView }) {
  const { token } = useAuth();
  const demandQ = useMyEventDemand(token, event.id);
  const productsQ = useProducts(token, { isActive: true });
  const saveDemand = useSaveEventDemand(token);
  const submitDemand = useSubmitEventDemand(token);

  const [lines, setLines] = useState<DemandLine[]>([]);
  const [expectedCustomers, setExpectedCustomers] = useState<string>('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [picker, setPicker] = useState<Product | null>(null);
  const [hydratedFrom, setHydratedFrom] = useState<string | null>(null);

  const demand = demandQ.data;
  const products = useMemo(() => productsQ.data ?? [], [productsQ.data]);

  // Seed the form from the server copy the first time it arrives, and again
  // whenever the server's version changes (a submit, or an admin edit).
  //
  // Adjusted during render rather than in an effect — the React-documented
  // pattern for "reset state when a prop changes". An effect would paint the
  // empty form first and then replace it, and it would fight the user's typing
  // on every unrelated refetch.
  const demandVersion = demand ? `${demand.id}:${demand.updatedAt}` : null;
  if (demand && demandVersion !== hydratedFrom) {
    setHydratedFrom(demandVersion);
    setLines(
      demand.items.map((item) => ({
        productId: item.productId ?? '',
        productName: item.productName,
        qty: Number(item.qty),
        remarks: item.remarks ?? '',
      })),
    );
    setExpectedCustomers(demand.expectedCustomers === null ? '' : String(demand.expectedCustomers));
    setNotes(demand.notes ?? '');
  }

  const editable = !demand || demand.status === 'draft';
  const pastDeadline = Boolean(event.demandDueDate && new Date().toISOString().slice(0, 10) > event.demandDueDate);

  function addLine(product: Product) {
    if (lines.some((line) => line.productId === product.id)) {
      toast.info(`${product.name} is already on the demand`);
      return;
    }
    setLines((prev) => [...prev, { productId: product.id, productName: product.name, qty: 1, remarks: '' }]);
    setPicker(null);
  }

  function updateLine(productId: string, patch: Partial<DemandLine>) {
    setLines((prev) => prev.map((line) => (line.productId === productId ? { ...line, ...patch } : line)));
  }

  function removeLine(productId: string) {
    setLines((prev) => prev.filter((line) => line.productId !== productId));
  }

  async function onSave() {
    if (lines.length === 0) {
      toast.error('Add at least one product');
      return;
    }
    if (lines.some((line) => !(line.qty > 0))) {
      toast.error('Every line needs a quantity greater than zero');
      return;
    }

    setBusy(true);
    try {
      await saveDemand.mutateAsync({
        eventId: event.id,
        items: lines.map((line) => ({
          productId: line.productId,
          qty: line.qty,
          remarks: line.remarks || undefined,
        })),
        expectedCustomers: expectedCustomers === '' ? null : Number(expectedCustomers),
        notes: notes || undefined,
      });
      toast.success('Draft saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save the demand');
    } finally {
      setBusy(false);
    }
  }

  async function onSubmit() {
    if (!demand) {
      toast.error('Save the draft before submitting');
      return;
    }
    if (!window.confirm('Submit this demand? You will not be able to edit it afterwards.')) return;

    setBusy(true);
    try {
      await submitDemand.mutateAsync({ eventId: event.id, demandId: demand.id });
      toast.success('Demand submitted to Production');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to submit the demand');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-heading text-sm font-semibold">Your Advance Demand</h3>
            <p className="text-xs text-muted-foreground">
              {event.demandDueDate ? `Due by ${event.demandDueDate}` : 'No deadline set'}
            </p>
          </div>
          {demand && <DemandStatusBadge status={demand.status} />}
        </div>

        {pastDeadline && editable && (
          <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
            The deadline for this event has passed. Contact Admin if you still need to submit.
          </p>
        )}

        {!editable && (
          <p className="rounded-md border bg-muted/40 p-2 text-xs text-muted-foreground">
            This demand has been submitted and can no longer be edited. Contact Admin if something
            needs to change.
          </p>
        )}

        {editable && (
          <div className="space-y-1">
            <Label>Add a product</Label>
            {/* A picker, not a field: `picker` is reset to null after every
                selection so the input clears and the next product can be added. */}
            <Combobox
              items={products}
              value={picker}
              onValueChange={(product: Product | null) => {
                if (product) addLine(product);
              }}
              itemToStringLabel={(item: Product) => item.name}
              itemToStringValue={(item: Product) => item.id}
              isItemEqualToValue={(a: Product, b: Product) => a?.id === b?.id}
            >
              <ComboboxInput placeholder="Search products…" />
              <ComboboxContent>
                <ComboboxEmpty>No matching products.</ComboboxEmpty>
                <ComboboxList>
                  {(item: Product) => (
                    <ComboboxItem key={item.id} value={item}>
                      {item.name}
                    </ComboboxItem>
                  )}
                </ComboboxList>
              </ComboboxContent>
            </Combobox>
          </div>
        )}

        {lines.length === 0 ? (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            No products added yet.
          </p>
        ) : (
          <div className="space-y-2">
            {lines.map((line) => (
              <div key={line.productId} className="rounded-lg border p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 flex-1 truncate font-medium">{line.productName}</p>
                  {editable && (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove ${line.productName}`}
                      className="h-11 w-11 flex-shrink-0 md:h-8 md:w-8"
                      onClick={() => removeLine(line.productId)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  )}
                </div>
                <div className="mt-2 grid gap-2 sm:grid-cols-[8rem_1fr]">
                  <div className="space-y-1">
                    <Label htmlFor={`qty-${line.productId}`}>Quantity</Label>
                    <Input
                      id={`qty-${line.productId}`}
                      type="number"
                      min={1}
                      value={line.qty}
                      disabled={!editable}
                      onChange={(e) => updateLine(line.productId, { qty: Number(e.target.value) })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`remarks-${line.productId}`}>Remarks</Label>
                    <Input
                      id={`remarks-${line.productId}`}
                      value={line.remarks}
                      disabled={!editable}
                      placeholder="Optional"
                      onChange={(e) => updateLine(line.productId, { remarks: e.target.value })}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="expected-customers">Expected customers</Label>
            <Input
              id="expected-customers"
              type="number"
              min={0}
              value={expectedCustomers}
              disabled={!editable}
              placeholder="Optional"
              onChange={(e) => setExpectedCustomers(e.target.value)}
            />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="demand-notes">Notes for Production</Label>
            <Textarea
              id="demand-notes"
              rows={2}
              value={notes}
              disabled={!editable}
              placeholder="Anything Production should know…"
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>

        {editable && (
          <div className="flex flex-wrap gap-2 [&_button]:min-h-11 md:[&_button]:min-h-9">
            <Button variant="outline" onClick={onSave} disabled={busy}>
              <Plus className="mr-1.5 h-4 w-4" /> Save Draft
            </Button>
            <Button onClick={onSubmit} disabled={busy || !demand}>
              <Send className="mr-1.5 h-4 w-4" /> Submit to Production
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
