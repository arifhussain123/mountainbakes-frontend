import type { PaperWidth } from './types';

/**
 * The one typography system every printed receipt uses.
 *
 * ---------------------------------------------------------------------------
 * Why this file exists
 * ---------------------------------------------------------------------------
 * The printed slip used to be set three different ways: Tailwind utility classes
 * on the A4 challan (a dozen ad-hoc `text-[9px]` / `text-base` sizes), Courier
 * New at a measured size for the driver route, and `transform: scaleY(2)` for
 * the lines ESC/POS would have printed double-height. The result on paper was
 * exactly what was reported — some text very large, some sections in a different
 * face from the rest. Everything a receipt sets is now one of the sizes below,
 * in one family, and nothing else in the document is allowed to name a font.
 *
 * ---------------------------------------------------------------------------
 * The face
 * ---------------------------------------------------------------------------
 * Arial first. It is on every Windows till, it needs no download, and a thermal
 * driver rasterises its strokes dark enough to survive thresholding to one ink.
 * The rest of the stack is what Linux and macOS resolve the same request to.
 * Nothing external: a font that has to be fetched is a font that can fail to
 * arrive before the dialog opens, and a receipt that waits on a font is a
 * counter that waits on a receipt.
 *
 * ---------------------------------------------------------------------------
 * The scale
 * ---------------------------------------------------------------------------
 * Pixels, not points or millimetres: Chrome lays a print page out at 96 CSS px
 * per inch, so 11px is 2.9mm — a comfortable body size on a 72mm print area,
 * and the size every receipt of this kind uses. 58mm paper gets the same scale
 * multiplied down (`scale`), so the hierarchy is preserved rather than the
 * columns squeezed.
 */
export const PRINT_STYLES = {
  fontFamily: 'Arial, Helvetica, "Liberation Sans", "DejaVu Sans", sans-serif',
  /** Company name. */
  headerPx: 16,
  /** Department / section headings (PREVIOUS ORDER BALANCE). */
  sectionPx: 12,
  /** Order information, product rows, the collection working. */
  bodyPx: 11,
  /** Column headings, footer, signature captions. */
  smallPx: 9.5,
  /** TOTAL and AMOUNT TO COLLECT. */
  totalPx: 13,
  lineHeight: 1.3,
} as const;

export interface PaperSpec {
  id: PaperWidth;
  /** The roll, and the page box asked of the driver. */
  paperWidthMm: number;
  /**
   * How much of that width the head actually prints on.
   *
   * A roll is wider than its print area — 80mm of paper, 72mm of dots — and the
   * gap is the margin the mechanism needs. The receipt is laid out to THIS width
   * and left-aligned on a page the width of the PAPER: the page is a size every
   * roll driver lists, and the content lands on the printable rectangle from
   * whichever edge the head starts at.
   */
  printableWidthMm: number;
  /** Type-scale multiplier. 1 on 80mm. */
  scale: number;
}

export const PAPERS: Record<PaperWidth, PaperSpec> = {
  '80mm': { id: '80mm', paperWidthMm: 80, printableWidthMm: 72, scale: 1 },
  '58mm': { id: '58mm', paperWidthMm: 58, printableWidthMm: 48, scale: 0.86 },
};

export const DEFAULT_PAPER: PaperWidth = '80mm';

export function paperSpec(paper: PaperWidth | undefined): PaperSpec {
  return PAPERS[paper ?? DEFAULT_PAPER] ?? PAPERS[DEFAULT_PAPER];
}

/**
 * The receipt's own stylesheet. Self-contained — the document it goes into has
 * no other CSS, so nothing from the application (dark mode, the fluid type scale,
 * `visibility: hidden` print tricks) can reach it.
 *
 * Colours are stated, not inherited: black on white, and the engine is told not
 * to lighten anything to save ink it has no concept of. The `@page` here is the
 * placeholder; `systemPrinter.ts` replaces the height with the measured height of
 * the rendered receipt before the dialog opens (see `PAGE_STYLE_ID`).
 */
