'use client';

import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useFinanceDashboardRecords } from '@/lib/finance';
import { useMoney } from '../finance-ui';
import { dayLabel, METRIC_INFO, type DrillTarget } from './dashboard-model';

const PAGE_SIZE = 25;

/**
 * "View source records" — the rows behind one dashboard figure.
 *
 * Paged and searched on the SERVER (`finance_dashboard_records`, migration 128),
 * and the total at the foot is the server's sum over every matching record, not
 * this page — so the drawer's total always equals the number that was clicked.
 * IDs are the records' own (order id + demand number, ledger id + voucher, …);
 * nothing here invents one.
 */
export function RecordsDrawer({
  target,
  dashboardBranchId,
  onClose,
}: {
  target: DrillTarget | null;
  dashboardBranchId: string;
  onClose: () => void;
}) {
  return (
    <Sheet open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-2xl">
        {/* Keyed by the figure, so a new figure starts at page 1 with no search. */}
        {target && <DrawerBody key={JSON.stringify(target)} target={target} dashboardBranchId={dashboardBranchId} />}
      </SheetContent>
    </Sheet>
  );
}

function DrawerBody({ target, dashboardBranchId }: { target: DrillTarget; dashboardBranchId: string }) {
  const { format } = useMoney();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');

  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const branchId = target?.branchId === undefined ? dashboardBranchId || undefined : (target.branchId ?? undefined);
  const q = useFinanceDashboardRecords(
    target
      ? {
          metric: target.metric,
          from: target.from,
          to: target.to,
          branchId,
          noBranch: target.branchId === null,
          ledgerHeadId: target.ledgerHeadId,
          search: debounced || undefined,
          page,
          pageSize: PAGE_SIZE,
        }
      : null,
  );
  const info = target ? METRIC_INFO[target.metric] : null;
  const data = q.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <>
      {info && (
        <>
          <SheetHeader className="bg-fin-income px-5 py-4 text-fin-ink-foreground">
            <SheetTitle className="text-base font-extrabold text-fin-ink-foreground">
              {info.title} · source records
            </SheetTitle>
            <SheetDescription className="text-fin-ink-muted">{target.context}</SheetDescription>
          </SheetHeader>

          <dl className="grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-1.5 border-b bg-fin-row-hover px-5 py-3 text-xs">
            <dt className="font-semibold text-muted-foreground">Source</dt>
            <dd>{info.source}</dd>
            <dt className="font-semibold text-muted-foreground">Calculation</dt>
            <dd>{info.rule}</dd>
            <dt className="font-semibold text-muted-foreground">Included</dt>
            <dd>{info.status}</dd>
            <dt className="font-semibold text-muted-foreground">Date field</dt>
            <dd>{info.date}</dd>
          </dl>

          <div className="border-b px-5 py-2.5">
            <div className="relative">
              <Search
                className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={`Search ${info.refLabel.toLowerCase()}, ID, branch or detail`}
                aria-label="Search source records"
                className="h-9 pl-8 text-base md:text-sm"
              />
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-auto">
            {q.isError ? (
              <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
                <p className="font-semibold">Source records could not be loaded.</p>
                <Button variant="outline" size="sm" onClick={() => void q.refetch()}>
                  Retry
                </Button>
              </div>
            ) : !data ? (
              <div className="space-y-2 p-5">
                {Array.from({ length: 8 }, (_, i) => (
                  <Skeleton key={i} className="h-11 w-full" />
                ))}
              </div>
            ) : data.rows.length === 0 ? (
              <p className="px-6 py-12 text-center text-sm text-muted-foreground">
                {debounced ? 'No records match that search.' : 'No source records for this figure.'}
              </p>
            ) : (
              <ul className={q.isPlaceholderData ? 'divide-y opacity-60 transition-opacity' : 'divide-y'}>
                {data.rows.map((r) => (
                  <li key={r.id} className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-0.5 px-5 py-2.5 text-sm">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <span className="font-semibold text-fin-share">{r.reference ?? '—'}</span>
                        <span className="text-xs text-muted-foreground">
                          {dayLabel(r.date)} {r.date.slice(0, 4)} · {r.branchName ?? 'Company / unassigned'}
                        </span>
                      </div>
                      <p className="truncate text-xs text-muted-foreground" title={r.detail ?? undefined}>
                        {r.source}
                        {r.detail ? ` · ${r.detail}` : ''}
                      </p>
                      <p className="text-[11px] text-muted-foreground/80">
                        {[r.createdBy && `Created by ${r.createdBy}`, r.approvedBy && `Approved by ${r.approvedBy}`]
                          .filter(Boolean)
                          .join(' · ') || 'No creator / approver recorded'}
                        <span className="ml-1 font-mono text-[10px] select-all">· ID {r.id}</span>
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className="font-bold tabular-nums">{format(r.amount)}</span>
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[10.5px] font-bold text-muted-foreground capitalize">
                        {r.status.replace(/_/g, ' ')}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <footer className="flex flex-wrap items-center justify-between gap-3 border-t px-5 py-3">
            <div>
              <p className="text-xs text-muted-foreground">
                {data
                  ? data.total
                    ? `${(page - 1) * PAGE_SIZE + 1}–${Math.min(data.total, page * PAGE_SIZE)} of ${data.total} records`
                    : 'No records'
                  : 'Loading…'}
              </p>
              <p className="text-base font-extrabold tabular-nums">Total {data ? format(data.amount) : '—'}</p>
            </div>
            <div className="flex gap-1.5">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                Previous
              </Button>
              <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>
                Next
              </Button>
            </div>
          </footer>
        </>
      )}
    </>
  );
}
