'use client';

import { useCachedLogo } from '@/lib/print/logoCache';
import {
  DAILY_SALE_STATUS_LABELS,
  DIFFERENCE_STATUS_LABELS,
  differenceStatus,
  karachiDateStr,
  karachiTimeStr,
  type AppSettings,
  type DailySaleRecordDetail,
} from '@mb/shared';
import { COMPANY_NAME } from '@/utils/constants';
import { exactMoney, money, orDash } from './parts';

/**
 * The printed Daily Sale Record (§22).
 *
 * Rendered inside a `PrintPortal`, so it is hidden on screen and portalled to
 * `<body>` — a print layout left inside a DialogContent is clipped to the
 * dialog's own box and comes out blank or as a sliver of the first page. See
 * PrintPortal for the full account.
 *
 * ─── This is an A4 document, not a receipt ───────────────────────────────────
 * It goes through `printDocument()` / `PrintButton`, not the POS path. A
 * reconciliation sheet is signed by two people and filed; an 80mm roll cannot
 * carry two signature blocks side by side, and `PRINTING.md` is explicit that the
 * two paths never silently fall back to one another.
 *
 * ─── Black on white, always ──────────────────────────────────────────────────
 * Fixed `bg-white text-black` rather than theme tokens. Browsers drop background
 * colours when printing, so a dark-theme sheet would print light grey text on
 * nothing; and this document is photocopied and filed, where contrast is the
 * whole job.
 */
