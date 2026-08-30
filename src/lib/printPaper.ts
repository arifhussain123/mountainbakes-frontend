import type { PaperMode } from '@/hooks/usePrintCapability';

const STYLE_ID = 'mb-print-paper';

/**
 * The POS page box: whatever the roll printer says it is, less 3mm of margin
 * either side.
 *
 * `size: auto`, NOT `80mm auto`. The height has to be automatic — a receipt
 * printer feeds and cuts at the end of the content, so pinning a height would
 * either clip a long demand or spit blank paper after a short one — but CSS has
 * no way to say "this width, that height automatic": `size` takes `auto` alone,
 * one length, two lengths, or a page-size keyword. `80mm auto` is a **parse
 * error**, so the browser dropped the declaration and left `size: A4` (from the
 * base `@page` in globals.css) in force — an A4 page box asked of a printer that
 * only has an 80mm roll, which is what produced "Print preview failed" with the
 * Print button greyed out. The margins in the same rule parsed fine, which is
 * why this looked like it was working at all.
 *
 * `size: auto` hands the page box to the driver, the only party that knows the
 * roll is 80mm and continuous. No width is lost by not naming one:
 * `html[data-print-paper='pos'] .print-area` in globals.css lays the receipt out
 * at a hard 74mm, so it comes out receipt-width on the roll — and on a device
 * saving a PDF instead, the same 74mm strip on that device's default sheet.
 */
const POS_PAGE = '@page { size: auto; margin: 3mm 3mm 8mm; }';

/**
 * Switches the printed page box to a POS roll for the next `window.print()`.
 *
 * `@page` is the one thing CSS cannot scope to a class — it has no selector, so
 * `html[data-print-paper="pos"] @page` is not expressible and the A4 rule in
 * `globals.css` would win no matter what the device chose. Injecting a second
 * `@page` at print time is the only way to override it; everything else the POS
 * layout needs *is* selector-scoped and lives in `globals.css` under the
 * `data-print-paper` attribute this also sets.
 *
 * ALWAYS pair with `resetPrintPaper()` on `afterprint`. The rule is global while
 * it is mounted, so leaving it behind would print the next report — on any
 * screen in the app — onto an 80mm page box.
 */
export function applyPrintPaper(paper: PaperMode): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.printPaper = paper;

  if (paper !== 'pos') {
    resetPrintPaper();
    document.documentElement.dataset.printPaper = paper;
    return;
  }

  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = STYLE_ID;
    document.head.appendChild(style);
  }
  style.textContent = POS_PAGE;
}

/** Drops the injected `@page` and the attribute, restoring the A4 default. */
export function resetPrintPaper(): void {
  if (typeof document === 'undefined') return;
  document.getElementById(STYLE_ID)?.remove();
  delete document.documentElement.dataset.printPaper;
}