export const PAGE_STYLE_ID = 'mb-page';

export function receiptCss(paper: PaperSpec): string {
  const px = (size: number) => `${(size * paper.scale).toFixed(2)}px`;
  const s = PRINT_STYLES;
  return `
  @page { size: ${paper.paperWidthMm}mm 297mm; margin: 0; }
  html, body { margin: 0; padding: 0; background: #fff; color: #000; }
  body {
    font-family: ${s.fontFamily};
    font-size: ${px(s.bodyPx)};
    line-height: ${s.lineHeight};
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
    -webkit-font-smoothing: antialiased;
  }
  .receipt {
    box-sizing: border-box;
    width: ${paper.printableWidthMm}mm;
    margin: 0;
    padding: 1mm 0 0.5mm;
    color: #000;
    background: #fff;
    overflow-wrap: anywhere;
    word-break: break-word;
  }
  .c { text-align: center; }
  .r { text-align: right; }
  .b { font-weight: 700; }
  .up { text-transform: uppercase; }
  .company { font-size: ${px(s.headerPx)}; font-weight: 700; line-height: 1.15; text-transform: uppercase; letter-spacing: 0.02em; }
  .dept { font-size: ${px(s.sectionPx)}; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; }
  .doc-title { font-size: ${px(s.bodyPx)}; text-transform: uppercase; letter-spacing: 0.04em; }
  .sub { font-size: ${px(s.bodyPx)}; }
  .small { font-size: ${px(s.smallPx)}; }
  .section { font-size: ${px(s.sectionPx)}; font-weight: 700; text-transform: uppercase; margin-top: 0.8mm; }
  .rule { border: 0; border-top: 1px solid #000; margin: 1.4mm 0; height: 0; }
  .rule.dashed { border-top-style: dashed; }
  .kv { display: flex; justify-content: space-between; align-items: baseline; gap: 2mm; }
  .kv .k { flex: 0 0 auto; white-space: nowrap; }
  .kv .v { flex: 1 1 auto; min-width: 0; text-align: right; font-variant-numeric: tabular-nums; }
  .meta { display: grid; grid-template-columns: 1fr 1fr; column-gap: 3mm; row-gap: 0.2mm; }
  .meta .full { grid-column: 1 / -1; }
  table.items { width: 100%; border-collapse: collapse; table-layout: fixed; }
  table.items th {
    font-size: ${px(s.smallPx)}; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em;
    text-align: left; padding: 0.5mm 0 0.6mm; border-bottom: 1px solid #000;
  }
  table.items td { padding: 0.6mm 0; vertical-align: top; border-bottom: 1px dotted #777; }
  table.items tr:last-child td { border-bottom: 0; }
  table.items .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  table.items .qty { width: 11%; }
  table.items .rate { width: 20%; }
  table.items .amt { width: 24%; }
  table.items td.name { padding-right: 1.5mm; }
  .total { font-size: ${px(s.totalPx)}; font-weight: 700; }
  .total .v { font-variant-numeric: tabular-nums; }
  .note { font-size: ${px(s.bodyPx)}; }
  .sign { display: flex; gap: 4mm; margin-top: 5mm; }
  .sign > div { flex: 1 1 0; border-top: 1px solid #000; padding-top: 0.6mm; font-size: ${px(s.smallPx)}; text-transform: uppercase; }
  .footer { font-size: ${px(s.smallPx)}; text-align: center; margin-top: 2mm; }
  img.logo { display: block; margin: 0 auto 1mm; height: 12mm; width: auto; max-width: 28mm; }
  #mb-gauge { position: absolute; top: 0; left: 0; width: ${paper.paperWidthMm}mm; height: 0; visibility: hidden; }
  @media print { #mb-gauge { display: none; } }
  `;
}
