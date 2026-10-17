'use client';

import { useMemo, useState } from 'react';
import { businessDateStr, type AppSettings, type BranchProductionOrder } from '@mb/shared';
import { useProducts } from '@/lib/queries';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { PrintPortal } from '@/components/shared/PrintPortal';
import { useDocumentPrint } from '@/hooks/useDocumentPrint';
import { useCachedLogo } from '@/lib/print/logoCache';
import {
  demandSummaryDocument,
  printDemandSummary,
  PosPrintError,
  type DemandSummaryDoc,
} from '@/lib/print';
import { buildDemandSummarySnapshot, demandStatusText, type DemandSummarySnapshot } from '@/utils/demandSummaryReport';
import { formatDate, formatTime } from '@/utils/date';
import { COMPANY_NAME } from '@/utils/constants';
import { Loader2, Printer } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

type Format = '80mm' | '58mm' | 'a4';

const FORMATS: { value: Format; label: string }[] = [
  { value: '80mm', label: 'POS 80mm' },
  { value: '58mm', label: 'POS 58mm' },
  { value: 'a4', label: 'A4 Report' },
];

export interface DemandSummaryPrintModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Every waiting order's worth of demand — the same `orders` the card on the page is built from. */
  orders: BranchProductionOrder[];
  /**
   * Today's production stock per product — the same map the Demand Summary
   * card's "Today's Stock" / "Balance Stock" columns read (`poolFor` in
   * ProductionOrdersPage). Passed in rather than re-fetched, so printing never
   * issues a second request for a figure the page already has.
   */
  stockByProduct: Map<string, number>;
  stockLoaded: boolean;
  settings: AppSettings | null;
  token: string;
}

/**
 * Print-settings dialog for the production-wide Demand Summary — a snapshot
 * document, never a per-order one. Picking a format re-renders the SAME
 * preview that would be sent to the printer; printing never mutates an order,
 * its status, or stock — see `buildDemandSummarySnapshot`.
 */
