'use client';

import { useEffect, useState } from 'react';
import { Loader2, ShieldAlert } from 'lucide-react';
import {
  DAILY_SALE_AUDIT_LABELS,
  DAILY_SALE_FIELD_LABELS,
  karachiDateStr,
  karachiTimeStr,
  type AppSettings,
  type DailySaleAudit,
  type DailySaleAmendField,
  type DailySaleRecordDetail,
} from '@mb/shared';
import { useDailySaleRecord } from '@/lib/queries';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PrintButton } from '@/components/shared/PrintButton';
import { PrintPortal } from '@/components/shared/PrintPortal';
import { PAYMENT_METHOD_LABELS } from '@/utils/constants';
import { printDocument } from '@/lib/print/browser/documentPrint';
import { DailySalePrintSheet } from './DailySalePrintSheet';
import { DifferenceBadge, Row, Section, StatusBadge, exactMoney, money, orDash } from './parts';

/**
 * View a Daily Sale Record in full (§21), with its history (§17) and the Print
 * action (§22).
 *
 * ─── One dialog, two tabs, one fetch ─────────────────────────────────────────
 * The record and its audit trail arrive from the same endpoint, so History is a
 * tab rather than a second popup with a second request. §20 lists View and
 * History as separate actions and they still are — the table opens this dialog on
 * the tab the action names.
 *
 * ─── It fetches rather than taking the row ───────────────────────────────────
 * The table's cached list deliberately carries no audit history and no branch
 * address, so building this from the row it was opened on would show an empty
 * history and a headerless print sheet. `useDailySaleRecord` is gated on the id,
 * so nothing is requested until a row is actually opened.
 */
