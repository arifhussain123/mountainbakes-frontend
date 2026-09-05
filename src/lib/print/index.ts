/**
 * The printing surface, in two halves that never call each other.
 *
 *   pos/      → ESC/POS bytes straight to the device (WebUSB / Web Serial /
 *               a socket). No browser dialog, ever, and no local service.
 *   browser/  → `window.print()`, for documents that genuinely want a sheet.
 *
 * Import from here rather than reaching into the folders, so which half a screen
 * is using is visible in its import list.
 */

export { printDocument, whenPrintAreaReady } from './browser/documentPrint';
export { cachedLogo, useCachedLogo, warmLogo } from './logoCache';

export {
  activePrintJobs,
  cancelPrintJob,
  connectPrinter,
  isPrinting,
  printerStatus,
  printJobSnapshot,
  subscribeToPrintJob,
  subscribeToPrintQueue,
  printProductionOrder,
  printSaleReceipt,
  printTestPage,
  reconnectPrinter,
  releasePrinter,
  testConnection,
  PosPrintError,
  type DeviceIdentity,
  type PrinterState,
  type PrinterStatus,
  type PrintContext,
  type PrintJobSnapshot,
  type PrintJobState,
  type PrintJobTimings,
  type PrintResult,
} from './pos/printerService';

export {
  canReconnect,
  isRetryable,
  needsSettings,
  printErrorMessage,
  type PrintErrorCode,
} from './pos/errors';

export {
  CONNECTION_LABELS,
  DEFAULT_CONFIG,
  clearConfig,
  isConfigured,
  profileOf,
  readConfig,
  subscribeToConfig,
  targetOf,
  writeConfig,
  type PosPrinterConfig,
  type PrinterConnection,
} from './pos/printerConfig';

export {
  connectionOptions,
  subscribeToDevices,
  transportFor,
  DEFAULT_PRINTER_PORT,
  type ConnectionType,
} from './pos/transport';

export {
  PRINTER_PROFILES,
  type PaperWidth,
  type PrinterProfile,
} from './pos/profiles';

export {
  productionOrderBlocks,
  saleReceiptBlocks,
  testPageBlocks,
  type PreviousCollection,
  type ProductionOrderDoc,
  type SaleReceiptDoc,
} from './pos/receiptFormatter';

export { preview, previewStyled, type PreviewLine } from './pos/escpos';

export {
  appendPrintLog,
  clearPrintLog,
  readPrintLog,
  subscribeToPrintLog,
  type PrintDocumentType,
  type PrintLogEntry,
} from './pos/printLog';
