'use client';

import { PosPrintError, asPrintError, type PrintErrorCode } from './errors';
import {
  activePrintJobs,
  enqueue,
  withRetries,
  withTimeout,
  type PrintJobReporter,
  type PrintJobSnapshot,
  type PrintJobTimings,
  type RetryPolicy,
} from './printQueue';
import {
  CONNECTION_LABELS,
  isConfigured,
  profileOf,
  targetOf,
  type PosPrinterConfig,
  type PrinterConnection,
} from './printerConfig';
import { appendPrintLog, type PrintDocumentType, type PrintFormat } from './printLog';
import {
  InvalidDocumentError,
  productionOrderBlocks,
  saleReceiptBlocks,
  testPageBlocks,
  validateProductionDoc,
  validateSaleDoc,
  type ProductionOrderDoc,
  type SaleReceiptDoc,
} from './receiptFormatter';
import { renderBlocks, toBytes, type Block } from './escpos';
import { transportFor, type DeviceIdentity, type LinkStatus, type PrintJob } from './transport';

/**
 * The one way anything in the web app prints to a thermal printer.
 *
 * ---------------------------------------------------------------------------
 * What this replaces, and what replaced what
 * ---------------------------------------------------------------------------
 * First it replaced `window.print()`. Every part of that path — the layout
 * engine, the `@page` box, the preview, the destination picker — is machinery for
 * putting a *document* on a *sheet*, and a receipt roll is neither. It is also
 * where the original bug lived: the app's global `@page { size: A4 }` handed to
 * an 80mm driver is what Chrome could not render, and the message it showed for
 * that was "Print preview failed".
 *
 * Then it replaced the **local print agent**. The bytes used to be posted to a
 * small Node service on 127.0.0.1 that spooled them, and that service was a
 * second program to install on every till, start at boot, keep running and keep
 * reachable. When it was not, the counter got "POS printing service is not
 * running" with a customer waiting — a message about *our plumbing*, offering a
 * fix nobody at a till can perform.
 *
 * The browser can open the printer itself, so it does. `transport/` holds the
 * ways it can (WebUSB, Web Serial, a raw socket) and their real limits — plus one
 * that does not open the printer at all and says so, the installed-driver route
 * for a unit Windows already owns. This file holds everything that is the same
 * whichever is in use: validate, compose, send, log.
 *
 * ---------------------------------------------------------------------------
 * Every page prints through here
 * ---------------------------------------------------------------------------
 * Sales and Production call `printSaleReceipt` / `printProductionOrder` and show
 * what comes back. Neither knows what a column is, what a byte is, or which
 * printer is attached — and neither should, because the moment printer logic
 * exists in two pages it starts to differ between them.
 */

/* ────────────────────────────────────────────────────────────────────────────
   Status
   ──────────────────────────────────────────────────────────────────────────── */

export type PrinterState =
  /** No transport on this browser can reach the chosen kind of printer. */
  | 'unsupported'
  /** Nothing set up on this device yet. */
  | 'not-configured'
  /** Set up, but the link is not open — unplugged, off, or awaiting a reconnect. */
  | 'not-connected'
  /** Open and ready. */
  | 'connected';

export interface PrinterStatus {
  state: PrinterState;
  /** Can this browser do this at all? `false` means a different browser is the only fix. */
  supported: boolean;
  /** Why it is not connected, in a sentence meant for a cashier. */
  reason?: string;
  /** What the device calls itself, when one was found. */
  deviceLabel?: string | null;
  checkedAt: number;
}

/**
 * Where the printer stands, without prompting for anything.
 *
 * Silent by design: this runs on a poll and on every page that shows the status
 * pill, and a function that could open a device chooser would make the pill a
 * trap. Only `connect` prompts, and only from a click.
 */
export async function printerStatus(config: PosPrinterConfig): Promise<PrinterStatus> {
  const transport = transportFor(config.connection);
  const support = transport.support();
  const checkedAt = Date.now();

  if (!support.supported) {
    return { state: 'unsupported', supported: false, reason: support.reason, checkedAt };
  }
  if (!isConfigured(config)) {
    return { state: 'not-configured', supported: true, checkedAt };
  }

  let link: LinkStatus;
  try {
    link = await transport.status(targetOf(config));
  } catch (error) {
    return { state: 'not-connected', supported: true, reason: asPrintError(error).message, checkedAt };
  }

  return {
    state: link.state === 'connected' ? 'connected' : 'not-connected',
    supported: true,
    reason: link.reason,
    deviceLabel: link.device?.label ?? (config.printerName || null),
    checkedAt,
  };
}

