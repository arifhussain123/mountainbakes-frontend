import type {
  FinanceDashboardDay,
  FinanceDashboardLedgerRow,
  FinanceDashboardMetric,
  FinanceMonthlyDashboard,
} from '@mb/shared';

/**
 * Shaping for the monthly Finance Dashboard.
 *
 * No money is DERIVED here. Every amount arrives already summed per (business
 * date, branch[, ledger head]) from `finance_monthly_dashboard` (migration 128);
 * this file only regroups those rows into the period the table is showing
 * (day / week / month) and labels them. The one subtraction, Balance =
 * Company Share − Received, is the rule the brief defines and the server's own
 * summary applies, so a table row and the summary card agree by construction.
 */

export type Granularity = 'daily' | 'weekly' | 'monthly';

export const UNASSIGNED_LABEL = 'Company / unassigned';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export function monthLong(ym: string): string {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  return `${MONTHS[m - 1]} ${y}`;
}

export function monthShort(ym: string): string {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  return `${MONTHS[m - 1]!.slice(0, 3)} ${String(y).slice(2)}`;
}

export function daysInMonth(ym: string): number {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function shiftMonth(ym: string, by: number): string {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** '2026-09-07' → '07 Sep' */
export function dayLabel(date: string): string {
  const m = Number(date.slice(5, 7));
  return `${date.slice(8, 10)} ${MONTHS[m - 1]!.slice(0, 3)}`;
}

function bucketOf(gran: Granularity, date: string): string {
  if (gran === 'monthly') return date.slice(0, 7);
  if (gran === 'weekly') return `${date.slice(0, 7)}-W${Math.ceil(Number(date.slice(8, 10)) / 7)}`;
  return date;
}

/** The inclusive date range a bucket covers, clipped to the selected window. */
export function bucketRange(gran: Granularity, key: string, from: string, to: string): { from: string; to: string } {
  let a: string;
  let b: string;
  if (gran === 'daily') {
    a = key;
    b = key;
  } else if (gran === 'monthly') {
    a = `${key}-01`;
    b = `${key}-${String(daysInMonth(key)).padStart(2, '0')}`;
  } else {
    const ym = key.slice(0, 7);
    const w = Number(key.slice(9));
    a = `${ym}-${String((w - 1) * 7 + 1).padStart(2, '0')}`;
    b = `${ym}-${String(Math.min(w * 7, daysInMonth(ym))).padStart(2, '0')}`;
  }
  return { from: a < from ? from : a, to: b > to ? to : b };
}

export function bucketLabel(gran: Granularity, key: string, from: string, to: string): string {
  if (gran === 'monthly') return monthLong(key);
  if (gran === 'daily') return `${dayLabel(key)} ${key.slice(0, 4)}`;
  const r = bucketRange(gran, key, from, to);
  return `Week ${key.slice(9)} · ${r.from.slice(8)}–${dayLabel(r.to)}`;
}

export function branchNamer(data: FinanceMonthlyDashboard) {
  const names = new Map(data.branches.map((b) => [b.id, b.isActive ? b.name : `${b.name} (inactive)`]));
  return (id: string | null) => (id === null ? UNASSIGNED_LABEL : (names.get(id) ?? 'Unknown branch'));
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

// ---------------------------------------------------------------------------
// Income table
// ---------------------------------------------------------------------------

export interface IncomeRow {
  id: string;
  bucket: string;
  period: string;
  branchId: string | null;
  branch: string;
  demand: number;
  companyShare: number;
  received: number;
  balance: number;
  /** Monthly rows only; null = no records last month (or not a monthly row). */
  lastMonthBalance: number | null;
  orders: number;
  receipts: number;
}

export function incomeRows(data: FinanceMonthlyDashboard, gran: Granularity): IncomeRow[] {
  const name = branchNamer(data);
  const prev = new Map(data.previous.map((p) => [p.branchId, p.balance]));
  const map = new Map<string, IncomeRow>();
  for (const d of data.days as FinanceDashboardDay[]) {
    // A day with only production adjustments (return / discount) is an EXPENSE
    // row; it is left out here so the income table never shows all-zero rows.
    if (!d.orders && !d.receipts) continue;
    const bucket = bucketOf(gran, d.date);
    const id = `${bucket}|${d.branchId ?? ''}`;
    let row = map.get(id);
    if (!row) {
      row = {
        id,
        bucket,
        period: bucketLabel(gran, bucket, data.from, data.to),
        branchId: d.branchId,
        branch: name(d.branchId),
        demand: 0,
        companyShare: 0,
        received: 0,
        balance: 0,
        lastMonthBalance: gran === 'monthly' ? (prev.get(d.branchId) ?? null) : null,
        orders: 0,
        receipts: 0,
      };
      map.set(id, row);
    }
    row.demand += d.demand;
    row.companyShare += d.companyShare;
    row.received += d.received;
    row.orders += d.orders;
    row.receipts += d.receipts;
  }
  // A branch that had a balance last month but no activity this month still
  // owes it — show it on the monthly view rather than dropping the carry.
  if (gran === 'monthly') {
    for (const p of data.previous) {
      const id = `${data.month}|${p.branchId ?? ''}`;
      if (map.has(id) || p.balance === null || p.balance === 0) continue;
      if (data.branchId && p.branchId !== data.branchId) continue;
      map.set(id, {
        id,
        bucket: data.month,
        period: monthLong(data.month),
        branchId: p.branchId,
        branch: name(p.branchId),
        demand: 0,
        companyShare: 0,
        received: 0,
        balance: 0,
        lastMonthBalance: p.balance,
        orders: 0,
        receipts: 0,
      });
    }
  }
  return [...map.values()].map((r) => ({
    ...r,
    demand: round2(r.demand),
    companyShare: round2(r.companyShare),
    received: round2(r.received),
    balance: round2(r.companyShare - r.received),
  }));
}

// ---------------------------------------------------------------------------
// Expense table
// ---------------------------------------------------------------------------

export interface ExpenseRow {
  id: string;
  bucket: string;
  period: string;
  branchId: string | null;
  branch: string;
  /** null for the production-adjustment row. */
  ledgerHeadId: string | null;
  ledgerHead: string;
  /** Ledger amount; null on the production row (it has none). */
  amount: number | null;
  returns: number | null;
  discount: number | null;
  entries: number;
  kind: 'ledger' | 'production';
}

export const PRODUCTION_ROW_LABEL = 'Production · Return / Discount';

export function expenseRows(data: FinanceMonthlyDashboard, gran: Granularity): ExpenseRow[] {
  const name = branchNamer(data);
  const map = new Map<string, ExpenseRow>();
  for (const l of data.ledger as FinanceDashboardLedgerRow[]) {
    const bucket = bucketOf(gran, l.date);
    const id = `${bucket}|${l.branchId ?? ''}|${l.ledgerHeadId}`;
    let row = map.get(id);
    if (!row) {
      row = {
        id,
        bucket,
        period: bucketLabel(gran, bucket, data.from, data.to),
        branchId: l.branchId,
        branch: name(l.branchId),
        ledgerHeadId: l.ledgerHeadId,
        ledgerHead: l.ledgerHeadName,
        amount: 0,
        returns: null,
        discount: null,
        entries: 0,
        kind: 'ledger',
      };
      map.set(id, row);
    }
    row.amount = (row.amount ?? 0) + l.amount;
    row.entries += l.entries;
  }
  for (const d of data.days as FinanceDashboardDay[]) {
    if (!d.returnCount && !d.discountCount) continue;
    const bucket = bucketOf(gran, d.date);
    const id = `${bucket}|${d.branchId ?? ''}|~production`;
    let row = map.get(id);
    if (!row) {
      row = {
        id,
        bucket,
        period: bucketLabel(gran, bucket, data.from, data.to),
        branchId: d.branchId,
        branch: name(d.branchId),
        ledgerHeadId: null,
        ledgerHead: PRODUCTION_ROW_LABEL,
        amount: null,
        returns: 0,
        discount: 0,
        entries: 0,
        kind: 'production',
      };
      map.set(id, row);
    }
    row.returns = (row.returns ?? 0) + d.returns;
    row.discount = (row.discount ?? 0) + d.discount;
    row.entries += d.returnCount + d.discountCount;
  }
  return [...map.values()].map((r) => ({
    ...r,
    amount: r.amount === null ? null : round2(r.amount),
    returns: r.returns === null ? null : round2(r.returns),
    discount: r.discount === null ? null : round2(r.discount),
  }));
}

// ---------------------------------------------------------------------------
// Charts
// ---------------------------------------------------------------------------

/** Every business date of the window, with that day's totals across the scope. */
export function dailySeries(data: FinanceMonthlyDashboard) {
  const out: {
    date: string;
    label: string;
    companyShare: number;
    received: number;
    ledger: number;
    returns: number;
    discount: number;
  }[] = [];
  const byDate = new Map<string, (typeof out)[number]>();
  const start = new Date(`${data.from}T00:00:00Z`).getTime();
  const end = new Date(`${data.to}T00:00:00Z`).getTime();
  for (let t = start; t <= end; t += 86_400_000) {
    const date = new Date(t).toISOString().slice(0, 10);
    const row = {
      date,
      label: date.slice(8, 10),
      companyShare: 0,
      received: 0,
      ledger: 0,
      returns: 0,
      discount: 0,
    };
    out.push(row);
    byDate.set(date, row);
  }
  for (const d of data.days) {
    const r = byDate.get(d.date);
    if (!r) continue;
    r.companyShare += d.companyShare;
    r.received += d.received;
    r.returns += d.returns;
    r.discount += d.discount;
  }
  for (const l of data.ledger) {
    const r = byDate.get(l.date);
    if (r) r.ledger += l.amount;
  }
  return out.map((r) => ({
    ...r,
    companyShare: round2(r.companyShare),
    received: round2(r.received),
    ledger: round2(r.ledger),
    returns: round2(r.returns),
    discount: round2(r.discount),
  }));
}

export interface BranchTotals {
  branchId: string | null;
  branch: string;
  demand: number;
  companyShare: number;
  received: number;
  balance: number;
  ledger: number;
  returns: number;
  discount: number;
}

export function branchTotals(data: FinanceMonthlyDashboard): BranchTotals[] {
  const name = branchNamer(data);
  const map = new Map<string | null, BranchTotals>();
  const get = (b: string | null) => {
    let r = map.get(b);
    if (!r) {
      r = {
        branchId: b,
        branch: name(b),
        demand: 0,
        companyShare: 0,
        received: 0,
        balance: 0,
        ledger: 0,
        returns: 0,
        discount: 0,
      };
      map.set(b, r);
    }
    return r;
  };
  for (const d of data.days) {
    const r = get(d.branchId);
    r.demand += d.demand;
    r.companyShare += d.companyShare;
    r.received += d.received;
    r.returns += d.returns;
    r.discount += d.discount;
  }
  for (const l of data.ledger) get(l.branchId).ledger += l.amount;
  return [...map.values()]
    .map((r) => ({
      ...r,
      demand: round2(r.demand),
      companyShare: round2(r.companyShare),
      received: round2(r.received),
      balance: round2(r.companyShare - r.received),
      ledger: round2(r.ledger),
      returns: round2(r.returns),
      discount: round2(r.discount),
    }))
    .sort((a, b) => (a.branchId === null ? 1 : b.branchId === null ? -1 : a.branch.localeCompare(b.branch)));
}

export function ledgerHeadTotals(data: FinanceMonthlyDashboard) {
  const map = new Map<string, { ledgerHeadId: string; name: string; amount: number; entries: number }>();
  for (const l of data.ledger) {
    const r = map.get(l.ledgerHeadId) ?? {
      ledgerHeadId: l.ledgerHeadId,
      name: l.ledgerHeadName,
      amount: 0,
      entries: 0,
    };
    r.amount += l.amount;
    r.entries += l.entries;
    map.set(l.ledgerHeadId, r);
  }
  return [...map.values()].map((r) => ({ ...r, amount: round2(r.amount) })).sort((a, b) => b.amount - a.amount);
}

// ---------------------------------------------------------------------------
// Drill-down
// ---------------------------------------------------------------------------

export interface DrillTarget {
  metric: FinanceDashboardMetric;
  from: string;
  to: string;
  /** undefined = the dashboard's branch filter; null = unassigned rows only. */
  branchId?: string | null;
  ledgerHeadId?: string;
  context: string;
}

export const METRIC_INFO: Record<
  FinanceDashboardMetric,
  {
    title: string;
    source: string;
    rule: string;
    status: string;
    date: string;
    refLabel: string;
  }
> = {
  demand: {
    title: 'Demand Amount',
    source: 'Production orders reviewed by Production (awaiting verification, verified, approved)',
    rule: 'Σ approved quantity × current product price, per order',
    status: 'Production-reviewed demand only — pending, rejected and cancelled excluded',
    date: 'Order business date',
    refLabel: 'Demand no.',
  },
  share: {
    title: 'Company Share',
    source: 'The same approved Production demand',
    rule: "Order demand × the branch's company share % (branch override, else Finance Settings) — the rule every production slip bills on",
    status: 'Production-reviewed demand only',
    date: 'Order business date',
    refLabel: 'Demand no.',
  },
  received: {
    title: 'Received Amount',
    source: 'Finance Ledger income on the Company Share and Fuel heads, plus approved Cash Deposit postings',
    rule: 'Σ debit − credit, so a reversal nets out; deleted entries excluded',
    status: 'Posted to the ledger (entries exist only once approved)',
    date: 'Ledger entry date',
    refLabel: 'Voucher',
  },
  ledger: {
    title: 'Ledger Expense',
    source: 'Finance Ledger expense entries (company expenses). Branch shop expenses never reach the ledger.',
    rule: 'Σ credit − debit per ledger head; deleted entries excluded',
    status: 'Posted to the ledger (entries exist only once approved)',
    date: 'Ledger entry date',
    refLabel: 'Voucher',
  },
  return: {
    title: 'Return',
    source: 'Production returns from branches',
    rule: 'Returned quantity × current product price',
    status: 'Accepted by Production only',
    date: 'Return business date',
    refLabel: 'Reference',
  },
  discount: {
    title: 'Discount',
    source: 'Production (branch) discounts claimed against a demand',
    rule: 'Claim amount as approved',
    status: 'Approved by Production only',
    date: 'Discount business date',
    refLabel: 'Demand no.',
  },
};

// ---------------------------------------------------------------------------
// Tables — sorting, search, paging, CSV
// ---------------------------------------------------------------------------

export type SortState<K extends string> = { key: K; dir: 1 | -1 };

export function sortRows<T, K extends keyof T & string>(
  rows: T[],
  sort: SortState<K>,
  tieBreak: (a: T, b: T) => number,
): T[] {
  return [...rows].sort((a, b) => {
    const x = a[sort.key] as unknown;
    const y = b[sort.key] as unknown;
    // Blank cells (—) always sink to the bottom, whichever way the column sorts.
    if (x === null && y === null) return tieBreak(a, b);
    if (x === null) return 1;
    if (y === null) return -1;
    const c = typeof x === 'string' ? x.localeCompare(y as string) : (x as number) - (y as number);
    return c * sort.dir || tieBreak(a, b);
  });
}

export function toCsv(headers: string[], rows: (string | number | null)[][]): string {
  const cell = (v: string | number | null) => {
    if (v === null) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers, ...rows].map((r) => r.map(cell).join(',')).join('\n');
}

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
