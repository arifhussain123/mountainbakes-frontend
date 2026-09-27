'use client';

import { LoginHistoryCard } from '@/components/dashboard/LoginHistoryCard';
import { FinanceMonthlyDashboard } from './dashboard/FinanceMonthlyDashboard';

/**
 * The Finance Dashboard route body — the monthly finance control centre
 * (dashboard/FinanceMonthlyDashboard.tsx), followed by the sign-in history
 * card finance users already had here.
 */
export function FinanceDashboardPage() {
  return (
    <div className="space-y-6">
      <FinanceMonthlyDashboard />
      <div className="print:hidden">
        <LoginHistoryCard />
      </div>
    </div>
  );
}
