import { DailySaleRecordPage } from '@/components/daily-sale/DailySaleRecordPage';

/**
 * Admin → Daily Sale Records. The same board as the branch's own screen, over
 * every branch, plus the actions only an admin has: lock, unlock, amend, and the
 * per-branch manual-entry lock configuration.
 *
 * Its own route rather than a query parameter on '/branch-daily-sale' because
 * RouteGuard maps every '/branch-' prefix to the branch roles and would bounce a
 * super admin to their own home page — see ROUTES.DAILY_SALE_RECORDS.
 */
export default function Page() {
  return (
    <div className="p-4 sm:p-6">
      <DailySaleRecordPage admin />
    </div>
  );
}