export function DemandSummaryPrintModal({ open, onOpenChange, orders, stockByProduct, stockLoaded, settings, token }: DemandSummaryPrintModalProps) {
  const [format, setFormat] = useState<Format>('80mm');
  const [posPrinting, setPosPrinting] = useState(false);
  const productsQ = useProducts(token, { enabled: open });
  const logo = useCachedLogo(settings?.logoUrl);
  const { printing: a4Printing, print: printA4 } = useDocumentPrint();

  const companyName = settings?.companyName?.trim() || COMPANY_NAME;
  const sym = settings?.currencySymbol || 'Rs.';

  const snapshot = useMemo(
    () => buildDemandSummarySnapshot(orders, productsQ.data ?? [], stockByProduct, stockLoaded),
    [orders, productsQ.data, stockByProduct, stockLoaded],
  );

  // Reset whenever the dialog TRANSITIONS to open — "adjusting state during
  // render" rather than an effect, so "Printed" reads the moment it opened
  // without an extra render lagging behind it.
  const [now, setNow] = useState(() => new Date());
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setNow(new Date());
  }

  const doc: DemandSummaryDoc = useMemo(
    () => ({
      businessDateText: formatDate(businessDateStr()),
      printDateText: formatDate(now),
      printTimeText: formatTime(now),
      statusText: demandStatusText(snapshot),
      companyName,
      currencySymbol: sym,
      items: snapshot.products.map((p) => ({ productName: p.productName, qty: p.qty })),
      packingItems: snapshot.packing.map((p) => ({ materialName: p.materialName, qty: p.qty })),
      branchItems: snapshot.branches.map((b) => ({ branchName: b.branchName, qty: b.qty, amount: b.amount })),
      totals: snapshot.totals,
      logo,
    }),
    [snapshot, companyName, sym, logo, now],
  );

  const hasData = snapshot.products.length > 0 || snapshot.packing.length > 0;
  const loadingPrices = productsQ.isLoading;

  async function handlePrint() {
    if (!hasData) return;
    if (format === 'a4') {
      printA4();
      return;
    }
    setPosPrinting(true);
    try {
      await printDemandSummary(doc, { paper: format });
      toast.success('Printed successfully');
      onOpenChange(false);
    } catch (error) {
      const message = error instanceof PosPrintError
        ? error.message
        : 'Printing failed. Check the printer is switched on and set as the default printer on this computer.';
      toast.error('Printing failed', { description: message });
    } finally {
      setPosPrinting(false);
    }
  }

  const posHtml = format !== 'a4' ? demandSummaryDocument(doc, format).html : null;
  const paperWidthMm = format === '58mm' ? 58 : 80;

  return (
    <Dialog open={open} onOpenChange={(o) => !posPrinting && onOpenChange(o)}>
      <DialogContent
        showCloseButton
        mobile="fullscreen"
        className="flex max-h-[92dvh] flex-col gap-0 overflow-hidden p-0 md:w-[90vw] md:max-w-[90vw] md:rounded-2xl lg:w-[760px] lg:max-w-[760px]"
      >
        <DialogHeader className="shrink-0 border-b px-4 py-3">
          <DialogTitle>Print Production Demand Summary</DialogTitle>
          <DialogDescription>
            Every waiting order&apos;s demand, consolidated by product, packing material, and branch.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {/* Format picker */}
          <div className="flex flex-wrap gap-2">
            {FORMATS.map((f) => (
              <Button
                key={f.value}
                type="button"
                size="sm"
                variant={format === f.value ? 'default' : 'outline'}
                onClick={() => setFormat(f.value)}
              >
                {f.label}
              </Button>
            ))}
          </div>

          {!hasData ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No waiting demands right now — there is nothing to print.
            </p>
          ) : loadingPrices ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              {/* Preview */}
              {format === 'a4' ? (
                <div className="mx-auto max-w-full overflow-x-auto rounded-md border bg-muted/30 p-2 sm:p-4">
                  <div className="mx-auto w-full max-w-[680px] rounded bg-white p-6 text-black shadow-sm">
                    <DemandSummaryA4Sheet doc={doc} snapshot={snapshot} />
                  </div>
                </div>
              ) : (
                <div className="flex justify-center overflow-x-auto rounded-md border bg-muted/30 p-3">
                  {posHtml && (
                    <iframe
                      title="Demand summary preview"
                      srcDoc={posHtml}
                      className="rounded border bg-white shadow-sm"
                      style={{ width: `${paperWidthMm}mm`, minHeight: 420, maxHeight: '60dvh' }}
                    />
                  )}
                </div>
              )}

              {snapshot.totals.grandAmount === null && (
                <p className="text-xs text-amber-600">
                  Some demand could not be reliably priced, so branch and grand amounts show as &quot;Amount unavailable&quot;
                  instead of an incomplete total.
                </p>
              )}
            </>
          )}
        </div>

        <DialogFooter className="shrink-0 border-t px-4 py-3">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={posPrinting}>
            Cancel
          </Button>
          <Button onClick={handlePrint} disabled={!hasData || loadingPrices || posPrinting || a4Printing}>
            {posPrinting || a4Printing ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Printer className="mr-1.5 h-4 w-4" />
            )}
            Print
          </Button>
        </DialogFooter>

        {/* Print-only A4 DOM — portalled to <body> and mounted only while printing,
            same pattern as every other browser-printed document in this app. */}
        <PrintPortal active={a4Printing}>
          <div className="print-page">
            <DemandSummaryA4Sheet doc={doc} snapshot={snapshot} />
          </div>
        </PrintPortal>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The A4 report body — header, the consolidated product demand table (today's
 * stock, total demand and balance stock, plus one column per branch — the
 * same figures and columns as the on-screen Demand Summary card), the Total
 * Stock / Total Demand / Balance Stock summary, packing material requirements,
 * and the branch-wise quantity/amount summary with its grand total.
 *
 * Used both for the on-screen preview (scaled down by its container) and for
 * the actual print (full size, inside `PrintPortal`).
 */
