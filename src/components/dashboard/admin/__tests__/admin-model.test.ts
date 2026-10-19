import { describe, expect, test } from 'vitest';
import type { FinanceDashboardDay, FinanceMonthlyDashboard } from '@mb/shared';
import {
  adminCsv,
  asSection,
  branchSummaryRows,
  currentSaleRows,
  dailyDemand,
  demandComparison,
  weeklyReturnsDiscount,
} from '../admin-model';

function day(over: Partial<FinanceDashboardDay>): FinanceDashboardDay {
  return {
    date: '2026-10-01',
    branchId: 'b1',
    demand: 0,
    companyShare: 0,
    received: 0,
    returns: 0,
    discount: 0,
    orders: 0,
    unpricedLines: 0,
    receipts: 0,
    returnCount: 0,
    discountCount: 0,
    ...over,
  };
}

function dashboard(over: Partial<FinanceMonthlyDashboard> = {}): FinanceMonthlyDashboard {
  const days = over.days ?? [
    day({ date: '2026-10-01', branchId: 'b1', demand: 1000, companyShare: 700, received: 500, orders: 2, returns: 30 }),
    day({ date: '2026-10-09', branchId: 'b1', demand: 500, companyShare: 350, orders: 1, discount: 20 }),
    day({ date: '2026-10-09', branchId: 'b2', demand: 200, companyShare: 140, received: 140, orders: 1 }),
  ];
  return {
    month: '2026-10',
    previousMonth: '2026-09',
    from: '2026-10-01',
    to: '2026-10-31',
    branchId: null,
    businessDate: '2026-10-10',
    generatedAt: '2026-10-10T10:00:00.000Z',
    branches: [
      { id: 'b1', name: 'Alabad', isActive: true },
      { id: 'b2', name: 'Committee Chowk', isActive: true },
      { id: 'b3', name: 'Commercial Market', isActive: true },
      { id: 'b4', name: 'Old Branch', isActive: false },
    ],
    summary: {
      demand: 1700,
      companyShare: 1190,
      received: 640,
      balance: 550,
      lastMonthBalance: 90,
      ledgerExpense: 400,
      returns: 30,
      discount: 20,
      orders: 4,
      receipts: 2,
      ledgerEntries: 1,
      returnCount: 1,
      discountCount: 1,
      unpricedLines: 0,
      ledgerIncome: 640,
      ledgerExpenseTotal: 400,
      ledgerNet: 240,
    },
    days,
    ledger: [
      { date: '2026-10-03', branchId: null, ledgerHeadId: 'h1', ledgerHeadName: 'Rent', amount: 400, entries: 1 },
    ],
    previous: [
      { branchId: 'b1', balance: 100 },
      { branchId: 'b2', balance: -10 },
    ],
    trend: [
      { month: '2026-09', demand: 3000, companyShare: 2100, received: 2000, balance: 100, returns: 0, discount: 0 },
      { month: '2026-10', demand: 1700, companyShare: 1190, received: 640, balance: 550, returns: 30, discount: 20 },
    ],
    ...over,
  };
}

describe('branchSummaryRows', () => {
  test('totals per branch, with last month balance and order count', () => {
    const rows = branchSummaryRows(dashboard());
    const b1 = rows.find((r) => r.branchId === 'b1')!;
    expect(b1).toMatchObject({
      demand: 1500,
      companyShare: 1050,
      received: 500,
      balance: 550,
      lastMonthBalance: 100,
      orders: 3,
      returns: 30,
      discount: 20,
    });
  });

  test('company expenses sit on the unassigned row', () => {
    const rows = branchSummaryRows(dashboard());
    expect(rows.find((r) => r.branchId === null)).toMatchObject({ branch: 'Company / unassigned', ledger: 400 });
  });

  test('an active branch with no records is listed at zero; an inactive one is not', () => {
    const rows = branchSummaryRows(dashboard());
    expect(rows.find((r) => r.branchId === 'b3')).toMatchObject({ demand: 0, orders: 0, lastMonthBalance: null });
    expect(rows.some((r) => r.branchId === 'b4')).toBe(false);
  });

  test('a branch-scoped response does not list the other branches', () => {
    const rows = branchSummaryRows(dashboard({ branchId: 'b2', days: [day({ branchId: 'b2', demand: 5 })], ledger: [] }));
    expect(rows.map((r) => r.branchId)).toEqual(['b2']);
  });
});

describe('dailyDemand', () => {
  test('is dense over the window and sums branches per day', () => {
    const d = dailyDemand(dashboard());
    expect(d).toHaveLength(31);
    expect(d[0]).toMatchObject({ date: '2026-10-01', label: '01', demand: 1000, orders: 2 });
    expect(d[8]).toMatchObject({ date: '2026-10-09', demand: 700, orders: 2 });
    expect(d[1]!.demand).toBe(0);
  });

  test('a day after the business date is a gap, not a zero', () => {
    const d = dailyDemand(dashboard());
    expect(d[9]).toMatchObject({ date: '2026-10-10', demand: 0 });
    expect(d[10]).toMatchObject({ date: '2026-10-11', demand: null });
  });
});

