'use client';

import { PosPrintError, fromAgentResponse, type PrintErrorCode } from './errors';
import {
  connectionFromTransport,
  isConfigured,
  profileOf,
  type PosPrinterConfig,
  type PrinterConnection,
} from './printerConfig';
import { CONNECTION_LABELS } from './printerConfig';
import { appendPrintLog, type PrintDocumentType } from './printLog';
import {
  InvalidDocumentError,
  productionOrderBase64,
  saleReceiptBase64,
  testPageBase64,
  validateProductionDoc,
  validateSaleDoc,
  type ProductionOrderDoc,
  type SaleReceiptDoc,
} from './receiptFormatter';

/**
 * The one way anything in the web app prints to a thermal printer.
 *
 * ---------------------------------------------------------------------------
 * What this replaces
 * ---------------------------------------------------------------------------
 * `window.print()`. Every part of that path — the layout engine, the `@page` box,
 * the preview, the destination picker — is machinery for putting a *document* on
 * a *sheet*, and a receipt roll is neither. It is also where the reported bug
 * lived: the app's global `@page { size: A4 }` handed to an 80mm driver is what
 * Chrome could not render, and the message it showed for that was "Print preview
 * failed".
 *
 * Here the app composes ESC/POS itself and posts it to the local print agent,
 * which spools it raw. No preview, no dialog, no page box — and no destination to
 * choose, because the destination was chosen once in Printer Settings.
 *
 * Browser printing is not gone: `lib/print/browser/documentPrint.ts` still owns
 * it, for the A4 challan and the reports that are genuinely documents. The two
 * paths are separate on purpose and neither falls back to the other on its own.
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
   Talking to the agent
   ──────────────────────────────────────────────────────────────────────────── */

/** A health check must not hang the status pill. The agent answers in single-digit ms when it is up. */
const HEALTH_TIMEOUT_MS = 2_500;
/** A print may legitimately take a moment — a spooler queue, a printer waking. */
const PRINT_TIMEOUT_MS = 20_000;

export interface AgentPrinter {
  id: string;
  name: string;
  transport: string;
  source: 'system' | 'config';
  isDefault: boolean;
}

export interface AgentStatus {
  reachable: boolean;
  version?: string;
  platform?: string;
  requiresToken?: boolean;
  /** Set when unreachable, so settings can say *why* rather than just "offline". */
  error?: PosPrintError;
  checkedAt: number;
}

function headers(config: PosPrinterConfig): HeadersInit {
  const base: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.agentToken) base.Authorization = `Bearer ${config.agentToken}`;
  return base;
}

/**
 * `fetch` with a deadline, and every network-layer failure turned into one code.
 *
 * The browser is deliberately unhelpful here: a refused connection, a DNS
 * failure, a blocked mixed-content request and a CORS rejection all surface as
 * the same opaque `TypeError`. There is no way to tell them apart from script,
 * and guessing between them would produce confident wrong advice. They share one
 * cause in practice — the agent is not running — so they share one message, and
 * the agent's README covers the rest.
 */