/* ────────────────────────────────────────────────────────────────────────────
   Setting a printer up
   ──────────────────────────────────────────────────────────────────────────── */

/**
 * Show the browser's device chooser and adopt what comes back.
 *
 * **Must be called directly from a click.** Every device-picker API in every
 * browser requires a live user gesture, and an `await` before this call is enough
 * to lose one — so Printer Setup does no async work between the press and here.
 *
 * What comes back is a description, not a handle: `DeviceIdentity` is what the
 * caller stores, and `navigator.usb.getDevices()` is what turns it back into a
 * device tomorrow morning.
 */
export async function connectPrinter(config: PosPrinterConfig): Promise<DeviceIdentity> {
  const transport = transportFor(config.connection);
  const support = transport.support();
  if (!support.supported) {
    throw new PosPrintError('not-supported', support.reason ?? 'This browser cannot reach that kind of printer.');
  }
  return transport.request(targetOf(config));
}

/**
 * Re-adopt an already-authorised printer. Never prompts, so it is safe on load.
 *
 * `null` means "nothing authorised matches this config" — the printer is
 * unplugged, or the permission was cleared in browser settings. Both need the
 * chooser again, and neither is an error worth interrupting anyone with.
 */
export async function reconnectPrinter(config: PosPrinterConfig): Promise<DeviceIdentity | null> {
  if (!isConfigured(config)) return null;
  const transport = transportFor(config.connection);
  if (!transport.support().supported) return null;
  try {
    return await transport.restore(targetOf(config));
  } catch {
    return null;
  }
}

/**
 * Prove the link, without printing.
 *
 * This actually opens the device — claims the USB interface, opens the COM port,
 * completes the TCP handshake. It deliberately does **not** merely check that a
 * configuration exists: "you have filled in some settings" is not a connection,
 * and reporting it as one is how a till discovers the truth in front of a
 * customer instead of during setup.
 */
export async function testConnection(config: PosPrinterConfig): Promise<DeviceIdentity> {
  if (!isConfigured(config)) {
    throw new PosPrintError('no-printer', 'Set the printer up first, then test the connection.');
  }
  const transport = transportFor(config.connection);
  const support = transport.support();
  if (!support.supported) {
    throw new PosPrintError('not-supported', support.reason ?? 'This browser cannot reach that kind of printer.');
  }
  return transport.probe(targetOf(config));
}

/** Hand the device back to the operating system. Used when a printer is replaced. */
export async function releasePrinter(config: PosPrinterConfig): Promise<void> {
  try {
    await transportFor(config.connection).release(targetOf(config));
  } catch {
    /* Nothing to release, or already gone. Either way the config is what changes. */
  }
}

/* ────────────────────────────────────────────────────────────────────────────
   Duplicate protection, and the queue
   ──────────────────────────────────────────────────────────────────────────── */

/**
 * Two layers, as before — the button disables itself, and the service refuses to
 * make a second job for a document already in flight. What changed is the shape
 * of the refusal: it used to be a `duplicate` error thrown at whoever pressed
 * second, and it is now the *same job* handed back. Two buttons aimed at one sale
 * both follow one print and both say Printed when it is.
 *
 * The queue (`printQueue.ts`) is what makes that possible, and it also does the
 * thing this file could not: one job at a time per printer. Two different
 * documents sent together used to race into the same bulk endpoint.
 *
 * Keyed by document, not by job: a *deliberate* reprint after the first finished
 * is a new print and must go through. A caller that genuinely wants a second
 * copy *while* the first is still printing passes `requestId` in the context.
 */
function documentKey(type: PrintDocumentType, id: string | null, requestId?: string | null): string {
  return `${type}:${id ?? 'none'}${requestId ? `:${requestId}` : ''}`;
}

/** Which lane a config prints on — one per physical printer. */
function printerKeyOf(config: PosPrinterConfig): string {
  return config.printerId || `${config.connection}:unnamed`;
}

/**
 * How many jobs are queued or on the wire right now.
 *
 * Exists so `discovery.ts` can report *Printing* honestly. No device API answers
 * "are you busy" — a bulk endpoint takes bytes or it does not — so the only true
 * statement available is that this app has a job outstanding, and the queue is
 * where that is known.
 */