describe('weeklyReturnsDiscount', () => {
  test('buckets by week of the month (1–7, 8–14, …), clipped to the window', () => {
    const w = weeklyReturnsDiscount(dashboard({ businessDate: '2026-11-02' }));
    expect(w.map((x) => x.label)).toEqual(['01–07 Oct', '08–14 Oct', '15–21 Oct', '22–28 Oct', '29–31 Oct']);
    expect(w[0]).toMatchObject({ returns: 30, discount: 0 });
    expect(w[1]).toMatchObject({ returns: 0, discount: 20 });
  });

  test('weeks that have not started are left off', () => {
    // Business date 10 Oct: week 2 has started, week 3 has not.
    expect(weeklyReturnsDiscount(dashboard()).map((x) => x.label)).toEqual(['01–07 Oct', '08–14 Oct']);
  });

  test('a narrowed range only yields the weeks it touches', () => {
    const w = weeklyReturnsDiscount(dashboard({ from: '2026-10-06', to: '2026-10-09' }));
    expect(w.map((x) => [x.from, x.to])).toEqual([
      ['2026-10-06', '2026-10-07'],
      ['2026-10-08', '2026-10-09'],
    ]);
  });
});

describe('demandComparison', () => {
  test('compares daily averages over elapsed days only', () => {
    // 1700 over 10 elapsed days (to the business date) vs 3000 over September's 30.
    const c = demandComparison(dashboard())!;
    expect(c.currentAvg).toBe(170);
    expect(c.previousAvg).toBe(100);
    expect(c.changePct).toBeCloseTo(70);
  });

  test('no percentage against a month with no demand', () => {
    const c = demandComparison(dashboard({ trend: [] }))!;
    expect(c.changePct).toBeNull();
  });

  test('null when no day of the window has happened yet', () => {
    expect(demandComparison(dashboard({ from: '2026-10-20', to: '2026-10-31' }))).toBeNull();
  });
});

describe('currentSaleRows', () => {
  const branches = dashboard().branches;
  const sold = [
    { branchId: 'b2', branchName: 'Committee Chowk', totalOrders: 40, totalRevenue: 12520, averageOrderValue: 313 },
    { branchId: 'b1', branchName: 'Alabad', totalOrders: 9, totalRevenue: 2220, averageOrderValue: 246.67 },
  ];

  test('only branches that sold, largest sale first; a branch at 0 is left off', () => {
    expect(currentSaleRows(branches, sold, null)).toEqual([
      { branchId: 'b2', branch: 'Committee Chowk', sales: 12520, orders: 40 },
      { branchId: 'b1', branch: 'Alabad', sales: 2220, orders: 9 },
    ]);
  });

  test('the branch picked in the filter still shows at 0', () => {
    expect(currentSaleRows(branches, sold, 'b3')).toEqual([{ branchId: 'b3', branch: 'Commercial Market', sales: 0, orders: 0 }]);
  });

  test('the branch filter narrows it to that branch', () => {
    expect(currentSaleRows(branches, sold, 'b1').map((r) => r.branchId)).toEqual(['b1']);
  });

  test('sales from a branch the list does not know are kept, not dropped', () => {
    const rows = currentSaleRows(branches, [...sold, { branchId: 'gone', branchName: 'DHA', totalOrders: 3, totalRevenue: 2300, averageOrderValue: 0 }], null);
    expect(rows.find((r) => r.branchId === 'gone')).toMatchObject({ branch: 'DHA', sales: 2300 });
  });
});

describe('adminCsv', () => {
  test('has the branch summary with a total row, and leaves sales out when there are none', () => {
    const csv = adminCsv({
      context: 'October 2026 · All Branches',
      finance: dashboard(),
      sales: null,
      paymentLabel: (m) => m,
      incGran: 'monthly',
      expGran: 'monthly',
    });
    expect(csv).toContain('BRANCH SUMMARY');
    expect(csv).toContain('Last Month Balance (September 2026)');
    expect(csv).toContain('Total,1700,1190,640,550,400,30,20,90');
    expect(csv).not.toContain('PAYMENT METHODS');
  });
});

describe('asSection', () => {
  test('opens the tab the address bar names', () => {
    for (const key of ['overview', 'sales', 'branches', 'production', 'finance']) expect(asSection(key)).toBe(key);
  });

  test('falls back to the Overview for a missing or unknown value', () => {
    expect(asSection(null)).toBe('overview');
    expect(asSection('')).toBe('overview');
    expect(asSection('Finance')).toBe('overview');
    expect(asSection('reports')).toBe('overview');
  });
});
