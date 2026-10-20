'use client';

import { useMemo, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FinancePageHeader, useFinanceAbilities } from '@/components/finance/finance-ui';
import { qk } from '@/lib/queryKeys';
import { useSupplierBalances } from '@/lib/supplierPayments';
import { SupplierPaymentsTab } from './SupplierPaymentsTab';
import { SupplierCreditsTab } from './SupplierCreditsTab';
import { SupplierBalancesTab } from './SupplierBalancesTab';

/**
 * Finance → Supplier Payments: money WhatsApp Purchasing owes outside
 * suppliers. Production records a payment against an approved bill (or asks
 * for credit); it reaches the Daily Ledger only when a Finance approver
 * approves it here, as a PV- voucher under an expense head.
 *
 * READ THIS ALONGSIDE FinanceCashTransfersPage — the same View-then-decide
 * board and the same permission split: `view` (Accountant, Auditor, a Super
 * Admin without the write grant) sees every tab; only `approve` gets the
 * decision buttons, and the API re-decides both on every request.
 */
export function FinanceSupplierPaymentsPage() {
  const abilities = useFinanceAbilities();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState('payments');
  const balances = useSupplierBalances();

  // The supplier filter's choices: every supplier the balances know about.
  const suppliers = useMemo(
    () =>
      (balances.data ?? [])
        .map((b) => ({ value: b.supplierId, label: b.supplierName }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [balances.data],
  );

  const canDecide = abilities.approve;

  return (
    <div className="space-y-6">
      <FinancePageHeader
        title="Supplier Payments"
        description="Payments and credit Production recorded for WhatsApp Purchasing suppliers. Approving a payment posts a PV- voucher to the Daily Ledger."
        actions={
          <Button
            variant="outline"
            size="sm"
            // ['finance', 'supplierPayments'] — every list, credit, balance and
            // head query on this page, and nothing else in the module.
            onClick={() => void queryClient.invalidateQueries({ queryKey: qk.financeSupplierPaymentHeads().slice(0, 2) })}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Refresh
          </Button>
        }
      />

      {!abilities.loading && !canDecide && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          You are signed in as <span className="font-medium">{abilities.roleLabel || 'a read-only user'}</span> — you can
          review supplier payments and credit here, but approving, rejecting and reversing needs a finance approver.
        </div>
      )}

      <Tabs value={tab} onValueChange={(v) => setTab(String(v))}>
        <TabsList>
          <TabsTrigger value="payments">Payments</TabsTrigger>
          <TabsTrigger value="credits">Credits</TabsTrigger>
          <TabsTrigger value="balances">Supplier balances</TabsTrigger>
        </TabsList>
        <TabsContent value="payments" className="mt-4">
          <SupplierPaymentsTab canDecide={canDecide} suppliers={suppliers} />
        </TabsContent>
        <TabsContent value="credits" className="mt-4">
          <SupplierCreditsTab canDecide={canDecide} suppliers={suppliers} />
        </TabsContent>
        <TabsContent value="balances" className="mt-4">
          <SupplierBalancesTab query={balances} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