export function activePrintCount(): number {
  return activePrintJobs().length;
}

/* ────────────────────────────────────────────────────────────────────────────
   Timeouts and retries
   ──────────────────────────────────────────────────────────────────────────── */

/** Opening the device: claim the interface, open the port, complete the handshake. */
const CONNECT_TIMEOUT_MS = 5_000;
/** The write, per copy. A receipt is a few KB and takes well under a second. */
const PRINT_TIMEOUT_PER_COPY_MS = 10_000;
/** Three tries in all, with a growing pause: 500ms before the second, 1s before the third. */
const RETRY_POLICY_DEVICE: RetryPolicy = {
  maxAttempts: 3,
  delaysMs: [500, 1_000, 2_000],
  shouldRetry: (error) => AUTO_RETRY.has(error.code),
};
/**
 * The faults worth a second go without asking: the link dropped, or the printer
 * did not answer in time. Deliberately NOT `write-failed` — bytes reached the
 * paper before the fault, and a retry there prints the receipt again below a
 * torn one — and not the faults a retry cannot fix (Windows holding the device,
 * an unplugged printer, a document that does not add up).
 */
const AUTO_RETRY: ReadonlySet<PrintErrorCode> = new Set<PrintErrorCode>([
  'timeout',
  'printer-offline',
  'not-connected',
  'print-failed',
]);
/** The installed-printer route is a dialog a person is looking at. Never repeat it. */
const RETRY_POLICY_DIALOG: RetryPolicy = { maxAttempts: 1, delaysMs: [], shouldRetry: () => false };

/* ────────────────────────────────────────────────────────────────────────────
   Printing
   ──────────────────────────────────────────────────────────────────────────── */

export interface PrintContext {
  config: PosPrinterConfig;
  branchId?: string | null;
  branchName?: string | null;
  userId?: string | null;
  /**
   * Follow the job: queued (and how many are ahead), printing, printed, failed.
   * The button passes this so it can say *Queued* rather than *Printing…* while
   * another receipt is on the wire.
   */
  onJobUpdate?: (job: PrintJobSnapshot<PrintResult>) => void;
  /**
   * Distinguishes a second copy asked for *while* the first is still printing
   * from a double-press. Leave unset for ordinary prints — the same document
   * pressed twice is one job.
   */
  requestId?: string | null;
}

export interface PrintResult {
  printJobId: string;
  printerName: string;
  durationMs: number;
  bytes: number;
  /** Where the time went. Zero cost to a caller that ignores it. */
  timings: PrintJobTimings;
}

export async function printSaleReceipt(doc: SaleReceiptDoc, context: PrintContext): Promise<PrintResult> {
  return submit({
    context,
    documentType: 'sale',
    documentId: doc.saleId,
    build: (config) => {
      // Validation runs BEFORE a byte is composed, so a sale whose figures do not
      // reconcile never reaches the printer at all — an unprintable receipt is
      // better than a wrong one in a customer's hand.
      validateSaleDoc(doc);
      return saleReceiptBlocks(doc, profileOf(config));
    },
  });
}

export async function printProductionOrder(doc: ProductionOrderDoc, context: PrintContext): Promise<PrintResult> {
  return submit({
    context,
    documentType: 'production-order',
    documentId: doc.orderNumber,
    build: (config) => {
      validateProductionDoc(doc);
      return productionOrderBlocks(doc, profileOf(config));
    },
  });
}

/**
 * The test page.
 *
 * `printerOverride` exists because the test page is printed *while setting a
 * printer up* — before the choice has been saved. Testing whatever is already
 * stored would make it impossible to try a printer before committing to it, which
 * is the one thing the test page is for.
 */
export async function printTestPage(
  context: PrintContext,
  printerOverride?: { name: string; connection: PrinterConnection },
): Promise<PrintResult> {
  const name = printerOverride?.name || context.config.printerName;
  const connection = printerOverride?.connection ?? context.config.connection;
  return submit({
    context,
    documentType: 'test-page',
    documentId: null,
    printerName: name,
    build: (config) =>
      testPageBlocks(
        { printerName: name || 'Unnamed printer', connectionLabel: CONNECTION_LABELS[connection] },
        profileOf(config),
      ),
  });
}

