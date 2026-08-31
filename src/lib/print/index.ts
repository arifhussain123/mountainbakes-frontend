/**
 * The printing surface, in two halves that never call each other.
 *
 *   pos/      → ESC/POS bytes to the local print agent. No browser dialog, ever.
 *   browser/  → `window.print()`, for documents that genuinely want a sheet.
 *
 * Import from here rather than reaching into the folders, so which half a screen
 * is using is visible in its import list.
 */

export { printDocument } from './browser/documentPrint';

export {
  checkAgent,
  listPrinters,
  printProductionOrder,
  printSaleReceipt,
  printTestPage,
  PosPrintError,
  connectionFromTransport,
  type AgentPrinter,
  type AgentStatus,
  type PrintContext,
  type PrintResult,
} from './pos/printerService';

export {
  isRetryable,
  needsSettings,
  printErrorMessage,
  type PrintErrorCode,
} from './pos/errors';

export {
  CONNECTION_LABELS,
  DEFAULT_AGENT_URL,
  DEFAULT_CONFIG,
  clearConfig,
  isConfigured,
  profileOf,
  readConfig,
  subscribeToConfig,
  writeConfig,
  type PosPrinterConfig,
  type PrinterConnection,
} from './pos/printerConfig';

export {
  PRINTER_PROFILES,
  type PaperWidth,
  type PrinterProfile,
} from './pos/profiles';

export {
  productionOrderBlocks,
  saleReceiptBlocks,
  testPageBlocks,
  type ProductionOrderDoc,
  type SaleReceiptDoc,
} from './pos/receiptFormatter';

export { preview } from './pos/escpos';

export {
  appendPrintLog,
  clearPrintLog,
  readPrintLog,
  subscribeToPrintLog,
  type PrintDocumentType,
  type PrintLogEntry,
} from './pos/printLog';
