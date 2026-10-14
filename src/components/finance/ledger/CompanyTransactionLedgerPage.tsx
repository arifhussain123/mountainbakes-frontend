'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  FINANCE_PAYMENT_METHOD_LABELS,
  type LedgerCell,
  type LedgerYearOption,
  type PageSize,
  type PartnerLedgerRow,
  type PartnerLedgerSort,
  type PartnerLedgerTransaction,
  type PartnerTxnKind,
} from '@mb/shared';
import { usePartnerLedger, usePartnerLedgerTransactions } from '@/lib/finance';
import { useDebounce } from '@/hooks/useDebounce';
import { ROUTES } from '@/utils/routes';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Pagination } from '@/components/data-engine/Pagination';
import { PrintButton } from '@/components/shared/PrintButton';
import {
  LedgerControls,
  LedgerEmpty,
  LedgerError,
  LedgerGrid,
  LedgerHeader,
  LedgerLegend,
  LedgerSearch,
  LedgerSelect,
  LedgerSheet,
  LedgerSkeleton,
  MONTHS_LONG,
  niceDate,
  niceDateTime,
  periodLabel,
  SheetLoading,
  SheetNote,
  SheetTotal,
  SourceBadge,
  SourceItem,
  SummaryCards,
  useLedgerFormat,
  YearPicker,
  type LedgerGridRow,
} from './ledger-ui';

/**
 * Company Transaction Details — approved partner transactions, per partner,
 * per month, for one year.
 *
 * READ-ONLY. A figure is here because a partner advance or draw was approved
 * on the Partner Transactions page; nothing on this page can add a partner,
 * enter an amount, or change one. Three approved transactions in a month are
 * one figure on one row, and opening it lists the three.
 *
 * What counts is what this page has always been about: money paid to a partner,
 * as an advance against their share or a draw of it. Other company income and
 * expenses, salaries and branch-share payouts are different records and are not
 * added into a partner's row.
 */

type KindFilter = 'all' | PartnerTxnKind;
type Selection = { partner: PartnerLedgerRow; year: number; month: number | null };

const KIND_LABEL: Record<PartnerTxnKind, string> = { advance: 'Advance', draw: 'Draw' };

const KIND_OPTIONS: { value: KindFilter; label: string }[] = [
  { value: 'all', label: 'Advances and draws' },
  { value: 'advance', label: 'Advances only' },
  { value: 'draw', label: 'Draws only' },
];

const SORT_OPTIONS: { value: PartnerLedgerSort; label: string }[] = [
  { value: 'code', label: 'Partner ID' },
  { value: 'name', label: 'Partner name' },
  { value: 'total', label: 'Year total' },
];