export function DailySaleViewDialog({
  open,
  onOpenChange,
  recordId,
  token,
  settings,
  initialTab = 'summary',
  autoPrint = false,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  recordId: string | null;
  token: string;
  settings: AppSettings | null;
  initialTab?: 'summary' | 'history';
  /**
   * Open the browser print dialog as soon as the record has loaded.
   *
   * This is what makes the table's Print action a print rather than a two-step
   * "open, then find the button": the sheet cannot be printed before its data
   * arrives, so the trigger has to wait for the fetch. The dialog still opens
   * behind it, which is deliberate — a cancelled print leaves the reader looking
   * at the record they meant to print.
   */
  autoPrint?: boolean;
}) {
  const { data, isLoading } = useDailySaleRecord(token, open ? recordId : null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton
        mobile="fullscreen"
        className="flex flex-col gap-0 overflow-hidden p-0 md:max-h-[92vh] md:w-[92vw] md:max-w-2xl md:rounded-2xl"
      >
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle>Daily Sale Record</DialogTitle>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {isLoading && (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          )}
          {!isLoading && !data && (
            <p className="py-12 text-center text-sm text-muted-foreground">
              This record could not be loaded.
            </p>
          )}
          {data && (
            <ViewBody
              key={data.record.id ?? ''}
              detail={data}
              settings={settings}
              initialTab={initialTab}
              autoPrint={autoPrint}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ViewBody({
  detail,
  settings,
  initialTab,
  autoPrint,
}: {
  detail: DailySaleRecordDetail;
  settings: AppSettings | null;
  initialTab: 'summary' | 'history';
  autoPrint: boolean;
}) {
  const [tab, setTab] = useState<string>(initialTab);

  // Fires once per mounted record: `ViewBody` is keyed on the record id and only
  // rendered once the fetch has resolved, so "when the data is ready" and "when
  // this component mounts" are the same moment. A frame is allowed to pass first
  // so the PrintPortal below has actually attached to <body> — printing before it
  // does would produce a blank sheet, for exactly the reason PrintPortal exists.
  useEffect(() => {
    if (!autoPrint) return;
    const id = requestAnimationFrame(() => printDocument());
    return () => cancelAnimationFrame(id);
  }, [autoPrint]);

  const { record, branch, audits } = detail;
  const symbol = settings?.currencySymbol || 'Rs.';
  const generated = record.generatedAt ? new Date(record.generatedAt) : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-semibold">{branch.name}</p>
          <p className="text-xs text-muted-foreground">
            Business date {displayDate(record.businessDate)}
            {generated && ` · generated ${karachiDateStr(generated)} ${karachiTimeStr(generated)}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={record.status} />
          {/* The document print path — never the POS one. A reconciliation sheet
              is signed by two people and filed; see DailySalePrintSheet. */}
          <PrintButton
            onPrint={() => printDocument()}
            printLabel="Print"
            saveLabel="Save PDF"
            size="sm"
            variant="outline"
            showMenu={false}
          />
        </div>
      </div>

      {/* A breakdown whose rows do not sum to its own heading is worse than one
          with a row missing, so the mismatch is stated rather than left to be
          spotted. It should never fire — `payment_total` is the four buckets
          re-added — which is exactly why it is worth saying when it does. */}
      {Math.abs(record.paymentTotal - record.autoTotalSale) > 0.01 && (
        <p className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          The payment breakdown ({money(record.paymentTotal, symbol)}) does not match the total
          sale ({money(record.autoTotalSale, symbol)}). Raise this on the Help Desk before
          signing the day off.
        </p>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="summary">Summary</TabsTrigger>
          <TabsTrigger value="history">History ({audits.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="summary" className="space-y-5 pt-4">
          <Section title="System Sales">
            <Row label="Total Sale" value={money(record.autoTotalSale, symbol)} strong />
            <Row label="Cash" value={money(record.autoCash, symbol)} />
            <Row label="Easypaisa" value={money(record.autoEasypaisa, symbol)} />
            <Row label="Foodpanda" value={money(record.autoFoodpanda, symbol)} />
            <Row label="Bank" value={money(record.autoBank, symbol)} />
            {record.autoOther > 0 && <Row label="Other" value={money(record.autoOther, symbol)} />}
            <Row label="Discount" value={money(record.discount, symbol)} muted />
            <Row label="Cash Expense" value={money(record.cashExpense, symbol)} muted />
            <Row label="Expected Cash in Hand" value={money(record.expectedCashInHand, symbol)} strong />
            {record.autoStaff > 0 && (
              <Row label="Staff consumption (unpaid)" value={money(record.autoStaff, symbol)} muted />
            )}
            <Row label="Orders" value={String(record.orderCount)} muted />
          </Section>

          <Section title="Counted / Received">
            <Row label="Cash" value={orDash(record.manualCash, (v) => money(v, symbol))} />
            <Row label="Easypaisa" value={orDash(record.manualEasypaisa, (v) => money(v, symbol))} />
            <Row label="Bank" value={orDash(record.manualBank, (v) => money(v, symbol))} />
            {/* Foodpanda has no counted row, and its absence is explained rather
                than left looking like an omission. */}
            <p className="pt-1 text-xs text-muted-foreground">
              Foodpanda is settled by the aggregator and is not counted at the shop.
            </p>
          </Section>

          <Section title="Difference">
            <DiffRow label="Cash" value={record.cashDifference} symbol={symbol} />
            <DiffRow label="Easypaisa" value={record.easypaisaDifference} symbol={symbol} />
            <DiffRow label="Bank" value={record.bankDifference} symbol={symbol} />
            <DiffRow label="Overall" value={record.overallDifference} symbol={symbol} strong />
          </Section>

          <Section title="Sign-off">
            <Row
              label="Counted by"
              value={record.fedByName ? `${record.fedByName}${record.fedAt ? ` · ${stamp(record.fedAt)}` : ''}` : '—'}
            />
            <Row
              label="Verified by"
              value={record.verifiedByName ? `${record.verifiedByName}${record.verifiedAt ? ` · ${stamp(record.verifiedAt)}` : ''}` : '—'}
            />
            <Row
              label="Locked by"
              value={record.lockedByName ? `${record.lockedByName}${record.lockedAt ? ` · ${stamp(record.lockedAt)}` : ''}` : '—'}
            />
            {record.amendedAt && <Row label="Last amended" value={stamp(record.amendedAt)} />}
          </Section>
        </TabsContent>

        <TabsContent value="history" className="pt-4">
          <HistoryList audits={audits} symbol={symbol} />
        </TabsContent>
      </Tabs>

      {/* Rendered whichever tab is open: the Print button is in the header, and a
          sheet that only existed while the Summary tab was selected would print
          blank from History. */}
      <PrintPortal>
        <DailySalePrintSheet detail={detail} settings={settings} />
      </PrintPortal>
    </div>
  );
}

function DiffRow({
  label,
  value,
  symbol,
  strong,
}: {
  label: string;
  value: number | null;
  symbol: string;
  strong?: boolean;
}) {
  return (
    <Row
      label={label}
      strong={strong}
      value={<DifferenceBadge difference={value} symbol={symbol} />}
    />
  );
}

/**
 * The audit trail (§17).
 *
 * Newest first, and every entry states who, when, and — where a figure moved —
 * what it moved from and to. An entry with no old value reads "set to X" rather
 * than "— → X": the arrow implies a previous figure, and the first count had none.
 */
function HistoryList({ audits, symbol }: { audits: DailySaleAudit[]; symbol: string }) {
  if (audits.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">Nothing has happened to this record yet.</p>;
  }

  return (
    <ol className="space-y-3">
      {audits.map((a) => (
        <li key={a.id} className="border-b pb-3 last:border-0 last:pb-0">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm font-medium">
              {DAILY_SALE_AUDIT_LABELS[a.action] ?? a.action}
              {a.action === 'manual_feed_override' && (
                <ShieldAlert className="ml-1 inline h-3.5 w-3.5 text-amber-600" />
              )}
            </p>
            <p className="text-xs text-muted-foreground">{stamp(a.createdAt)}</p>
          </div>
          <p className="text-xs text-muted-foreground">
            {a.actorName || 'System'}
            {a.actorRole ? ` · ${a.actorRole.replace(/_/g, ' ')}` : ''}
          </p>
          {a.field && <p className="mt-1 text-xs">{describeChange(a, symbol)}</p>}
          {a.reason && <p className="mt-1 text-xs italic text-muted-foreground">“{a.reason}”</p>}
        </li>
      ))}
    </ol>
  );
}

/**
 * One history entry's change, in words.
 *
 * Three shapes reach this, and each needs its own reading — a single generic
 * "field: old → new" renders the lock entries as "cash: false → true", which is
 * a row nobody can act on:
 *
 *   money  — a counted figure, or the auto total on a refresh. Formatted as
 *            currency, and keeping its paisa: a 50-paisa correction is exactly
 *            what somebody reading this is hunting for.
 *   status — a workflow move. 'pending_verification' → 'pending verification'.
 *   lock   — a payment method's lock state, where the values are booleans and
 *            the field is the method. Read as "Cash: unlocked → locked", and an
 *            absent old value reads "on the default" rather than as a blank.
 */
function describeChange(a: DailySaleAudit, symbol: string): string {
  const field = a.field ?? '';

  if (a.action === 'method_locked' || a.action === 'method_unlocked') {
    const method = PAYMENT_METHOD_LABELS[field] ?? field;
    const before = a.oldValue === null ? 'on the default' : lockWord(a.oldValue);
    return `${method}: ${before} → ${lockWord(a.newValue)}`;
  }

  const isMoney = field.startsWith('manual_') || field.startsWith('auto_');
  const label = isMoney
    ? DAILY_SALE_FIELD_LABELS[field as DailySaleAmendField] ?? 'Total Sale'
    : field === 'status'
      ? 'Status'
      : field;

  const fmt = (v: string | null): string | null => {
    if (v === null || v === '') return null;
    if (!isMoney) return v.replace(/_/g, ' ');
    const n = Number(v);
    return Number.isFinite(n) ? exactMoney(n, symbol) : v;
  };

  const before = fmt(a.oldValue);
  const after = fmt(a.newValue);

  if (before === null && after === null) return label;
  // No arrow from nothing: an arrow implies a previous figure, and a first count
  // had none.
  if (before === null) return `${label}: set to ${after}`;
  return `${label}: ${before} → ${after}`;
}

function lockWord(value: string | null): string {
  return value === 'true' ? 'locked' : 'unlocked';
}

/** 'DD MMM YYYY, hh:mm' in Karachi. Not date-fns: these read in the shop's clock. */
function stamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${karachiDateStr(d)} ${karachiTimeStr(d)}`;
}

function displayDate(iso: string): string {
  const [y, m, d] = (iso || '').split('-');
  return y && m && d ? `${d}-${m}-${y}` : iso || '—';
}
