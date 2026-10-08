'use client';

import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useMoney } from '../finance-ui';
import {
  PRODUCTION_ROW_LABEL,
  sortRows,
  type ExpenseRow,
  type Granularity,
  type IncomeRow,
  type SortState,
} from './dashboard-model';

/**
 * The two detail tables. A table on md+ (horizontal scroll where seven money
 * columns need it), expandable cards on phones — seven columns squeezed into
 * 360px is not a table anyone can read.
 *
 * Rows arrive already aggregated per (period, branch[, head]) by the server, so
 * sorting / search / paging here work on at most a few hundred summary rows,
 * never on raw transactions. The transactions themselves are behind each
 * figure's drill-down, which pages on the server.
 */

interface Column<T> {
  key: keyof T & string;
  label: string;
  money?: boolean;
  /** Clickable money cell → drill-down. Returns undefined when the cell has no source. */
  onClick?: (row: T) => (() => void) | undefined;
  strong?: boolean;
  signed?: boolean;
  muted?: boolean;
}

const PAGE_SIZES = { daily: 15, weekly: 20, monthly: 25 } as const;

function GranToggle({ value, onChange }: { value: Granularity; onChange: (g: Granularity) => void }) {
  return (
    <div className="flex rounded-md bg-fin-ink-field p-0.5" role="group" aria-label="Group rows by">
      {(['daily', 'weekly', 'monthly'] as const).map((g) => (
        <button
          key={g}
          type="button"
          aria-pressed={value === g}
          onClick={() => onChange(g)}
          className={cn(
            'rounded px-2.5 py-1 text-xs font-semibold capitalize transition-colors max-md:py-2',
            value === g ? 'bg-card text-foreground' : 'text-fin-ink-muted hover:text-fin-ink-foreground',
          )}
        >
          {g}
        </button>
      ))}
    </div>
  );
}

function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="relative w-full sm:w-56">
      <Search
        className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-fin-ink-muted"
        aria-hidden
      />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-9 border-0 bg-fin-ink-field pl-8 text-base text-fin-ink-foreground placeholder:text-fin-ink-muted md:h-8 md:text-xs"
      />
    </div>
  );
}

