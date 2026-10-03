'use client';

import { useState } from 'react';
import {
  addDaysToDateStr,
  evalBackdatedDemand,
  evalCashLimit,
  evalCompanyShare,
  evalHourlySales,
  evalLedgerBackdate,
  evalLowSales,
  evalPendingDemand,
  evalProductionShortage,
  pickRestriction,
  restrictionDmy,
  type RequestState,
  type Restriction,
  type RestrictionRulesState,
} from '@mb/shared';
import { ConnectionRequiredNotice, RestrictionNotice } from '@/components/shared/RestrictionNotice';
import { cn } from '@/lib/utils';

/**
 * Admin Settings → Restriction Rules → Popup Preview.
 *
 * What a branch sees, for each situation, under the rules AS SAVED. The notice
 * is produced by the same evaluators the API runs and drawn by the same
 * component the real popups use — only the facts fed in (three sample demand
 * numbers, a sample stock figure) are made up, and they are labelled as such.
 */

const SAMPLE: Record<RequestState['status'], RequestState> = {
  pending: { id: 'sample', requestNo: 'REQ-000141', status: 'pending', approvalNo: null, adminReason: null },
  approved: { id: 'sample', requestNo: 'REQ-000141', status: 'approved', approvalNo: 'APR-000421', adminReason: null },
  rejected: { id: 'sample', requestNo: 'REQ-000137', status: 'rejected', approvalNo: 'APR-000414', adminReason: 'Already fulfilled from an earlier demand.' },
};

interface Scenario {
  key: string;
  popup: 'New Demand' | 'New Sale' | 'Cash Deposit' | 'Ledger Entry' | 'Income' | 'Production Demand';
  label: string;
  endpoint: string;
  submit: string;
  fields: (today: string) => [string, string][];
  /** null → the rule is switched off (or does not fire at these thresholds). */
  build: (s: RestrictionRulesState) => Restriction | null | 'offline';
}

const dmds = (n: number) => Array.from({ length: n }, (_, i) => `DMD-00220${i + 1}`);
const back = (s: RestrictionRulesState, days: number) => addDaysToDateStr(s.businessDate, -days);