export function CompanyTransactionLedgerPage() {
  const fmt = useLedgerFormat();

  const [year, setYear] = useState<number | null>(null);
  const [tab, setTab] = useState('summary');
  const [kind, setKind] = useState<KindFilter>('all');
  const [sort, setSort] = useState<PartnerLedgerSort>('code');
  const [searchText, setSearchText] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(20);
  const [selection, setSelection] = useState<Selection | null>(null);

  const search = useDebounce(searchText.trim(), 300);
  const txnKind = kind === 'all' ? undefined : kind;

  const ledgerQ = usePartnerLedger({ year: year ?? undefined, search: search || undefined, txnKind, sort, page, pageSize });
  const ledger = ledgerQ.data;
  const shownYear = year ?? ledger?.year ?? null;

  const reset = <T,>(set: (value: T) => void) => (value: T) => {
    set(value);
    setPage(1);
  };

  const rows: LedgerGridRow[] = (ledger?.rows ?? []).map((r) => ({
    id: r.partnerId,
    code: r.partnerCode,
    name: r.partnerName,
    sub: `Share ${r.sharePct}%${r.isActive ? '' : ' · Inactive'}`,
    subTone: 'muted',
    cells: r.cells,
    total: r.total,
  }));
  const partnerById = (id: string) => ledger?.rows.find((r) => r.partnerId === id);

  const s = ledger?.summary;
  const what = kind === 'advance' ? 'partner advances' : kind === 'draw' ? 'partner draws' : 'partner transactions';
  const cards = [
    { label: 'Year total', value: s ? fmt.money(s.yearTotal) : '—', note: `Approved ${what}, ${shownYear ?? ''}` },
    { label: 'Approved transactions', value: s ? String(s.transactionCount) : '—', note: 'Each counted once' },
    { label: 'Partners', value: s ? String(s.partners) : '—', note: `With activity in ${shownYear ?? ''}` },
    {
      label: 'Highest month',
      value: s?.highestMonth ? fmt.money(s.highestMonth.amount) : '—',
      note: s?.highestMonth ? `${MONTHS_LONG[s.highestMonth.month - 1]} ${shownYear}` : 'No activity',
    },
  ];

  return (
    <div className="print-area space-y-5">
      <LedgerHeader
        title="Company Transaction Details"
        year={shownYear}
        description="Approved partner transactions per month, summed from source records. Transactions are raised and approved in Partner Transactions."
        actions={<PrintButton variant="outline" size="sm" buttonClassName="h-11 md:h-9" showMenu={false} />}
      />

      <Tabs value={tab} onValueChange={(v) => setTab(String(v))}>
        <TabsList className="no-print">
          <TabsTrigger value="summary">Monthly summary</TabsTrigger>
          <TabsTrigger value="transactions">Source transactions</TabsTrigger>
        </TabsList>

        <TabsContent value="summary" className="mt-4 space-y-4">
          <SummaryCards cards={cards} loading={ledgerQ.isLoading} />

          <LedgerControls>
            {shownYear !== null && (
              <YearPicker year={shownYear} years={ledger?.years ?? []} onChange={reset(setYear)} />
            )}
            <LedgerSelect id="ledger-kind" label="Type" value={kind} onChange={reset(setKind)} options={KIND_OPTIONS} />
            <LedgerSelect id="ledger-sort" label="Sort" value={sort} onChange={reset(setSort)} options={SORT_OPTIONS} />
            <LedgerSearch value={searchText} onChange={reset(setSearchText)} placeholder="Search by partner ID or name…" />
          </LedgerControls>

          <LedgerLegend salary={false} symbol={fmt.symbol} />

          {ledgerQ.isLoading ? (
            <LedgerSkeleton />
          ) : ledgerQ.isError || !ledger ? (
            <LedgerError
              message={ledgerQ.error instanceof Error ? ledgerQ.error.message : 'Check the connection and try again.'}
              onRetry={() => void ledgerQ.refetch()}
            />
          ) : rows.length === 0 ? (
            <LedgerEmpty
              title={search ? 'No results match this search' : `No approved records for ${ledger.year}`}
              body={
                search
                  ? 'Clear the search to see every partner.'
                  : `Nothing has been approved for ${ledger.year} yet. Amounts appear here automatically once a partner transaction for this year is approved.`
              }
            />
          ) : (
            <>
              <LedgerGrid
                idHead="Partner ID"
                nameHead="Partner Name"
                year={ledger.year}
                rows={rows}
                monthTotals={ledger.monthTotals}
                yearTotal={ledger.yearTotal}
                cellNote={(cell: LedgerCell) => (cell.count > 1 ? `${cell.count} transactions` : null)}
                onOpenRow={(id) => {
                  const partner = partnerById(id);
                  if (partner) setSelection({ partner, year: ledger.year, month: null });
                }}
                onOpenCell={(id, month) => {
                  const partner = partnerById(id);
                  if (partner) setSelection({ partner, year: ledger.year, month });
                }}
                stale={ledgerQ.isPlaceholderData}
              />
              {ledger.total > ledger.pageSize && (
                <Pagination
                  className="no-print"
                  page={ledger.page}
                  pageSize={ledger.pageSize}
                  total={ledger.total}
                  onPageChange={setPage}
                  onPageSizeChange={reset(setPageSize)}
                  loading={ledgerQ.isFetching}
                />
              )}
            </>
          )}

          <p className="text-[12.5px] text-pretty text-muted-foreground">
            Counted: approved partner advances and partner draws, in the month their voucher is dated. Pending, draft and
            rejected transactions are excluded, as is any transaction whose voucher was removed from the Daily Ledger; a
            voucher corrected there shows its corrected amount. Other company income and expenses are not part of this
            ledger.
          </p>
          {s && s.unassigned.count > 0 && (
            <SheetNote tone="warning">
              {s.unassigned.count} approved transaction{s.unassigned.count > 1 ? 's' : ''} totalling{' '}
              {fmt.money(s.unassigned.amount)} in {ledger?.year} {s.unassigned.count > 1 ? 'have' : 'has'} no partner on
              record and {s.unassigned.count > 1 ? 'are' : 'is'} not in any row above. See Source transactions.
            </SheetNote>
          )}
        </TabsContent>

        <TabsContent value="transactions" className="mt-4 space-y-4">
          {shownYear !== null && (
            <SourceTransactions year={shownYear} years={ledger?.years ?? []} onYearChange={reset(setYear)} />
          )}
        </TabsContent>
      </Tabs>

      <PartnerSheet selection={selection} txnKind={txnKind} onClose={() => setSelection(null)} />
    </div>
  );
}