interface SubmitArgs {
  context: PrintContext;
  documentType: PrintDocumentType;
  documentId: string | null;
  /** Overrides the stored name — only the test page uses it. */
  printerName?: string;
  /**
   * The document as blocks, not as bytes.
   *
   * Composing stops one step short of ESC/POS here because not every transport
   * wants ESC/POS: the installed-printer route is handed a page to render and
   * needs the document itself (`transport/types.ts` explains why both travel).
   * The bytes are made below, from these blocks, so the two forms cannot describe
   * different receipts.
   */
  build: (config: PosPrinterConfig) => Block[];
}

/**
 * Validate the request, queue it, and hand back the job's promise.
 *
 * Nothing heavy happens on the caller's stack. The checks here are the ones that
 * are cheap and that a person would want to hear about at once — no printer set
 * up, a browser that cannot do this — and everything else (compose, open, write,
 * log) runs in the lane, one job at a time per printer, after the event loop has
 * had a turn. The whole print lifecycle lives in `execute` rather than in the
 * three public functions above, so the sale path and the production path cannot
 * drift into having different duplicate handling, different logging or different
 * error mapping.
 */
async function submit(args: SubmitArgs): Promise<PrintResult> {
  const { context, documentType, documentId } = args;
  const config = context.config;
  const printerName = args.printerName ?? config.printerName;

  if (!isConfigured(config)) {
    throw new PosPrintError('no-printer', 'No POS printer set up on this device. Set one up in Printer Settings.');
  }

  const transport = transportFor(config.connection);
  const support = transport.support();
  if (!support.supported) {
    throw new PosPrintError('not-supported', support.reason ?? 'This browser cannot reach that kind of printer.');
  }

  const { promise } = enqueue<PrintResult>({
    key: documentKey(documentType, documentId, context.requestId),
    printerKey: printerKeyOf(config),
    documentType,
    documentId,
    onUpdate: context.onJobUpdate,
    run: (reporter) => execute(args, transport, printerName, reporter),
  });
  return promise;
}

/**
 * Compose, connect, send, log — the body of one job, run by the lane.
 *
 * Copies: one call for every copy. A device transport repeats the byte stream —
 * the stream ends in a cut, so a kitchen copy and a customer copy come out as
 * two receipts rather than one long strip — and the installed-printer transport
 * puts them on successive pages of a single document, because repeating the job
 * there would mean one print dialog per copy.
 */