async function agentFetch(
  config: PosPrinterConfig,
  path: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${config.agentUrl.replace(/\/+$/, '')}${path}`, {
      ...init,
      headers: headers(config),
      signal: controller.signal,
      // The agent authenticates by origin and an optional bearer token; it has no
      // cookies and must not be sent any.
      credentials: 'omit',
      cache: 'no-store',
    });
  } catch (error) {
    const aborted = error instanceof DOMException && error.name === 'AbortError';
    throw new PosPrintError(
      aborted ? 'timeout' : 'service-unavailable',
      aborted
        ? 'The print service did not respond in time.'
        : 'POS printing service is not running. Start the local print service on this computer and try again.',
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    clearTimeout(timer);
  }
}

/** Is the agent up? Cheap enough to poll, and it names no printers. */
export async function checkAgent(config: PosPrinterConfig): Promise<AgentStatus> {
  try {
    const response = await agentFetch(config, '/v1/health', { method: 'GET' }, HEALTH_TIMEOUT_MS);
    if (!response.ok) {
      throw fromAgentResponse(await safeJson(response), response.status === 403 ? 'permission-denied' : 'service-unavailable');
    }
    const body = (await response.json()) as { version?: string; platform?: string; requiresToken?: boolean };
    return {
      reachable: true,
      version: body.version,
      platform: body.platform,
      requiresToken: body.requiresToken,
      checkedAt: Date.now(),
    };
  } catch (error) {
    return {
      reachable: false,
      error: error instanceof PosPrintError ? error : new PosPrintError('service-unavailable', 'POS printing service is not running.'),
      checkedAt: Date.now(),
    };
  }
}

/**
 * The printers this computer actually has.
 *
 * The list comes from the machine's own spooler, which is the point: the shop
 * picks "BlackCopper 80mm Series" because that is what is installed, not because
 * the name was compiled into the app. Replacing the hardware is then a re-pick in
 * settings rather than a release.
 */
export async function listPrinters(config: PosPrinterConfig): Promise<AgentPrinter[]> {
  const response = await agentFetch(config, '/v1/printers', { method: 'GET' }, HEALTH_TIMEOUT_MS);
  if (!response.ok) {
    throw fromAgentResponse(await safeJson(response), response.status === 401 || response.status === 403 ? 'permission-denied' : 'print-failed');
  }
  const body = (await response.json()) as { printers?: AgentPrinter[] };
  return body.printers ?? [];
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
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
 * buttons aimed at one sale. The agent holds a third line (it remembers job ids
 * for a minute), which is what covers a request that was retried after its
 * response was lost.
 *
 * Keyed by document, not by job: a *deliberate* reprint after the first finished
 * is a new print and must go through.
 */
const IN_FLIGHT = new Set<string>();

function documentKey(type: PrintDocumentType, id: string | null): string {
  return `${type}:${id ?? 'none'}`;
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
  /** The agent had already run this job id and did not print a second copy. */
  duplicate: boolean;
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
      return saleReceiptBase64(doc, profileOf(config));
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
      return productionOrderBase64(doc, profileOf(config));
    },
  });
}

/**
 * The test page, addressed to a printer explicitly.
 *
 * `printerOverride` exists because the test page is printed *while choosing* a
 * printer — before the choice has been saved. Testing whatever is already stored
 * would make it impossible to try a printer before committing to it, which is the
 * one thing the test page is for.
 */
export async function printTestPage(
  context: PrintContext,
  printerOverride?: { id: string; name: string; connection: PrinterConnection },
): Promise<PrintResult> {
  const printer = printerOverride ?? {
    id: context.config.printerId,
    name: context.config.printerName,
    connection: context.config.connection,
  };
  return submit({
    context,
    documentType: 'test-page',
    documentId: null,
    printerId: printer.id,
    printerName: printer.name,
    build: (config) =>
      testPageBase64(
        { printerName: printer.name || 'Unnamed printer', connectionLabel: CONNECTION_LABELS[printer.connection] },
        profileOf(config),
      ),
  });
}

interface SubmitArgs {
  context: PrintContext;
  documentType: PrintDocumentType;
  documentId: string | null;
  /** Overrides the stored printer — only the test page uses it. */
  printerId?: string;
  printerName?: string;
  build: (config: PosPrinterConfig) => string;
}

/**
 * Validate, compose, send, log.
 *
 * The whole print lifecycle lives here rather than in the two public functions
 * above, so the sale path and the production path cannot drift into having
 * different duplicate handling, different logging or different error mapping.
 */
async function submit(args: SubmitArgs): Promise<PrintResult> {
  const { context, documentType, documentId } = args;
  const config = context.config;
  const printerId = args.printerId ?? config.printerId;
  const printerName = args.printerName ?? config.printerName;

  if (!printerId && !isConfigured(config)) {
    throw new PosPrintError('no-printer', 'No POS printer set up on this device. Choose one in Printer Settings.');
  }

  const key = documentKey(documentType, documentId);
  if (IN_FLIGHT.has(key)) {
    throw new PosPrintError('duplicate', 'This document is already printing.');
  }

  let dataBase64: string;
  try {
    dataBase64 = args.build(config);
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

  try {
    // `copies` sends the job that many times with distinct ids. One payload with
    // the bytes repeated would print on one long strip with a single cut at the
    // end — a kitchen copy and a customer copy have to be two receipts.
    let last: PrintResult | null = null;
    for (let copy = 0; copy < Math.max(1, config.copies); copy++) {
      last = await send({
        config,
        printJobId: config.copies > 1 ? `${printJobId}-${copy + 1}` : printJobId,
        printerId,
        documentType,
        documentId,
        dataBase64,
        startedAt,
      });
    }
    const result = last!;

    appendPrintLog({
      printJobId: result.printJobId,
      documentType,
      documentId,
      branchId: context.branchId ?? null,
      branchName: context.branchName ?? null,
      printerId,
      printerName: result.printerName || printerName,
      userId: context.userId ?? null,
      createdAt: new Date().toISOString(),
      status: 'success',
      durationMs: result.durationMs,
      bytes: result.bytes,
      duplicate: result.duplicate,
    });
    return result;
  } catch (error) {
    const failure = error instanceof PosPrintError ? error : new PosPrintError('print-failed', 'Unable to print. Check the POS printer connection.');
    appendPrintLog({
      printJobId,
      documentType,
      documentId,
      branchId: context.branchId ?? null,
      branchName: context.branchName ?? null,
      printerId,
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

interface SendArgs {
  config: PosPrinterConfig;
  printJobId: string;
  printerId: string;
  documentType: PrintDocumentType;
  documentId: string | null;
  dataBase64: string;
  startedAt: number;
}

async function send(args: SendArgs): Promise<PrintResult> {
  const response = await agentFetch(
    args.config,
    '/v1/print',
    {
      method: 'POST',
      body: JSON.stringify({
        printJobId: args.printJobId,
        printerId: args.printerId,
        documentType: args.documentType,
        documentId: args.documentId,
        createdAt: new Date().toISOString(),
        dataBase64: args.dataBase64,
      }),
    },
    PRINT_TIMEOUT_MS,
  );

  const body = (await safeJson(response)) as
    | { ok?: boolean; printJobId?: string; printerName?: string; durationMs?: number; bytes?: number; duplicate?: boolean }
    | null;

  if (!response.ok || !body?.ok) {
    throw fromAgentResponse(body, response.status === 401 || response.status === 403 ? 'permission-denied' : 'print-failed');
  }

  return {
    printJobId: body.printJobId ?? args.printJobId,
    printerName: body.printerName ?? '',
    durationMs: body.durationMs ?? Date.now() - args.startedAt,
    bytes: body.bytes ?? 0,
    duplicate: body.duplicate === true,
  };
}

/**
 * A fresh id per press.
 *
 * `crypto.randomUUID` needs a secure context, which the deployed app has and a
 * plain-HTTP dev host on a LAN IP does not — so the fallback is not decoration.
 * Uniqueness is what the agent's replay protection keys on: two presses that
 * produced the same id would silently print once.
 */
function newJobId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Re-exported so callers need one import for the whole POS print surface. */
export { PosPrintError, connectionFromTransport };
export type { PrintErrorCode, PrinterConnection };