function FinanceGrid<T extends { id: string }>({
  title,
  band,
  controls,
  columns,
  rows,
  totals,
  totalsLabel,
  periodLabel,
  sort,
  onSort,
  pageSize,
  emptyMessage,
  rowTone,
}: {
  title: string;
  band: string;
  controls: React.ReactNode;
  columns: Column<T>[];
  rows: T[];
  totals: Partial<Record<keyof T & string, number | null>>;
  totalsLabel: string;
  periodLabel: string;
  sort: SortState<keyof T & string>;
  onSort: (key: keyof T & string) => void;
  pageSize: number;
  emptyMessage: string;
  rowTone?: (row: T) => string | undefined;
}) {
  const { format } = useMoney();
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const p = Math.min(page, pages - 1);
  const visible = rows.slice(p * pageSize, (p + 1) * pageSize);
  const money = (v: unknown) => (v === null || v === undefined ? '—' : format(Number(v)));
  const template = `minmax(9.5rem,1.2fr) ${columns
    .slice(1)
    .map((c) => (c.money ? 'minmax(7.5rem,1fr)' : 'minmax(8.5rem,1.2fr)'))
    .join(' ')}`;

  const header = (c: Column<T>) => {
    const active = sort.key === c.key;
    const Icon = active ? (sort.dir === 1 ? ArrowUp : ArrowDown) : ArrowUpDown;
    return (
      <button
        type="button"
        onClick={() => {
          onSort(c.key);
          setPage(0);
        }}
        className={cn('flex w-full items-center gap-1 px-3 py-2.5 text-left', c.money && 'justify-end text-right')}
      >
        {c.key === columns[0]!.key ? periodLabel : c.label}
        <Icon className={cn('size-3 shrink-0', !active && 'opacity-40')} aria-hidden />
      </button>
    );
  };

  const cell = (c: Column<T>, r: T) => {
    const v = r[c.key] as unknown;
    if (!c.money)
      return (
        <span className={cn(c.strong && 'font-semibold', c.muted && 'text-muted-foreground')}>{String(v ?? '—')}</span>
      );
    const n = v === null || v === undefined ? null : Number(v);
    const handler = c.onClick?.(r);
    const text = (
      <span
        className={cn(
          'tabular-nums',
          c.strong && 'font-bold',
          c.muted && 'text-muted-foreground',
          c.signed && n !== null && n < 0 && 'text-destructive',
        )}
      >
        {money(n)}
      </span>
    );
    return handler && n !== null ? (
      <button
        type="button"
        onClick={handler}
        className="cursor-pointer border-b border-dotted border-fin-share/60 hover:border-fin-share"
        title="View source records"
      >
        {text}
      </button>
    ) : (
      text
    );
  };

  return (
    <section className="min-w-0 overflow-hidden rounded-xl border bg-card shadow-xs">
      <header className={cn('flex flex-wrap items-center justify-between gap-2 px-4 py-2', band)}>
        <h2 className="text-[13px] font-extrabold tracking-[0.12em] text-fin-ink-foreground">{title}</h2>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">{controls}</div>
      </header>

      {rows.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-muted-foreground">{emptyMessage}</p>
      ) : (
        <>
          {/* md+: a real table */}
          <div className="hidden overflow-x-auto md:block">
            <div role="table" className="min-w-[56rem] text-[13px]">
              <div
                role="row"
                className="grid bg-fin-peach text-xs font-bold text-fin-peach-foreground"
                style={{ gridTemplateColumns: template }}
              >
                {columns.map((c) => (
                  <div
                    role="columnheader"
                    key={c.key}
                    aria-sort={sort.key === c.key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}
                  >
                    {header(c)}
                  </div>
                ))}
              </div>
              {visible.map((r) => (
                <div
                  role="row"
                  key={r.id}
                  className={cn('grid border-b hover:bg-fin-row-hover', rowTone?.(r))}
                  style={{ gridTemplateColumns: template }}
                >
                  {columns.map((c) => (
                    <div role="cell" key={c.key} className={cn('px-3 py-2', c.money && 'text-right')}>
                      {cell(c, r)}
                    </div>
                  ))}
                </div>
              ))}
              <div role="row" className="grid bg-fin-soft font-extrabold" style={{ gridTemplateColumns: template }}>
                {columns.map((c, i) => (
                  <div role="cell" key={c.key} className={cn('px-3 py-2.5', c.money && 'text-right tabular-nums')}>
                    {i === 0 ? totalsLabel : c.money ? money(totals[c.key]) : ''}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* phones: expandable cards */}
          <ul className="divide-y md:hidden">
            {visible.map((r) => {
              const expanded = open === r.id;
              const [first, second, ...rest] = columns;
              const lead = rest.find((c) => c.strong) ?? rest[0]!;
              return (
                <li key={r.id} className={rowTone?.(r)}>
                  <button
                    type="button"
                    onClick={() => setOpen(expanded ? null : r.id)}
                    aria-expanded={expanded}
                    className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold">{String(r[second!.key] ?? '')}</span>
                      <span className="block text-xs text-muted-foreground">{String(r[first!.key] ?? '')}</span>
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="text-right">
                        <span className="block text-[10.5px] font-bold tracking-[0.06em] text-muted-foreground uppercase">
                          {lead.label}
                        </span>
                        <span className="block text-sm font-bold tabular-nums">{money(r[lead.key])}</span>
                      </span>
                      <ChevronDown
                        className={cn('size-4 text-muted-foreground transition-transform', expanded && 'rotate-180')}
                        aria-hidden
                      />
                    </span>
                  </button>
                  {expanded && (
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 px-4 pb-3 text-sm">
                      {rest.map((c) => (
                        <div key={c.key} className="contents">
                          <dt className="text-muted-foreground">{c.label}</dt>
                          <dd className="text-right">{cell(c, r)}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </li>
              );
            })}
            <li className="bg-fin-soft px-4 py-3 text-sm">
              <p className="mb-1.5 font-extrabold">{totalsLabel}</p>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
                {columns
                  .filter((c) => c.money && totals[c.key] !== undefined)
                  .map((c) => (
                    <div key={c.key} className="contents">
                      <dt className="text-muted-foreground">{c.label}</dt>
                      <dd className="text-right font-bold tabular-nums">{money(totals[c.key])}</dd>
                    </div>
                  ))}
              </dl>
            </li>
          </ul>

          <footer className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-xs text-muted-foreground print:hidden">
            <span>
              Showing {p * pageSize + 1}–{Math.min(rows.length, (p + 1) * pageSize)} of {rows.length} rows
            </span>
            <div className="flex gap-1.5">
              <Button variant="outline" size="sm" disabled={p === 0} onClick={() => setPage(p - 1)}>
                Previous
              </Button>
              <Button variant="outline" size="sm" disabled={p >= pages - 1} onClick={() => setPage(p + 1)}>
                Next
              </Button>
            </div>
          </footer>
        </>
      )}
    </section>
  );
}

const sumOf = <T,>(rows: T[], pick: (r: T) => number | null) => {
  let s = 0;
  for (const r of rows) s += pick(r) ?? 0;
  return Math.round((s + Number.EPSILON) * 100) / 100;
};

// ---------------------------------------------------------------------------
// Income
// ---------------------------------------------------------------------------

type IncomeKey = 'period' | 'branch' | 'demand' | 'companyShare' | 'received' | 'balance' | 'lastMonthBalance';

export function IncomeTable({
  rows,
  gran,
  onGran,
  onDrill,
}: {
  rows: IncomeRow[];
  gran: Granularity;
  onGran: (g: Granularity) => void;
  onDrill: (metric: 'demand' | 'share' | 'received', row: IncomeRow) => void;
}) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<SortState<IncomeKey>>({
    key: 'period',
    dir: 1,
  });
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const hit = needle
      ? rows.filter((r) => `${r.branch} ${r.period} ${r.bucket}`.toLowerCase().includes(needle))
      : rows;
    const sortKey = sort.key === 'period' ? 'bucket' : sort.key;
    return sortRows(
      hit,
      { key: sortKey as keyof IncomeRow & string, dir: sort.dir },
      (a, b) => a.bucket.localeCompare(b.bucket) || a.branch.localeCompare(b.branch),
    );
  }, [rows, q, sort]);

  const columns: Column<IncomeRow>[] = [
    { key: 'period', label: 'Period' },
    { key: 'branch', label: 'Branch Name', strong: true },
    {
      key: 'demand',
      label: 'Demand Amount',
      money: true,
      onClick: (r) => (r.orders ? () => onDrill('demand', r) : undefined),
    },
    {
      key: 'companyShare',
      label: 'Company Share',
      money: true,
      onClick: (r) => (r.orders ? () => onDrill('share', r) : undefined),
    },
    {
      key: 'received',
      label: 'Received Amount',
      money: true,
      onClick: (r) => (r.receipts ? () => onDrill('received', r) : undefined),
    },
    {
      key: 'balance',
      label: 'Balance',
      money: true,
      strong: true,
      signed: true,
    },
    {
      key: 'lastMonthBalance',
      label: 'Last Month Balance',
      money: true,
      muted: true,
      signed: true,
    },
  ];

  return (
    <FinanceGrid
      title="INCOME"
      band="bg-fin-income"
      controls={
        <>
          <SearchBox value={q} onChange={setQ} placeholder="Search branch or date" />
          <GranToggle value={gran} onChange={onGran} />
        </>
      }
      columns={columns}
      rows={filtered}
      totals={{
        demand: sumOf(filtered, (r) => r.demand),
        companyShare: sumOf(filtered, (r) => r.companyShare),
        received: sumOf(filtered, (r) => r.received),
        balance: sumOf(filtered, (r) => r.balance),
        // Last month's balance only exists per branch-month; on a daily or
        // weekly table there is no per-row figure to total.
        lastMonthBalance: gran === 'monthly' ? sumOf(filtered, (r) => r.lastMonthBalance) : null,
      }}
      totalsLabel={q ? 'TOTAL (search)' : 'TOTAL'}
      periodLabel={gran === 'monthly' ? 'Month' : gran === 'weekly' ? 'Week' : 'Date'}
      sort={sort as SortState<keyof IncomeRow & string>}
      onSort={(k) =>
        setSort((s) => ({
          key: k as IncomeKey,
          dir: s.key === k ? (s.dir === 1 ? -1 : 1) : 1,
        }))
      }
      pageSize={PAGE_SIZES[gran]}
      emptyMessage={q ? 'No income rows match that search.' : 'No approved demand or receipts in this period.'}
    />
  );
}

// ---------------------------------------------------------------------------
// Expense
// ---------------------------------------------------------------------------

type ExpenseKey = 'period' | 'branch' | 'ledgerHead' | 'amount' | 'returns' | 'discount';

export function ExpenseTable({
  rows,
  gran,
  onGran,
  heads,
  onDrill,
}: {
  rows: ExpenseRow[];
  gran: Granularity;
  onGran: (g: Granularity) => void;
  heads: { ledgerHeadId: string; name: string }[];
  onDrill: (metric: 'ledger' | 'return' | 'discount', row: ExpenseRow) => void;
}) {
  const [q, setQ] = useState('');
  const [head, setHead] = useState('');
  const [sort, setSort] = useState<SortState<ExpenseKey>>({
    key: 'period',
    dir: 1,
  });
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let hit = rows;
    if (head === '~production') hit = hit.filter((r) => r.kind === 'production');
    else if (head) hit = hit.filter((r) => r.ledgerHeadId === head);
    if (needle)
      hit = hit.filter((r) => `${r.branch} ${r.ledgerHead} ${r.period} ${r.bucket}`.toLowerCase().includes(needle));
    const sortKey = sort.key === 'period' ? 'bucket' : sort.key;
    return sortRows(
      hit,
      { key: sortKey as keyof ExpenseRow & string, dir: sort.dir },
      (a, b) =>
        a.bucket.localeCompare(b.bucket) ||
        a.branch.localeCompare(b.branch) ||
        (a.kind === 'production' ? 1 : 0) - (b.kind === 'production' ? 1 : 0) ||
        a.ledgerHead.localeCompare(b.ledgerHead),
    );
  }, [rows, q, head, sort]);

  const columns: Column<ExpenseRow>[] = [
    { key: 'period', label: 'Period' },
    { key: 'branch', label: 'Branch Name', strong: true },
    { key: 'ledgerHead', label: 'Ledger Head' },
    {
      key: 'amount',
      label: 'Amount',
      money: true,
      strong: true,
      onClick: (r) => (r.kind === 'ledger' ? () => onDrill('ledger', r) : undefined),
    },
    {
      key: 'returns',
      label: 'Return',
      money: true,
      onClick: (r) => (r.kind === 'production' ? () => onDrill('return', r) : undefined),
    },
    {
      key: 'discount',
      label: 'Discount',
      money: true,
      onClick: (r) => (r.kind === 'production' ? () => onDrill('discount', r) : undefined),
    },
  ];

  return (
    <FinanceGrid
      title="EXPENSES"
      band="bg-fin-expense"
      controls={
        <>
          <SearchBox value={q} onChange={setQ} placeholder="Search branch or head" />
          <select
            value={head}
            onChange={(e) => setHead(e.target.value)}
            aria-label="Ledger head"
            className="h-9 max-w-full rounded-md border-0 bg-fin-ink-field px-2 text-base font-semibold text-fin-ink-foreground md:h-8 md:text-xs"
          >
            <option value="">All ledger heads</option>
            {heads.map((h) => (
              <option key={h.ledgerHeadId} value={h.ledgerHeadId}>
                {h.name}
              </option>
            ))}
            <option value="~production">{PRODUCTION_ROW_LABEL}</option>
          </select>
          <GranToggle value={gran} onChange={onGran} />
        </>
      }
      columns={columns}
      rows={filtered}
      totals={{
        amount: sumOf(filtered, (r) => r.amount),
        returns: sumOf(filtered, (r) => r.returns),
        discount: sumOf(filtered, (r) => r.discount),
      }}
      totalsLabel={q || head ? 'TOTAL (filtered)' : 'TOTAL'}
      periodLabel={gran === 'monthly' ? 'Month' : gran === 'weekly' ? 'Week' : 'Date'}
      sort={sort as SortState<keyof ExpenseRow & string>}
      onSort={(k) =>
        setSort((s) => ({
          key: k as ExpenseKey,
          dir: s.key === k ? (s.dir === 1 ? -1 : 1) : 1,
        }))
      }
      pageSize={PAGE_SIZES[gran]}
      emptyMessage={
        q || head ? 'No expense rows match these filters.' : 'No ledger expense, return or discount in this period.'
      }
      rowTone={(r) => (r.kind === 'production' ? 'text-muted-foreground' : undefined)}
    />
  );
}
