'use client';

import { PosPrintError, asPrintError, type PrintErrorCode } from './errors';
import {
  CONNECTION_LABELS,
  isConfigured,
  profileOf,
  targetOf,
  type PosPrinterConfig,
  type PrinterConnection,
} from './printerConfig';
import { appendPrintLog, type PrintDocumentType } from './printLog';
import {
  InvalidDocumentError,
  productionOrderBytes,
  saleReceiptBytes,
  testPageBytes,
  validateProductionDoc,
  validateSaleDoc,
  type ProductionOrderDoc,
  type SaleReceiptDoc,
} from './receiptFormatter';
import { transportFor, type DeviceIdentity, type LinkStatus } from './transport';

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
 * three ways (WebUSB, Web Serial, a raw socket) and their real limits; this file
 * holds everything that is the same whichever one is in use: validate, compose,
 * send, log.
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
   Duplicate protection
   ──────────────────────────────────────────────────────────────────────────── */

/**
 * Documents currently being printed, so the same one cannot be sent twice.
 *
 * The button's disabled state is the first line and this is the second, because
 * the button only covers one button: a reprint launched from the sales table
 * while the invoice dialog's own Print is still in flight is two different
 * buttons aimed at one sale.
 *
 * There used to be a third line in the print agent, which ignored a job id it had
 * already run — protection against an HTTP request retried after its response was
 * lost. With the agent gone there is no request and no response to lose: the
 * write either reaches the device or throws. The layer went with the thing it was
 * protecting against, rather than being reimplemented for a hazard that no longer
 * exists.
 *
 * Keyed by document, not by job: a *deliberate* reprint after the first finished
 * is a new print and must go through.
 */
const IN_FLIGHT = new Set<string>();

function documentKey(type: PrintDocumentType, id: string | null): string {
  return `${type}:${id ?? 'none'}`;
}

/**
 * How many jobs are on the wire right now.
 *
 * Exists so `discovery.ts` can report *Printing* honestly. No device API answers
 * "are you busy" — a bulk endpoint takes bytes or it does not — so the only true
 * statement available is that this app has a write outstanding, and this is where
 * that is known. Reading the set rather than adding a second counter is what
 * keeps the two from disagreeing.
 */
export function activePrintCount(): number {
  return IN_FLIGHT.size;
}

/* ────────────────────────────────────────────────────────────────────────────
   Printing
   ──────────────────────────────────────────────────────────────────────────── */

export interface PrintContext {
  config: PosPrinterConfig;
  branchId?: string | null;
  branchName?: string | null;
  userId?: string | null;
}

export interface PrintResult {
  printJobId: string;
  printerName: string;
  durationMs: number;
  bytes: number;
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
      return saleReceiptBytes(doc, profileOf(config));
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
      return productionOrderBytes(doc, profileOf(config));
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
      testPageBytes(
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
  build: (config: PosPrinterConfig) => Uint8Array;
}

/**
 * Validate, compose, send, log.
 *
 * The whole print lifecycle lives here rather than in the three public functions
 * above, so the sale path and the production path cannot drift into having
 * different duplicate handling, different logging or different error mapping.
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

  const key = documentKey(documentType, documentId);
  if (IN_FLIGHT.has(key)) {
    throw new PosPrintError('duplicate', 'This document is already printing.');
  }

  let payload: Uint8Array;
  try {
    payload = args.build(config);
  } catch (error) {
    // A document that does not reconcile is not a printer problem, so it is not
    // retried and it is not logged as a failed print job — nothing was sent.
    if (error instanceof InvalidDocumentError) {
      throw new PosPrintError('invalid-document', error.message);
    }
    throw error;
  }

  IN_FLIGHT.add(key);
  const printJobId = newJobId();
  const startedAt = Date.now();
  const target = targetOf(config);

  try {
    // `copies` writes the job that many times. One payload with the bytes
    // repeated would print on one long strip with a single cut at the end — a
    // kitchen copy and a customer copy have to be two receipts.
    for (let copy = 0; copy < Math.max(1, config.copies); copy++) {
      await transport.send(target, payload);
    }

    const result: PrintResult = {
      printJobId,
      printerName,
      durationMs: Date.now() - startedAt,
      bytes: payload.length * Math.max(1, config.copies),
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
    });
    throw failure;
  } finally {
    IN_FLIGHT.delete(key);
  }
}

/**
 * A fresh id per press.
 *
 * `crypto.randomUUID` needs a secure context, which the deployed app has and a
 * plain-HTTP dev host on a LAN IP does not — so the fallback is not decoration.
 * It identifies the job in the on-device print log, which is what a POS complaint
 * is diagnosed from.
 */
function newJobId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Re-exported so callers need one import for the whole POS print surface. */
export { PosPrintError };
export type { PrintErrorCode, PrinterConnection, DeviceIdentity };