const SCENARIOS: Scenario[] = [
  {
    key: 'demandWarn', popup: 'New Demand', label: 'Pending demands · warning', endpoint: '/api/production-orders', submit: 'Submit Order',
    fields: (t) => [['Branch', 'Gulberg'], ['Required date', t]],
    build: (s) => evalPendingDemand(s.rules.demand.pendingLimit, dmds(Math.max(s.rules.demand.pendingLimit.warnAt, 1))),
  },
  {
    key: 'demandBlock', popup: 'New Demand', label: 'Pending demands · blocked', endpoint: '/api/production-orders', submit: 'Submit Order',
    fields: (t) => [['Branch', 'Gulberg'], ['Required date', t]],
    build: (s) => evalPendingDemand(s.rules.demand.pendingLimit, dmds(s.rules.demand.pendingLimit.blockAt)),
  },
  ...(['none', 'pending', 'rejected', 'approved'] as const).map((st): Scenario => ({
    key: `bd-${st}`, popup: 'New Demand', endpoint: '/api/production-orders', submit: 'Submit Order',
    label: `Backdated · ${st === 'none' ? 'approval required' : st === 'pending' ? 'waiting for Admin' : st}`,
    fields: () => [['Branch', 'Gulberg'], ['Required date', '2 days ago']],
    build: (s) =>
      evalBackdatedDemand(s.rules.demand.backdated, {
        backdatedDate: back(s, 2), today: s.businessDate, request: st === 'none' ? null : SAMPLE[st],
      }),
  })),
  {
    key: 'lowSales', popup: 'New Demand', label: 'Low sales after closing', endpoint: '/api/production-orders', submit: 'Submit Order',
    fields: (t) => [['Branch', 'Bahria Town'], ['Required date', t]],
    build: (s) => {
      // A sample day that sold a little under three quarters of the minimum.
      const sold = Math.max(Math.floor(420 * s.rules.demand.lowSales.minSoldPercent * 0.0073), 0);
      return evalLowSales(s.rules.demand.lowSales, { afterClosing: true, applicableQty: 420, soldQty: sold });
    },
  },
  {
    key: 'salesNone', popup: 'New Sale', label: 'Hourly sales · none this hour', endpoint: '/api/restrictions/check/sale', submit: 'Save Sale',
    fields: () => [['Product', 'Chicken Patties ×6'], ['Total', 'Rs. 1,080']],
    build: (s) => evalHourlySales(s.rules.sales.hourly, { count: 0, hourLabel: '10:00–11:00' }),
  },
  {
    key: 'salesLow', popup: 'New Sale', label: 'Hourly sales · below required', endpoint: '/api/restrictions/check/sale', submit: 'Save Sale',
    fields: () => [['Product', 'Chicken Patties ×6'], ['Total', 'Rs. 1,080']],
    build: (s) => evalHourlySales(s.rules.sales.hourly, { count: Math.max(s.rules.sales.hourly.threshold - 1, 0), hourLabel: '10:00–11:00' }),
  },
  {
    key: 'production', popup: 'Production Demand', label: 'Stock shortage', endpoint: '/api/production-orders/:id/review', submit: 'Submit for Verification',
    fields: () => [['Branch', 'Gulberg'], ['Demand', 'DMD-002226']],
    build: (s) =>
      s.rules.production.stockShortage.enabled
        ? evalProductionShortage([
            { productName: 'Cream Puff', requested: 100, available: 70, shortage: 30 },
            { productName: 'Chocolate Balls', requested: 40, available: 25, shortage: 15 },
          ])
        : null,
  },
  {
    key: 'cash', popup: 'Cash Deposit', label: 'Daily limit reached', endpoint: '/api/cash-transfers', submit: 'Save',
    fields: () => [['Branch', 'DHA Phase 5'], ['Amount', 'Rs. 42,000']],
    build: (s) =>
      evalCashLimit(s.rules.cash.dailyLimit, {
        transferNos: Array.from({ length: s.rules.cash.dailyLimit.limit }, (_, i) => `CT-00017${i + 1}`),
        businessDate: s.businessDate, today: s.businessDate, request: null,
      }),
  },
  ...(['none', 'rejected'] as const).map((st): Scenario => ({
    key: `ledger-${st}`, popup: 'Ledger Entry', endpoint: '/api/finance/income/entries', submit: 'Submit for approval',
    label: `Backdated · ${st === 'none' ? 'approval required' : 'rejected'}`,
    fields: (t) => [['Type', 'Expense · Utilities'], ['Entry date', `${t} − 4 days over the limit`]],
    build: (s) =>
      evalLedgerBackdate(s.rules.ledger.backdate, {
        entryDate: back(s, s.rules.ledger.backdate.allowedDays + 4), today: s.businessDate,
        request: st === 'none' ? null : { ...SAMPLE.rejected, adminReason: 'No receipt attached. Resubmit with the vendor invoice.' },
      }),
  })),
  ...(['none', 'approved'] as const).map((st): Scenario => ({
    key: `co-${st}`, popup: 'Income', endpoint: '/api/finance/income/entries', submit: 'Submit for approval',
    label: `Company Share · ${st === 'none' ? 'approval required' : 'approved'}`,
    fields: () => [['Category', 'Company Share'], ['Amount', 'Rs. 125,000']],
    build: (s) => evalCompanyShare(s.rules.company.shareIncome, { isCompanyShare: true, request: st === 'none' ? null : SAMPLE.approved }),
  })),
  {
    key: 'offline', popup: 'New Demand', label: 'Offline · verification required', endpoint: '/api/production-orders', submit: 'Submit Order',
    fields: (t) => [['Branch', 'Gulberg'], ['Required date', t]],
    build: () => 'offline',
  },
];

