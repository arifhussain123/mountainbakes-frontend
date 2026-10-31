'use client';

import { BookOpenText, UsersRound } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LoanClientsTab } from './LoanClientsTab';
import { LoanLedgerTab } from './LoanLedgerTab';

/**
 * Finance → Refundable & Receivable Loans: the Loan Ledger and the Detail of
 * Clients, over the same clients and the same loan register
 * (/api/finance/loans). A separate record system — nothing here is posted to
 * the General Ledger; the Daily Ledger's Excel shows the outstanding balances
 * under Balance Sheet → Liabilities as a memorandum.
 */
export function LoansPage() {
  return (
    <Tabs defaultValue="ledger" className="space-y-4">
      <TabsList>
        <TabsTrigger value="ledger">
          <BookOpenText className="h-4 w-4" />
          Loan Ledger
        </TabsTrigger>
        <TabsTrigger value="clients">
          <UsersRound className="h-4 w-4" />
          Detail of Clients
        </TabsTrigger>
      </TabsList>
      <TabsContent value="ledger">
        <LoanLedgerTab />
      </TabsContent>
      <TabsContent value="clients">
        <LoanClientsTab />
      </TabsContent>
    </Tabs>
  );
}