export function DailySalePrintSheet({
  detail,
  settings,
}: {
  detail: DailySaleRecordDetail;
  settings: AppSettings | null;
}) {
  const { record, branch } = detail;
  const symbol = settings?.currencySymbol || 'Rs.';
  const logo = useCachedLogo(settings?.logoUrl);
  const generated = record.generatedAt ? new Date(record.generatedAt) : new Date();

  return (
    <div className="print-page mx-auto max-w-3xl bg-white p-8 text-black">
      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4 border-b-2 border-black pb-3">
        <div className="flex items-center gap-3">
          {logo && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logo} alt="" className="h-16 w-16 object-contain" />
          )}
          <div>
            <h1 className="text-xl font-bold leading-tight">{settings?.companyName || COMPANY_NAME}</h1>
            <p className="text-sm font-semibold">{branch.name}</p>
            {branch.address && (
              <p className="text-xs text-neutral-700">
                {branch.address}
                {branch.city ? `, ${branch.city}` : ''}
              </p>
            )}
            {branch.phone && <p className="text-xs text-neutral-700">{branch.phone}</p>}
          </div>
        </div>
        <div className="text-right text-xs">
          <p className="text-base font-bold uppercase tracking-wide">Daily Sale Record</p>
          <p className="mt-1">
            Business Date: <span className="font-semibold">{displayDate(record.businessDate)}</span>
          </p>
          <p>
            Generated: {karachiDateStr(generated)} {karachiTimeStr(generated)}
          </p>
          <p>
            Status: <span className="font-semibold">{DAILY_SALE_STATUS_LABELS[record.status]}</span>
          </p>
        </div>
      </div>

      {/* ── Auto sales ── */}
      <PrintSection title="System Sales">
        <PrintRow label="Total Sale" value={money(record.autoTotalSale, symbol)} strong />
        <PrintRow label="Cash" value={money(record.autoCash, symbol)} />
        <PrintRow label="Easypaisa" value={money(record.autoEasypaisa, symbol)} />
        <PrintRow label="Foodpanda" value={money(record.autoFoodpanda, symbol)} />
        <PrintRow label="Bank" value={money(record.autoBank, symbol)} />
        {record.autoOther > 0 && <PrintRow label="Other" value={money(record.autoOther, symbol)} />}
        <PrintRow label="Payment Total" value={money(record.paymentTotal, symbol)} strong />
        <PrintRow label="Discount (already deducted)" value={money(record.discount, symbol)} />
        <PrintRow label="Cash Expense" value={money(record.cashExpense, symbol)} />
        <PrintRow label="Cash on Table" value={money(record.expectedCashInHand, symbol)} strong />
        {record.autoStaff > 0 && (
          <PrintRow label="Staff consumption (no payment taken)" value={money(record.autoStaff, symbol)} />
        )}
        <PrintRow label="Orders" value={String(record.orderCount)} />
      </PrintSection>

      {/* ── Manual verification ── */}
      <PrintSection title="Counted / Received">
        <PrintRow label="Cash" value={orDash(record.manualCash, (v) => money(v, symbol))} />
        <PrintRow label="Easypaisa" value={orDash(record.manualEasypaisa, (v) => money(v, symbol))} />
        <PrintRow label="Bank" value={orDash(record.manualBank, (v) => money(v, symbol))} />
        {record.fedByName && (
          <PrintRow
            label="Counted by"
            value={`${record.fedByName}${record.fedAt ? ` · ${karachiDateStr(new Date(record.fedAt))} ${karachiTimeStr(new Date(record.fedAt))}` : ''}`}
          />
        )}
      </PrintSection>

      {/* ── Difference ── */}
      <PrintSection title="Difference">
        {/* Named on the sheet for the same reason it is named on screen — this is
            the copy that gets signed and filed, and it has to stand on its own. */}
        <PrintRow label="Cash (vs Cash on Table)" value={differenceText(record.cashDifference, symbol)} />
        <PrintRow label="Easypaisa" value={differenceText(record.easypaisaDifference, symbol)} />
        <PrintRow label="Bank" value={differenceText(record.bankDifference, symbol)} />
        <PrintRow label="Overall" value={differenceText(record.overallDifference, symbol)} strong />
      </PrintSection>

      {/* ── Signatures ──
          Two blocks, and the labels differ on purpose: the person who counted the
          money and the person who accepted the count must not be able to be read
          as the same signature. The name is printed where the system knows it, so
          the line is signed rather than filled in. */}
      <div className="avoid-break mt-10 grid grid-cols-2 gap-10 text-xs">
        <div>
          <div className="h-10 border-b border-black" />
          <p className="mt-1 font-semibold">Prepared By</p>
          <p className="text-neutral-700">{record.fedByName || ' '}</p>
        </div>
        <div>
          <div className="h-10 border-b border-black" />
          <p className="mt-1 font-semibold">Verified By</p>
          <p className="text-neutral-700">
            {record.verifiedByName ||
              record.lockedByName ||
              ' '}
          </p>
        </div>
      </div>

      <p className="mt-6 border-t pt-2 text-center text-[10px] text-neutral-600">
        This sheet reconciles recorded sales against physically received amounts. It does not
        alter any sale.
      </p>
    </div>
  );
}

/** 'DD-MM-YYYY'. String work — these are already Karachi dates. */
function displayDate(iso: string): string {
  const [y, m, d] = (iso || '').split('-');
  return y && m && d ? `${d}-${m}-${y}` : iso || '—';
}

/**
 * "- Rs. 500 (Short)". The word travels with the figure because a printed sheet
 * has no colour to lean on — the badge's amber and red do that work on screen,
 * and a photocopy has neither.
 */
function differenceText(difference: number | null, symbol: string): string {
  const state = differenceStatus(difference);
  if (state === 'uncounted') return '—';
  const sign = difference! > 0 ? '+' : '';
  return `${sign}${exactMoney(difference!, symbol)} (${DIFFERENCE_STATUS_LABELS[state]})`;
}

function PrintSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="avoid-break mt-5">
      <p className="border-b border-black pb-0.5 text-xs font-bold uppercase tracking-wide">{title}</p>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function PrintRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-0.5 text-sm">
      <span>{label}</span>
      <span className={`tabular-nums ${strong ? 'font-bold' : ''}`}>{value}</span>
    </div>
  );
}
