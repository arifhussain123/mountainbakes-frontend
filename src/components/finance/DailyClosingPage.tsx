'use client';

import { useState } from 'react';
import { businessDateStr } from '@mb/shared';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BranchSalesTab } from './closing/BranchSalesTab';
import { LedgerClosingTab } from './closing/LedgerClosingTab';
import { FinancePageHeader, ReadOnlyNotice, useFinanceAbilities } from './finance-ui';

/**
 * Finance Daily Closing — two readings of one business day.
 *
 *   Branch Sales    what each branch recorded, and the money received for it
 *   Ledger Closing  the ledger's opening and closing position, and signing it off
 *
 * They are tabs of one page rather than two pages because they are the two
 * halves of closing a day: Finance checks what the branches took against what
 * arrived, then signs the ledger off. Branch Sales comes first for that reason.
 *
 * Neither tab feeds the other. Branch Sales reads the branches' own Daily Sale
 * Records and writes nothing; Ledger Closing reads and locks the ledger. Closing
 * a day is not made to wait on the branch figures, and a matched day is not
 * closed on Finance's behalf.
 */
export function DailyClosingPage() {
  const abilities = useFinanceAbilities();

  // Held here so it survives a switch of tab — see LedgerClosingTab.
  const [ledgerDate, setLedgerDate] = useState(() => businessDateStr());

  return (
    <div className="space-y-6">
      <FinancePageHeader
        title="Finance Daily Closing"
        description="Each branch's recorded sales against the money received, and the ledger's opening and closing position for a business date."
      />

      <ReadOnlyNotice abilities={abilities} />

      <Tabs defaultValue="sales">
        <TabsList>
          <TabsTrigger value="sales">Branch Sales</TabsTrigger>
          <TabsTrigger value="ledger">Ledger Closing</TabsTrigger>
        </TabsList>

        <TabsContent value="sales" className="mt-4">
          <BranchSalesTab />
        </TabsContent>

        <TabsContent value="ledger" className="mt-4">
          <LedgerClosingTab abilities={abilities} date={ledgerDate} onDateChange={setLedgerDate} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
