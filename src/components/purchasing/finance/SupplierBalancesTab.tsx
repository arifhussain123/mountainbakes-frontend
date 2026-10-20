'use client';

import { useMemo, useState } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { Users } from 'lucide-react';
import type { SupplierBalance } from '@mb/shared';
import type { UseQueryResult } from '@tanstack/react-query';
import { DataTable } from '@/components/shared/DataTable';
import { EmptyState } from '@/components/shared/EmptyState';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { FilterBar, FilterField } from '@/components/finance/finance-actions';
import { Money } from '@/components/finance/finance-ui';

const col = createColumnHelper<SupplierBalance>();

const hasActivity = (b: SupplierBalance) =>
  b.billed !== 0 || b.paid !== 0 || b.creditApproved !== 0 || b.pendingPayments !== 0;

/**
 * Each supplier's position, as the API's supplier_balances() computes it in
 * SQL — billed against approved bills, paid from posted payments, credit
 * approved and repaid, and what is still waiting for approval. Figures are
 * shown as returned; nothing is summed here.
 */
export function SupplierBalancesTab({ query }: { query: UseQueryResult<SupplierBalance[]> }) {
  const [search, setSearch] = useState('');
  const [activeOnly, setActiveOnly] = useState(true);
  const { data, isLoading, isError, error, refetch } = query;

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (data ?? []).filter((b) => (!activeOnly || hasActivity(b)) && (!term || b.supplierName.toLowerCase().includes(term)));
  }, [data, search, activeOnly]);

  const columns = [
    col.accessor('supplierName', {
      header: 'Supplier',
      meta: { mobile: 'title' },
      cell: (i) => <span className="font-medium">{i.getValue()}</span>,
    }),
    col.accessor('billed', { header: 'Billed', meta: { align: 'right' }, cell: (i) => <Money value={i.getValue()} /> }),
    col.accessor('paid', { header: 'Paid', meta: { align: 'right' }, cell: (i) => <Money value={i.getValue()} /> }),
    col.accessor('outstanding', {
      header: 'Outstanding',
      meta: { align: 'right' },
      cell: (i) => <Money value={i.getValue()} className="font-semibold" />,
    }),
    col.accessor('creditApproved', { header: 'Credit approved', meta: { align: 'right' }, cell: (i) => <Money value={i.getValue()} blankZero /> }),
    col.accessor('creditRepaid', { header: 'Credit repaid', meta: { align: 'right' }, cell: (i) => <Money value={i.getValue()} blankZero /> }),
    col.accessor('creditOutstanding', {
      header: 'Credit outstanding',
      meta: { align: 'right' },
      cell: (i) => <Money value={i.getValue()} blankZero className="font-semibold" />,
    }),
    col.accessor('pendingPayments', {
      header: 'Pending approval',
      meta: { align: 'right' },
      cell: (i) => <Money value={i.getValue()} blankZero className="text-amber-700 dark:text-amber-300" />,
    }),
  ];

  return (
    <div className="space-y-4">
      <FilterBar>
        <FilterField label="Supplier" className="min-w-[14rem] flex-1 space-y-1">
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name…" className="h-11 md:h-9" />
        </FilterField>
        <div className="flex h-11 items-center gap-2 md:h-9">
          <Switch id="balances-active-only" checked={activeOnly} onCheckedChange={setActiveOnly} />
          <Label htmlFor="balances-active-only" className="text-sm">
            Only suppliers with activity
          </Label>
        </div>
      </FilterBar>

      {isError ? (
        <EmptyState
          title="Could not load supplier balances"
          description={error instanceof Error ? error.message : 'Please try again.'}
          action={
            <Button variant="outline" onClick={() => void refetch()}>
              Retry
            </Button>
          }
        />
      ) : (
        <DataTable
          columns={columns}
          data={rows}
          loading={isLoading}
          toolbar={false}
          sortable
          empty={
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <Users className="h-8 w-8 text-muted-foreground/50" />
              <p className="text-sm font-medium">No supplier balances to show.</p>
              <p className="text-sm text-muted-foreground">
                {activeOnly ? 'No supplier has a bill, payment or credit yet.' : 'Nothing matches this search.'}
              </p>
            </div>
          }
        />
      )}
    </div>
  );
}