function useTransactionLines() {
  const fmt = useLedgerFormat();
  return (t: PartnerLedgerTransaction): (string | null | false)[] => [
    KIND_LABEL[t.txnKind],
    niceDate(t.ledgerDate),
    t.ledgerDate !== t.businessDate && `Raised for ${niceDate(t.businessDate)}`,
    FINANCE_PAYMENT_METHOD_LABELS[t.paymentMethod] ?? t.paymentMethod,
    t.voucherNo && `Voucher ${t.voucherNo}`,
    `Requested by ${t.requestedByName || 'unknown'} · ${niceDateTime(t.createdAt)}`,
    t.status === 'rejected'
      ? `Rejected by ${t.approvedByName ?? 'unknown'} · ${niceDateTime(t.approvedAt)}${t.rejectionReason ? ` — ${t.rejectionReason}` : ''}`
      : t.approvedByName && `Approved by ${t.approvedByName} · ${niceDateTime(t.approvedAt)}`,
    t.counted && t.countedAmount !== t.amount && `Voucher amended to ${fmt.money(t.countedAmount)}`,
    t.exclusion === 'voucher_removed' && 'Its voucher was removed from the Daily Ledger',
    t.notes?.trim() || null,
  ];
}

/** One partner, one month or the whole year: the approved figure and the transactions it is made of. */
function PartnerSheet({
  selection,
  txnKind,
  onClose,
}: {
  selection: Selection | null;
  txnKind: PartnerTxnKind | undefined;
  onClose: () => void;
}) {
  const fmt = useLedgerFormat();
  const lines = useTransactionLines();
  const query = usePartnerLedgerTransactions(
    selection
      ? {
          partnerId: selection.partner.partnerId,
          year: selection.year,
          month: selection.month ?? undefined,
          txnKind,
          limit: 500,
        }
      : null,
  );
  const data = query.data;
  const partner = selection?.partner;

  return (
    <LedgerSheet
      open={selection !== null}
      onClose={onClose}
      kicker={partner ? `${partner.partnerCode} · Share ${partner.sharePct}%` : ' '}
      title={partner?.partnerName ?? 'Partner'}
      sub={selection ? (selection.month ? periodLabel(selection.year, selection.month) : `Year ${selection.year}`) : ' '}
    >
      {query.isLoading ? (
        <SheetLoading />
      ) : query.isError || !data ? (
        <SheetNote tone="danger">These transactions could not be loaded. Close this panel and try again.</SheetNote>
      ) : (
        <>
          <SheetTotal value={fmt.money(data.countedTotal)} note={`${data.countedCount} approved · counted once`} />
          {data.transactions.length > 0 ? (
            <div className="space-y-2">
              <p className="text-[13px] font-bold text-foreground/80">Underlying transactions</p>
              <ul className="space-y-2">
                {data.transactions.map((t) => (
                  <SourceItem
                    key={t.id}
                    reference={t.expenseNo}
                    exclusion={t.exclusion}
                    amount={fmt.money(t.amount)}
                    lines={lines(t)}
                  />
                ))}
              </ul>
            </div>
          ) : (
            <SheetNote tone="info">
              No transactions recorded for this partner in this period. Partner advances and draws are raised and
              approved in{' '}
              <Link href={ROUTES.FINANCE_PARTNER_TRANSACTIONS} className="font-semibold text-primary hover:underline">
                Partner Transactions
              </Link>
              .
            </SheetNote>
          )}
        </>
      )}
    </LedgerSheet>
  );
}

// ---------------------------------------------------------------------------
// Source transactions — every partner transaction of the year, counted or not
// ---------------------------------------------------------------------------

