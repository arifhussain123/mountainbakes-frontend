import type { PaperMode } from '@/hooks/usePrintCapability';

const STYLE_ID = 'mb-print-paper';

/**
 * 80mm roll less 3mm of margin either side. Height is `auto` — a receipt printer
 * feeds and cuts at the end of the content, so pinning a height would either
 * clip a long demand or spit blank paper after a short one.
 */
const POS_PAGE = '@page { size: 80mm auto; margin: 3mm 3mm 8mm; }';

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