async function execute(
  args: SubmitArgs,
  transport: ReturnType<typeof transportFor>,
  printerName: string,
  reporter: PrintJobReporter,
): Promise<PrintResult> {
  const { context, documentType, documentId } = args;
  const config = context.config;
  const startedAt = Date.now();

  const composeStart = now();
  let blocks: Block[];
  try {
    blocks = args.build(config);
  } catch (error) {
    // A document that does not reconcile is not a printer problem, so it is not
    // retried and it is not logged as a failed print job — nothing was sent.
    if (error instanceof InvalidDocumentError) {
      throw new PosPrintError('invalid-document', error.message);
    }
    throw error;
  }

  const profile = profileOf(config);
  const copies = Math.max(1, config.copies);
  const payload = toBytes(renderBlocks(blocks, profile.charactersPerLine));
  reporter.composed(now() - composeStart);

  // Both forms of the same document, composed once and handed over together.
  // Which half a transport reads is its business — that is what keeps "how many
  // copies" and "which wire" from becoming a branch on connection type up here.
  const job: PrintJob = {
    bytes: payload,
    blocks,
    columns: profile.charactersPerLine,
    paperWidthMm: profile.paperWidthMm,
    printableWidthMm: profile.printableWidthMm,
    copies,
    title: jobTitle(documentType, documentId),
  };

  /*
   * What this job physically was, for the log.
   *
   * Assembled beside the job rather than at each `appendPrintLog` call, so the
   * success entry and the failure entry cannot come to describe different paper —
   * they are the same print, and a log where the two disagree is worse than one
   * that omits the fields.
   */
  const paperFacts = {
    connection: config.connection,
    paperWidth: profile.id,
    columns: profile.charactersPerLine,
    copies,
    printFormat: formatOf(config.connection),
  };

  const printJobId = reporter.jobId;
  const target = targetOf(config);
  const dialog = config.connection === 'system';

  try {
    await withRetries(
      async () => {
        // Prove the link first, on its own clock. A printer that is switched off
        // fails here in five seconds with a sentence about the printer, rather
        // than in ten with one about the receipt.
        const connectStart = now();
        try {
          if (!dialog) {
            await withTimeout(
              transport.probe(target),
              CONNECT_TIMEOUT_MS,
              'The printer did not answer. Check it is switched on and connected, then print again.',
            );
          }
        } finally {
          reporter.connected(now() - connectStart);
        }

        const sendStart = now();
        try {
          if (dialog) {
            // A print dialog has no deadline a page should enforce: the person
            // reading it sets the pace, and the transport's own fallback covers
            // a dialog that never reports back.
            await transport.send(target, job);
          } else {
            await withTimeout(
              transport.send(target, job),
              PRINT_TIMEOUT_PER_COPY_MS * copies,
              'The printer stopped accepting the receipt. Check the paper roll, then print again.',
            );
          }
        } finally {
          reporter.sent(now() - sendStart);
        }
      },
      dialog ? RETRY_POLICY_DIALOG : RETRY_POLICY_DEVICE,
      reporter,
    );

    const timings = reporter.timings();
    const result: PrintResult = {
      printJobId,
      printerName,
      durationMs: Date.now() - startedAt,
      bytes: payload.length * copies,
      timings,
    };

    appendPrintLog({
      printJobId,
      documentType,
      documentId,
      branchId: context.branchId ?? null,
      branchName: context.branchName ?? null,
      printerId: config.printerId,
      printerName,
      userId: context.userId ?? null,
      createdAt: new Date().toISOString(),
      status: 'success',
      durationMs: result.durationMs,
      bytes: result.bytes,
      ...paperFacts,
      timings,
    });
    return result;
  } catch (error) {
    const failure = asPrintError(error, 'print-failed');
    appendPrintLog({
      printJobId,
      documentType,
      documentId,
      branchId: context.branchId ?? null,
      branchName: context.branchName ?? null,
      printerId: config.printerId,
      printerName,
      userId: context.userId ?? null,
      createdAt: new Date().toISOString(),
      status: 'failed',
      errorCode: failure.code,
      errorMessage: failure.message,
      durationMs: Date.now() - startedAt,
      ...paperFacts,
      timings: reporter.timings(),
      printerState: await linkStateAtFailure(config),
    });
    throw failure;
  }
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/**
 * What the job is called where a name is visible.
 *
 * Only the installed-printer route has anywhere to put this — it becomes the
 * document title, which is what Windows shows in the print queue and what a
 * browser puts in the dialog's header. The device transports have no such field
 * and ignore it. Naming the sale is what makes a stuck queue diagnosable without
 * a row of identical "about:blank" entries.
 */
function jobTitle(documentType: PrintDocumentType, documentId: string | null): string {
  const kind =
    documentType === 'sale' ? 'Receipt' : documentType === 'production-order' ? 'Production order' : 'Test page';
  return documentId ? `${kind} ${documentId}` : kind;
}

/**
 * What a connection actually puts on the wire.
 *
 * Three of the four transports write ESC/POS to a device they opened; the fourth
 * hands a rendered page to the driver that owns the printer. A print log that
 * only recorded the connection would leave a reader to remember which is which,
 * and it is the distinction that decides where to look when a roll comes out
 * blank — so it is written down rather than inferred.
 */
function formatOf(connection: PrinterConnection): PrintFormat {
  return connection === 'system' ? 'driver-page' : 'escpos';
}

/**
 * Where the link stood at the moment a print failed.
 *
 * Only ever called on the failure path, so it costs a successful sale nothing.
 * It answers what the error code cannot — the code says what this app tried and
 * this says whether there was anything on the other end — and it is deliberately
 * best-effort: a status check that itself fails must not replace the real error
 * with its own.
 */
async function linkStateAtFailure(config: PosPrinterConfig): Promise<string | undefined> {
  try {
    const link = await transportFor(config.connection).status(targetOf(config));
    return link.state;
  } catch {
    return undefined;
  }
}

/** Re-exported so callers need one import for the whole POS print surface. */
export { PosPrintError };
export {
  activePrintJobs,
  cancelPrintJob,
  isPrinting,
  printJobSnapshot,
  subscribeToPrintJob,
  subscribeToPrintQueue,
} from './printQueue';
export type { PrintErrorCode, PrinterConnection, DeviceIdentity };
export type { PrintJobSnapshot, PrintJobState, PrintJobTimings } from './printQueue';