function SourceTransactions({
  year,
  years,
  onYearChange,
}: {
  year: number;
  years: LedgerYearOption[];
  onYearChange: (year: number) => void;
}) {
  const fmt = useLedgerFormat();
  const lines = useTransactionLines();
  const [searchText, setSearchText] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(20);
  const [viewing, setViewing] = useState<PartnerLedgerTransaction | null>(null);
  const search = useDebounce(searchText.trim(), 300);

  const query = usePartnerLedgerTransactions({
    year,
    search: search || undefined,
    limit: pageSize,
    offset: (page - 1) * pageSize,
  });
  const transactions = query.data?.transactions ?? [];

  return (
    <>
      <LedgerControls>
        <YearPicker
          year={year}
          years={years}
          onChange={(y) => {
            onYearChange(y);
            setPage(1);
          }}
        />
        <LedgerSearch
          value={searchText}
          onChange={(v) => {
            setSearchText(v);
            setPage(1);
          }}
          placeholder="Search by transaction, partner ID or name…"
        />
      </LedgerControls>

      {query.isLoading ? (
        <LedgerSkeleton />
      ) : query.isError ? (
        <LedgerError
          message={query.error instanceof Error ? query.error.message : 'Check the connection and try again.'}
          onRetry={() => void query.refetch()}
        />
      ) : transactions.length === 0 ? (
        <LedgerEmpty
          title={search ? 'No transactions match this search' : `No partner transactions for ${year}`}
          body={
            search
              ? 'Clear the search to see every transaction of the year.'
              : 'Partner advances and draws are raised and approved in Partner Transactions.'
          }
        />
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-xl border bg-card md:block">
            <table className="w-full text-sm tabular-nums">
              <thead data-table-head className="text-left">
                <tr>
                  {['Transaction', 'Partner', 'Date', 'Type', 'Method', 'Voucher', 'Amount', 'Status'].map((h) => (
                    <th key={h} scope="col" className="px-3 py-3 font-semibold whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {transactions.map((t) => (
                  <tr
                    key={t.id}
                    tabIndex={0}
                    onClick={() => setViewing(t)}
                    onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setViewing(t)}
                    className="cursor-pointer border-t outline-none hover:bg-muted/50 focus-visible:bg-muted/50"
                  >
                    <td className="px-3 py-3 font-mono text-xs whitespace-nowrap text-muted-foreground">{t.expenseNo}</td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      <span className="font-medium">{t.partnerName}</span>{' '}
                      <span className="font-mono text-xs text-muted-foreground">{t.partnerCode ?? 'no partner on record'}</span>
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">{niceDate(t.ledgerDate)}</td>
                    <td className="px-3 py-3 whitespace-nowrap">{KIND_LABEL[t.txnKind]}</td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      {FINANCE_PAYMENT_METHOD_LABELS[t.paymentMethod] ?? t.paymentMethod}
                    </td>
                    <td className="px-3 py-3 font-mono text-xs whitespace-nowrap text-muted-foreground">{t.voucherNo ?? '—'}</td>
                    <td className="px-3 py-3 font-semibold whitespace-nowrap">{fmt.money(t.amount)}</td>
                    <td className="px-3 py-3">
                      <SourceBadge exclusion={t.exclusion} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="space-y-2 md:hidden">
            {transactions.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => setViewing(t)}
                  className="flex w-full flex-col gap-1 rounded-xl border bg-card p-3 text-left"
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-semibold">{t.partnerName}</span>
                    <SourceBadge exclusion={t.exclusion} />
                  </span>
                  <span className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="font-mono text-xs text-muted-foreground">
                      {t.expenseNo} · {KIND_LABEL[t.txnKind]} · {niceDate(t.ledgerDate)}
                    </span>
                    <span className="font-semibold tabular-nums">{fmt.money(t.amount)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>

          <Pagination
            page={page}
            pageSize={pageSize}
            total={query.data?.total ?? 0}
            onPageChange={setPage}
            onPageSizeChange={(n) => {
              setPageSize(n);
              setPage(1);
            }}
            loading={query.isFetching}
          />
        </>
      )}

      <LedgerSheet
        open={viewing !== null}
        onClose={() => setViewing(null)}
        kicker={viewing ? `${viewing.partnerCode ?? 'No partner on record'} · ${KIND_LABEL[viewing.txnKind]}` : ' '}
        title={viewing?.partnerName ?? 'Transaction'}
        sub={viewing ? periodLabel(viewing.year, viewing.month) : ' '}
      >
        {viewing && (
          <>
            <SheetTotal
              value={fmt.money(viewing.countedAmount)}
              note={viewing.counted ? 'Approved · counted once' : 'Not counted in the ledger'}
            />
            <ul>
              <SourceItem
                reference={viewing.expenseNo}
                exclusion={viewing.exclusion}
                amount={fmt.money(viewing.amount)}
                lines={lines(viewing)}
              />
            </ul>
          </>
        )}
      </LedgerSheet>
    </>
  );
}