function DemandSummaryA4Sheet({ doc, snapshot }: { doc: DemandSummaryDoc; snapshot: DemandSummarySnapshot }) {
  const sym = doc.currencySymbol;
  const money = (n: number) => `${sym} ${Math.round(n).toLocaleString()}`;
  const branches = snapshot.branchNames;
  /** Negative is a real shortfall, never zeroed — just styled to stand out. */
  const neg = (n: number) => (n < 0 ? 'font-semibold text-red-700' : '');

  return (
    <div className="space-y-5 text-sm">
      <div className="border-b border-neutral-300 pb-3 text-center">
        {doc.logo && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={doc.logo} alt="logo" className="mx-auto mb-1 h-14 w-14 object-contain" />
        )}
        <h2 className="text-xl font-bold">{doc.companyName}</h2>
        <p className="text-xs font-medium text-neutral-600">Production Department</p>
        <p className="mt-1 text-base font-semibold uppercase tracking-wide">Production Demand Summary</p>
        <div className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-0.5 text-[11px] text-neutral-600">
          <span>Business Date: <span className="font-medium text-neutral-900">{doc.businessDateText}</span></span>
          <span>Printed: <span className="font-medium text-neutral-900">{doc.printDateText} {doc.printTimeText}</span></span>
        </div>
        {doc.statusText && <p className="mt-1 text-[11px] text-neutral-500">{doc.statusText}</p>}
      </div>

      <section className="avoid-break">
        <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-500">Product Demand</h3>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-neutral-300 text-left">
                <th className="py-1.5 pr-2 font-semibold">Product Name</th>
                <th className="py-1.5 text-right font-semibold">Today&apos;s Stock</th>
                <th className="py-1.5 text-right font-semibold">Total Demand</th>
                <th className="py-1.5 pr-3 text-right font-semibold">Balance Stock</th>
                {branches.map((b) => (
                  <th key={b} className="py-1.5 pl-3 text-right font-semibold">{b}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {snapshot.products.length === 0 ? (
                <tr><td colSpan={4 + branches.length} className="py-3 text-center text-neutral-400">No waiting demand.</td></tr>
              ) : snapshot.products.map((row) => (
                <tr key={row.productId} className="border-b border-neutral-200">
                  <td className="py-1 pr-2">{row.productName}</td>
                  <td className="py-1 text-right tabular-nums">{row.stock === null ? '—' : row.stock.toLocaleString()}</td>
                  <td className="py-1 text-right font-medium tabular-nums">{row.qty.toLocaleString()}</td>
                  <td className={cn('py-1 pr-3 text-right tabular-nums', row.balance !== null && neg(row.balance))}>
                    {row.balance === null ? '—' : row.balance.toLocaleString()}
                  </td>
                  {branches.map((b) => (
                    <td key={b} className="py-1 pl-3 text-right tabular-nums text-neutral-500">{(row.byBranch[b] ?? 0).toLocaleString()}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="avoid-break grid grid-cols-3 gap-x-6 gap-y-1 rounded-md bg-neutral-50 p-3 text-[13px]">
        <div><span className="text-neutral-500">Total Stock</span><p className="font-bold tabular-nums">{snapshot.totals.totalStock === null ? '—' : snapshot.totals.totalStock.toLocaleString()}</p></div>
        <div><span className="text-neutral-500">Total Demand</span><p className="font-bold tabular-nums">{snapshot.totals.totalProductQty.toLocaleString()}</p></div>
        <div>
          <span className="text-neutral-500">Balance Stock</span>
          <p className={cn('font-bold tabular-nums', snapshot.totals.balanceStock !== null && neg(snapshot.totals.balanceStock))}>
            {snapshot.totals.balanceStock === null ? '—' : snapshot.totals.balanceStock.toLocaleString()}
          </p>
        </div>
      </section>

      {snapshot.packing.length > 0 && (
        <section className="avoid-break">
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-500">Packing Material Demand</h3>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-neutral-300 text-left">
                  <th className="py-1.5 pr-3 font-semibold">Packing Material</th>
                  <th className="py-1.5 pr-3 text-right font-semibold">Total Quantity</th>
                  {branches.map((b) => (
                    <th key={b} className="py-1.5 pl-3 text-right font-semibold">{b}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {snapshot.packing.map((row) => (
                  <tr key={row.packingMaterialId} className="border-b border-neutral-200">
                    <td className="py-1 pr-3">{row.materialName}</td>
                    <td className="py-1 pr-3 text-right font-medium tabular-nums">{row.qty.toLocaleString()}</td>
                    {branches.map((b) => (
                      <td key={b} className="py-1 pl-3 text-right tabular-nums text-neutral-500">{(row.byBranch[b] ?? 0).toLocaleString()}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="avoid-break">
        <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-500">Branch-wise Demand Summary</h3>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-neutral-300 text-left">
              <th className="py-1.5 font-semibold">Branch Name</th>
              <th className="py-1.5 text-right font-semibold">Total Product Qty</th>
              <th className="py-1.5 text-right font-semibold">Total Amount</th>
            </tr>
          </thead>
          <tbody>
            {doc.branchItems.map((row) => (
              <tr key={row.branchName} className="border-b border-neutral-200">
                <td className="py-1 pr-2">{row.branchName}</td>
                <td className="py-1 text-right tabular-nums">{row.qty.toLocaleString()}</td>
                <td className={cn('py-1 text-right tabular-nums', row.amount === null && 'text-neutral-400')}>
                  {row.amount === null ? 'Amount unavailable' : money(row.amount)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-neutral-400 font-semibold">
              <td className="py-1.5">Grand Total</td>
              <td className="py-1.5 text-right tabular-nums">{doc.totals.totalProductQty.toLocaleString()}</td>
              <td className="py-1.5 text-right tabular-nums">
                {doc.totals.grandAmount === null ? 'Amount unavailable' : money(doc.totals.grandAmount)}
              </td>
            </tr>
          </tfoot>
        </table>
      </section>

      <p className="pt-2 text-center text-[10px] text-neutral-400">
        * Design &amp; developed by arifsiksavi@gmail.com | 0322-2050545 *
      </p>
    </div>
  );
}
