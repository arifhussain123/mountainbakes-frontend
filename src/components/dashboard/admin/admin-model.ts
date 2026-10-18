import type { FinanceMonthlyDashboard, SalesAnalytics } from '@mb/shared';
import {
  branchTotals,
  bucketRange,
  daysInMonth,
  dayLabel,
  expenseRows,
  incomeRows,
  monthLong,
  toCsv,
  type BranchTotals,
  type Granularity,
} from '@/components/finance/dashboard/dashboard-model';

/**
 * Shaping for the Admin Dashboard.
 *
 * Like the Finance Dashboard's model this derives no money: every amount is a
 * server-side sum from `/api/finance/dashboard/monthly` (migration 128) or
 * `/api/sales-analytics` (migration 100). These functions regroup those rows
 * for the branch table, the demand line and the weekly bars, and nothing else.
 */

export type Section = 'overview' | 'sales' | 'branches' | 'production' | 'finance';

export const SECTIONS: { key: Section; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'sales', label: 'Sales' },
  { key: 'branches', label: 'Branches' },
  { key: 'production', label: 'Production' },
  { key: 'finance', label: 'Finance' },
];

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const end = new Date(`${to}T00:00:00Z`).getTime();
  for (let t = new Date(`${from}T00:00:00Z`).getTime(); t <= end; t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Branch summary
// ---------------------------------------------------------------------------

export interface BranchSummaryRow extends BranchTotals {
  /** The previous business month's Share − Received; null = no records that month. */
  lastMonthBalance: number | null;
  orders: number;
}

/**
 * One row per branch in scope. Active branches with nothing in the window are
 * listed at zero — on an all-branches table a missing branch reads as "not
 * loaded", not as "sold nothing". Inactive ones appear only when they still
 * carry records in the window.
 */
export function branchSummaryRows(data: FinanceMonthlyDashboard): BranchSummaryRow[] {
  const prev = new Map(data.previous.map((p) => [p.branchId, p.balance]));
  const orders = new Map<string | null, number>();
  for (const d of data.days) orders.set(d.branchId, (orders.get(d.branchId) ?? 0) + d.orders);

  const rows: BranchSummaryRow[] = branchTotals(data).map((b) => ({
    ...b,
    lastMonthBalance: prev.get(b.branchId) ?? null,
    orders: orders.get(b.branchId) ?? 0,
  }));
  const seen = new Set(rows.map((r) => r.branchId));
  for (const b of data.branches) {
    if (!b.isActive || seen.has(b.id)) continue;
    if (data.branchId && data.branchId !== b.id) continue;
    rows.push({
      branchId: b.id,
      branch: b.name,
      demand: 0,
      companyShare: 0,
      received: 0,
      balance: 0,
      ledger: 0,
      returns: 0,
      discount: 0,
      lastMonthBalance: prev.get(b.id) ?? null,
      orders: 0,
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Production
// ---------------------------------------------------------------------------

/** Approved demand per business date of the window — dense, a quiet day is a 0. */
export function dailyDemand(data: FinanceMonthlyDashboard) {
  const byDate = new Map(
    datesBetween(data.from, data.to).map((date) => [
      date,
      { date, label: date.slice(8, 10), demand: 0, orders: 0 },
    ]),
  );
  for (const d of data.days) {
    const r = byDate.get(d.date);
    if (!r) continue;
    r.demand += d.demand;
    r.orders += d.orders;
  }
  return [...byDate.values()].map((r) => ({ ...r, demand: round2(r.demand) }));
}

/**
 * Return and discount per week of the month (days 1–7, 8–14, …), the same
 * weeks the Finance Dashboard's weekly tables use, clipped to the window.
 */
export function weeklyReturnsDiscount(data: FinanceMonthlyDashboard) {
  const weeks = new Map<string, { key: string; label: string; from: string; to: string; returns: number; discount: number }>();
  for (const date of datesBetween(data.from, data.to)) {
    const key = `${date.slice(0, 7)}-W${Math.ceil(Number(date.slice(8, 10)) / 7)}`;
    if (weeks.has(key)) continue;
    const r = bucketRange('weekly', key, data.from, data.to);
    weeks.set(key, {
      key,
      label: r.from === r.to ? dayLabel(r.from) : `${r.from.slice(8)}–${dayLabel(r.to)}`,
      ...r,
      returns: 0,
      discount: 0,
    });
  }
  for (const d of data.days) {
    const w = weeks.get(`${d.date.slice(0, 7)}-W${Math.ceil(Number(d.date.slice(8, 10)) / 7)}`);
    if (!w) continue;
    w.returns += d.returns;
    w.discount += d.discount;
  }
  return [...weeks.values()].map((w) => ({ ...w, returns: round2(w.returns), discount: round2(w.discount) }));
}

export interface DemandComparison {
  /** Average approved demand per elapsed day of the window. */
  currentAvg: number;
  /** The previous month's whole-month demand over its days. */
  previousAvg: number;
  /** Null when the previous month had no demand — a % against zero is not a measurement. */
  changePct: number | null;
  previousMonth: string;
}

/**
 * The window's daily average against last month's.
 *
 * Averages, not totals: a month-to-date window holds fewer days than the whole
 * month it is set against, and a total comparison would report every month in
 * progress as a collapse. Days after today are not elapsed and are left out.
 * Null when no day of the window has happened yet.
 */
export function demandComparison(data: FinanceMonthlyDashboard): DemandComparison | null {
  const end = data.to < data.businessDate ? data.to : data.businessDate;
  if (end < data.from) return null;
  const elapsed = datesBetween(data.from, end).length;
  const current = data.days.reduce((s, d) => (d.date <= end ? s + d.demand : s), 0);
  const prev = data.trend.find((m) => m.month === data.previousMonth)?.demand ?? 0;
  const currentAvg = current / elapsed;
  const previousAvg = prev / daysInMonth(data.previousMonth);
  return {
    currentAvg: round2(currentAvg),
    previousAvg: round2(previousAvg),
    changePct: previousAvg > 0 ? ((currentAvg - previousAvg) / previousAvg) * 100 : null,
    previousMonth: data.previousMonth,
  };
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/** Everything the page shows, one block per section, in the page's own order. */
export function adminCsv({
  context,
  finance,
  sales,
  paymentLabel,
  incGran,
  expGran,
}: {
  context: string;
  finance: FinanceMonthlyDashboard;
  sales: SalesAnalytics | null;
  paymentLabel: (method: string) => string;
  incGran: Granularity;
  expGran: Granularity;
}): string {
  const s = finance.summary;
  const blocks: string[] = [`Mountain Bakes Admin Dashboard — ${context}`];

  if (sales) {
    blocks.push(
      'SALES',
      toCsv(
        ['Total Sales', 'Transactions', 'Average Daily Sales', 'Staff Sales (unpaid)'],
        [[sales.totalSales, sales.totalTransactions, sales.averageDailySales, sales.staffTotal]],
      ),
      'PAYMENT METHODS',
      toCsv(
        ['Method', 'Transactions', 'Amount'],
        sales.paymentMethods.map((p) => [paymentLabel(p.method), p.count, p.total]),
      ),
      'TOP SELLING PRODUCTS',
      toCsv(
        ['Rank', 'Product', 'Category', 'Qty Sold', 'Sales'],
        sales.topProducts.map((p, i) => [i + 1, p.productName, p.categoryName, p.qty, p.sales]),
      ),
    );
  }

  blocks.push(
    'BRANCH SUMMARY',
    toCsv(
      [
        'Branch',
        'Demand Amount',
        'Company Share',
        'Received Amount',
        'Balance',
        `Last Month Balance (${monthLong(finance.previousMonth)})`,
        'Ledger Expense',
        'Return',
        'Discount',
      ],
      [
        ...branchSummaryRows(finance).map((r) => [
          r.branch,
          r.demand,
          r.companyShare,
          r.received,
          r.balance,
          r.lastMonthBalance,
          r.ledger,
          r.returns,
          r.discount,
        ]),
        ['Total', s.demand, s.companyShare, s.received, s.balance, s.lastMonthBalance, s.ledgerExpense, s.returns, s.discount],
      ],
    ),
    'INCOME',
    toCsv(
      ['Period', 'Branch Name', 'Demand Amount', 'Company Share', 'Received Amount', 'Balance', 'Last Month Balance'],
      incomeRows(finance, incGran).map((r) => [
        r.period,
        r.branch,
        r.demand,
        r.companyShare,
        r.received,
        r.balance,
        r.lastMonthBalance,
      ]),
    ),
    'EXPENSES',
    toCsv(
      ['Period', 'Branch Name', 'Ledger Head', 'Amount', 'Return', 'Discount'],
      expenseRows(finance, expGran).map((r) => [r.period, r.branch, r.ledgerHead, r.amount, r.returns, r.discount]),
    ),
  );
  return blocks.join('\n\n');
}
