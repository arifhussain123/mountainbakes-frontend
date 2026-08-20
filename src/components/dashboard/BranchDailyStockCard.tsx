'use client';

import { businessDateStr } from '@mb/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { BranchStockStatement } from '@/components/stock/BranchStockStatement';

/**
 * Branch Dashboard → Stock Detail: one business day as a statement.
 *
 * This is the only place the statement is shown. It started life as a page of
 * its own at /branch-daily-stock; that page was removed in favour of having the
 * figures on the dashboard, where they sit next to the history they belong to.
 *
 * It sits beside the Branch Stock History card deliberately — that one answers
 * "how have the last N days gone", this one answers "show me the 20th". Both
 * read the same ledger, so a figure picked out of the history table can be
 * opened up line by line here without leaving the dashboard.
 *
 * The date is owned by the dashboard rather than this card, so it survives the
 * card unmounting and can be lifted to drive anything else later.
 */
export function BranchDailyStockCard({
  date,
  onDateChange,
  branchId,
}: {
  date: string;
  onDateChange: (date: string) => void;
  branchId?: string | null;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 pb-3">
        <div>
          <CardTitle className="text-base">Stock Detail</CardTitle>
          <p className="text-xs text-muted-foreground">
            One business day, line by line · previous balance is carried in from the day before
          </p>
        </div>
        <div className="space-y-1">
          <Label className="text-xs" htmlFor="dashboard-stock-date">Date</Label>
          <Input
            id="dashboard-stock-date"
            type="date"
            value={date}
            max={businessDateStr()}
            onChange={(e) => e.target.value && onDateChange(e.target.value)}
            className="h-9 w-40"
          />
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <BranchStockStatement date={date} branchId={branchId} />
      </CardContent>
    </Card>
  );
}
