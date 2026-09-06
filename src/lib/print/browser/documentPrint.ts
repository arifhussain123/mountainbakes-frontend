'use client';

import { printTrace } from '@/lib/print/diagnostics';

/**
 * Browser printing — the A4 documents.
 *
 * A delivery challan, a monthly report, a daily-sale sheet and a production check
 * sheet are genuinely documents on sheets: they want a page box, pagination and
 * a destination picker, and `window.print()` is the right tool for all of them.
 * Receipts are not, and go through `lib/print/systemPrinter.ts` instead — a
 * self-contained document handed to the installed printer.
 *
 * Keeping both is deliberate. What is *not* allowed is one silently becoming the
 * other: a failed receipt print must never quietly open this dialog, because the
 * person at the counter asked for a receipt and would get a preview of an A4
 * sheet with no explanation.
 *
 * Every browser print in the app goes through here so that the print DOM is
 * released on the browser's own `afterprint` — `window.print()` does not
 * reliably block across browsers, and unmounting the print content on the next
 * line is what once made a preview come out empty.
 */

export interface PrintDocumentOptions {
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

export function printDocument({ onAfterPrint }: PrintDocumentOptions = {}): void {
  if (typeof window === 'undefined') return;

  /*
   * Wait for the browser's own 'afterprint' rather than doing this work straight
   * after `window.print()` returns. `window.print()` does NOT reliably block
   * script execution across browsers, so unmounting the print content on the
   * next line can happen before the browser has captured the page, which is what
   * made a preview come out empty. 'afterprint' fires once the dialog is
   * dismissed either way.
   */
  function done() {
    window.removeEventListener('afterprint', done);
    printTrace('afterprint handled');
    onAfterPrint?.();
  }

  window.addEventListener('afterprint', done);
  printTrace('window.print() called');
  window.print();
  printTrace('window.print() returned');
}
