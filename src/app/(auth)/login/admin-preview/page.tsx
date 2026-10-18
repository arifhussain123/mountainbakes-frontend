'use client';
// TEMPORARY — layout preview of the Admin Dashboard with seeded data. Delete after use.

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { FinanceDashboardDay, FinanceMonthlyDashboard, SalesAnalytics } from '@mb/shared';
import { qk } from '@/lib/queryKeys';
import { AdminDashboard } from '@/components/dashboard/AdminDashboard';

const B = [
  { id: 'b1', name: 'Committee Chowk Branch', isActive: true, f: 1.6 },
  { id: 'b2', name: 'Alabad Branch', isActive: true, f: 0.7 },
  { id: 'b3', name: 'Commercial Market Branch', isActive: true, f: 0.45 },
];
let seed = 7;
const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pad = (n: number) => String(n).padStart(2, '0');

function finance(branchId: string | null): FinanceMonthlyDashboard {
  seed = 7;
  const days: FinanceDashboardDay[] = [];
  const ledger: FinanceMonthlyDashboard['ledger'] = [];
  for (const b of B) {
    for (let d = 1; d <= 18; d++) {
      const demand = Math.round((22000 + r() * 20000) * b.f);
      const share = Math.round(demand * 0.72);
      const day = {
        date: `2026-10-${pad(d)}`, branchId: b.id, demand, companyShare: share,
        received: r() < 0.7 ? Math.round(share * (0.7 + r() * 0.5)) : 0,
        returns: Math.round(demand * 0.02 * r()), discount: Math.round(demand * 0.01 * r()),
        orders: 1, unpricedLines: 0, receipts: 1, returnCount: 1, discountCount: 1,
      };
      if (!branchId || branchId === b.id) days.push(day);
    }
  }
  const heads = ['Rent', 'Utilities', 'Packaging Material', 'Vehicle Maintenance', 'Transport', 'Miscellaneous'];
  for (let d = 1; d <= 18; d += 2) {
    if (!branchId) ledger.push({ date: `2026-10-${pad(d)}`, branchId: null, ledgerHeadId: `h${d % 6}`, ledgerHeadName: heads[d % 6]!, amount: Math.round(1500 + r() * 9000), entries: 1 });
  }
  const sum = (f: (x: FinanceDashboardDay) => number) => days.reduce((s, x) => s + f(x), 0);
  const companyShare = sum((x) => x.companyShare), received = sum((x) => x.received);
  const ledgerExpense = ledger.reduce((s, l) => s + l.amount, 0);
  return {
    month: '2026-10', previousMonth: '2026-09', from: '2026-10-01', to: '2026-10-31', branchId,
    businessDate: '2026-10-18', generatedAt: new Date().toISOString(),
    branches: B.map(({ id, name, isActive }) => ({ id, name, isActive })),
    summary: {
      demand: sum((x) => x.demand), companyShare, received, balance: companyShare - received, lastMonthBalance: 42000,
      ledgerExpense, returns: sum((x) => x.returns), discount: sum((x) => x.discount), orders: days.length,
      receipts: days.length, ledgerEntries: ledger.length, returnCount: days.length, discountCount: days.length,
      unpricedLines: 0, ledgerIncome: received, ledgerExpenseTotal: ledgerExpense, ledgerNet: received - ledgerExpense,
    },
    days, ledger,
    previous: B.map((b) => ({ branchId: b.id, balance: Math.round(20000 * b.f - 9000) })),
    trend: [{ month: '2026-09', demand: 2_400_000 * (branchId ? 0.4 : 1), companyShare: 0, received: 0, balance: 0, returns: 0, discount: 0 }],
  };
}

function sales(branchId: string | null): SalesAnalytics {
  return {
    from: '2026-10-01', effectiveTo: '2026-10-18', branchId, branchName: null,
    totalSales: 1_284_500, totalTransactions: 3120, todaySales: 64000, todayTransactions: 150,
    averageDailySales: 71361, highestDay: null, lowestDay: null, staffTotal: 8400, staffCount: 21, daily: [],
    paymentMethods: [{ method: 'cash', total: 972_000, count: 2500 }, { method: 'card', total: 312_500, count: 620 }],
    topProducts: [
      { productId: '1', productName: 'Chicken Patties', categoryName: 'Savoury', qty: 1820, sales: 182000 },
      { productId: '2', productName: 'Chocolate Fudge Cake (1 lb)', categoryName: 'Cakes', qty: 140, sales: 168000 },
      { productId: '3', productName: 'Bread Large', categoryName: 'Bread', qty: 1450, sales: 145000 },
      { productId: '4', productName: 'Rusk Box', categoryName: 'Biscuits', qty: 610, sales: 97600 },
      { productId: '5', productName: 'Pizza Small', categoryName: 'Savoury', qty: 220, sales: 88000 },
    ],
    comparison: null,
  };
}

export default function Page() {
  const qc = useQueryClient();
  const [ready] = useState(() => {
    for (const b of [null, 'b1']) {
      qc.setQueryData(qk.financeMonthlyDashboard(b ? { month: '2026-10', branchId: b } : { month: '2026-10' }), finance(b));
      qc.setQueryData(qk.salesAnalytics({ from: '2026-10-01', to: '2026-10-31', branchId: b, topLimit: 5, compare: false }), sales(b));
    }
    return true;
  });
  return ready ? <div className="w-full p-4 sm:p-6"><AdminDashboard /></div> : null;
}
