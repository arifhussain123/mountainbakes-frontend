'use client';

import type { PaperMode } from '@/hooks/usePrintCapability';
import { applyPrintPaper, resetPrintPaper } from '@/lib/printPaper';
import { printTrace } from '@/lib/print/diagnostics';

/**
 * Browser printing — the A4 documents, and the explicit fallback.
 *
 * ---------------------------------------------------------------------------
 * This path is kept, and it is not the POS path
 * ---------------------------------------------------------------------------
 * A delivery challan, a monthly report and a production check sheet are genuinely
 * documents on sheets: they want a page box, pagination and a destination picker,
 * and `window.print()` is the right tool for all three. Receipts are not, and go
 * through `lib/print/pos/printerService.ts` instead, which never opens a dialog.
 *
 * Keeping both is deliberate. What is *not* allowed is one silently becoming the
 * other: a failed POS print must never quietly open the browser dialog, because
 * the person at the counter asked for a receipt and would get a preview of an A4
 * sheet with no explanation. Where a browser print is offered after a POS
 * failure it is offered as a labelled button someone chooses to press.
 *
 * ---------------------------------------------------------------------------
 * The bug this function exists to stop recurring
 * ---------------------------------------------------------------------------
 * `globals.css` declares a global `@page { size: A4; margin: 12mm }`. On a device
 * pinned to POS paper that page box is handed to an 80mm roll driver, which has
 * no such geometry, and Chrome answers by failing to generate a preview at all —
 * the reported **"Print preview failed"**. `applyPrintPaper('pos')` injects the
 * `@page { size: auto }` that releases it.
 *
 * Every browser print in the app now goes through here, so the paper switch
 * cannot be forgotten at a call site the way it was on the sales invoice. It also
 * guarantees the reset: the injected rule is GLOBAL while it is mounted, so a
 * print left uncleaned would put the next report from any screen onto an 80mm
 * page box.
 */

export interface PrintDocumentOptions {
  /** Which page box to print against. Comes from `usePaperCapability`. */
  paper?: PaperMode;
  /** Runs once the dialog has been dismissed, printed or cancelled. */
  onAfterPrint?: () => void;
}

/**
 * Resolve once the print DOM is laid out and its images are decoded.
 *
 * Two animation frames cover the commit and the layout of a portal that has
 * just mounted; the image wait covers the logo, which the preview would
 * otherwise stall on. Capped, because a print must not be held hostage by an
 * image that never arrives — the preview simply prints without it.
 */
export function whenPrintAreaReady(maxWaitMs = 1_500): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  return new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    const cap = window.setTimeout(finish, maxWaitMs);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const images = Array.from(document.querySelectorAll<HTMLImageElement>('.print-area img'));
        printTrace('print DOM laid out', { images: images.length, pending: images.filter((img) => !img.complete).length });
        const decodes = images
          .filter((img) => !img.complete)
          .map((img) => (typeof img.decode === 'function' ? img.decode().catch(() => undefined) : Promise.resolve()));
        void Promise.all(decodes).then(() => {
          window.clearTimeout(cap);
          finish();
        });
      });
    });
  });
}

export function printDocument({ paper = 'a4', onAfterPrint }: PrintDocumentOptions = {}): void {
  if (typeof window === 'undefined') return;

  /*
   * Wait for the browser's own 'afterprint' rather than doing this work straight
   * after `window.print()` returns. `window.print()` does NOT reliably block
   * script execution across browsers, so unmounting the print content — or
   * dropping the `@page` rule — on the next line can happen before the browser
   * has captured the page, which is what made a preview come out empty.
   * 'afterprint' fires once the dialog is dismissed either way.
   */
  function done() {
    window.removeEventListener('afterprint', done);
    resetPrintPaper();
    printTrace('afterprint handled: page box reset');
    onAfterPrint?.();
  }

  window.addEventListener('afterprint', done);
  applyPrintPaper(paper);
  printTrace('window.print() called', { paper });
  window.print();
  printTrace('window.print() returned');
}