export function PreviewTab({ state }: { state: RestrictionRulesState }) {
  const [key, setKey] = useState('demandBlock');
  const scenario = SCENARIOS.find((s) => s.key === key) ?? SCENARIOS[0]!;
  const built = scenario.build(state);
  const offline = built === 'offline';
  const restriction = offline ? null : built;
  const check = pickRestriction([restriction]);
  const today = restrictionDmy(state.businessDate);

  const json = offline
    ? '// No response — the request is not sent.\n// The device is offline; cached restriction data is not used.'
    : JSON.stringify(check, null, 2);
  const submitDisabled = offline || !check.allowed;

  return (
    <div className="grid grid-cols-1 items-start gap-[18px] md:grid-cols-[minmax(220px,260px)_minmax(0,1fr)]">
      <div className="flex flex-col gap-0.5 rounded-xl border bg-card p-2">
        {SCENARIOS.map((s) => (
          <button
            key={s.key}
            type="button"
            aria-pressed={s.key === scenario.key}
            onClick={() => setKey(s.key)}
            className={cn(
              'flex flex-col gap-0.5 rounded-lg px-2.5 py-2 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
              s.key === scenario.key ? 'bg-accent' : 'hover:bg-muted/60',
            )}
          >
            <span className="text-[10.5px] font-semibold text-muted-foreground">{s.popup}</span>
            <span className="text-[12.5px] font-semibold">{s.label}</span>
          </button>
        ))}
      </div>

      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex justify-center rounded-[14px] bg-muted px-5 py-8">
          <div className="w-full max-w-[440px] overflow-hidden rounded-[14px] bg-card shadow-xl">
            <div className="flex items-center justify-between border-b px-[18px] py-3.5">
              <span className="text-[15px] font-bold">{scenario.popup}</span>
              <span aria-hidden className="text-lg leading-none text-muted-foreground">×</span>
            </div>
            <div className="flex flex-col gap-3.5 px-[18px] py-4">
              <div className="grid grid-cols-2 gap-2.5">
                {scenario.fields(today).map(([k, v]) => (
                  <div key={k} className="flex flex-col gap-1">
                    <span className="text-[11px] font-semibold text-foreground/80">{k}</span>
                    <div className="flex min-h-8 items-center rounded-md border bg-muted/40 px-2.5 py-1 text-[12.5px]">{v}</div>
                  </div>
                ))}
              </div>
              {offline ? (
                <ConnectionRequiredNotice />
              ) : restriction ? (
                <RestrictionNotice restriction={restriction} />
              ) : (
                <p className="rounded-lg border border-dashed px-3 py-4 text-center text-muted-foreground">
                  Nothing is shown: this rule is switched off, or does not fire at the saved thresholds.
                </p>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t px-[18px] py-3">
              <span className="flex h-9 items-center rounded-lg border px-4 font-semibold text-foreground/80">
                {submitDisabled ? 'Close' : 'Cancel'}
              </span>
              <span
                className={cn(
                  'flex h-9 items-center rounded-lg px-4 font-semibold',
                  submitDisabled ? 'bg-muted text-muted-foreground line-through decoration-1' : 'bg-primary text-primary-foreground',
                )}
              >
                {scenario.submit}
              </span>
            </div>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Sample branch names, numbers and figures. The wording and thresholds are the saved rules; the notice is the one
          the popup renders.
        </p>

        <div className="flex flex-col gap-2 rounded-xl bg-secondary px-4 py-3.5">
          <span className="text-[11px] font-semibold text-secondary-foreground/70">
            Server response · {scenario.endpoint}
            {!offline && !check.allowed ? ' · 409, in details' : ''}
          </span>
          <pre className="font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-secondary-foreground [overflow-wrap:anywhere]">{json}</pre>
        </div>
      </div>
    </div>
  );
}
