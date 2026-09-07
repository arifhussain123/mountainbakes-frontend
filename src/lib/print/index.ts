/**
 * The printing surface, in two halves that never call each other.
 *
 *   receipt/ + systemPrinter  → POP Print: the canonical receipt document, sent to
 *                               the printer this computer has installed.
 *   browser/                  → `window.print()` of the page itself, for the
 *                               documents that genuinely want an A4 sheet: the
 *                               delivery challan, the reports, the daily-sale sheet.
 *
 * Import from here rather than reaching into the folders, so which half a screen
 * is using is visible in its import list.
 */

export { printDocument, whenPrintAreaReady } from './browser/documentPrint';
export { cachedLogo, useCachedLogo, warmLogo } from './logoCache';

export {
  printProductionOrder,
  printSaleReceipt,
  productionOrderDocument,
  printingSupported,
  isPrinting,
  subscribeToPrintQueue,
  PosPrintError,
  type PrintOptions,
  type PrintResult,
  type PrintJobSnapshot,
} from './systemPrinter';

export { isRetryable, printErrorMessage, type PrintErrorCode } from './errors';

export { PAPER_OPTIONS, readReceiptPaper, useReceiptPaper, writeReceiptPaper } from './receiptPaper';

export { buildProductionOrderDocument } from './receipt/productionOrder';
export { buildSaleReceiptDocument } from './receipt/saleReceipt';
export { PRINT_STYLES, PAPERS, DEFAULT_PAPER } from './receipt/styles';
export type { PrintDocument } from './receipt/document';
export type {
  PaperWidth,
  PreviousCollection,
  ProductionOrderDoc,
  ProductionOrderLine,
  ProductionOrderPackingLine,
  ReceiptLine,
  SaleReceiptDoc,
} from './receipt/types';
