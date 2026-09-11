'use client';

import { PosPrintError, asPrintError } from './errors';
import { enqueue, type PrintJobReporter, type PrintJobSnapshot } from './printQueue';
import { printTrace } from './diagnostics';
import type { PrintDocument } from './receipt/document';
import { PAGE_STYLE_ID } from './receipt/styles';
import { buildProductionOrderDocument } from './receipt/productionOrder';
import { buildSaleReceiptDocument } from './receipt/saleReceipt';
import type { PaperWidth, ProductionOrderDoc, SaleReceiptDoc } from './receipt/types';
import { InvalidDocumentError } from './receipt/validate';

/**
 * POP Print — the printer this computer has installed, through the driver that
 * owns it.
 *
 * ---------------------------------------------------------------------------
 * The shape of it
 * ---------------------------------------------------------------------------
 *   figures → validate → canonical document (receipt/) → a frame of its own
 *           → measured page box → content check → print() → afterprint
 *
 * The receipt is printed from a **detached iframe with its own document**, so the
 * application's stylesheet does not reach it at all: no dark-mode colour, no
 * fluid type scale, no `visibility: hidden` print trick, no global `@page`. What
 * is in the frame is exactly `PrintDocument.html`, and that same HTML is what a
 * preview shows and what "Save as PDF" writes — one document, several
 * destinations.
 *
 * ---------------------------------------------------------------------------
 * What a browser can and cannot do here, stated plainly
 * ---------------------------------------------------------------------------
 * A web page cannot pick a printer or print silently by itself. `print()` hands
 * the document to the operating system's default printer THROUGH the browser's
 * print dialog, and the person at the till presses Print. Chrome and Edge can be
 * told to skip that dialog — start the browser with `--kiosk-printing` — and the
 * job then goes straight to the default printer with nothing to press. That is a
 * decision about the machine, made once by whoever sets the till up; this code
 * behaves identically either way and never pretends to have made it.
 *
 * Nothing here bypasses that boundary, opens a device, or talks to a local
 * service. The old routes that did (WebUSB, Web Serial, a socket, a print agent)
 * are gone along with the setup screen they needed.
 *
 * ---------------------------------------------------------------------------
 * Why the paper came out white, and what stops it now
 * ---------------------------------------------------------------------------
 * The previous frame was hidden with `opacity: 0`, asked the driver for a page
 * narrower than any roll it lists (the 72mm print area rather than the 80mm
 * paper), and set emphasis with CSS transforms. Each is a way to hand a driver a
 * job it renders as nothing; the cut still happened because the job itself was
 * accepted. Now the frame is laid out off-screen but opaque, the page is the
 * paper width with the receipt left-aligned on it, the type is plain weighted
 * text, and — the part that matters most — the rendered frame is READ BACK
 * before `print()`: the receipt box must have height and its text must contain
 * the reference and the total, or the job is refused as `invalid-document` and
 * no paper moves.
 */

export interface PrintResult {
  printJobId: string;
  durationMs: number;
}

export interface PrintOptions {
  /** The roll on this till. Defaults to 80mm. */
  paper?: PaperWidth;
  /** Follow the job: queued (and how many are ahead), printing, printed, failed. */
  onJobUpdate?: (job: PrintJobSnapshot<PrintResult>) => void;
  /**
   * Distinguishes a second copy asked for *while* the first is still printing
   * from a double-press. Leave unset for ordinary prints — the same document
   * pressed twice is one job.
   */
  requestId?: string | null;
}

/** One lane: the machine has one default printer, and the browser one dialog. */
const PRINTER_KEY = 'system-default';

/** A frame that never loads (a policy blocking `srcdoc`, an extension that ate it). */
const FRAME_LOAD_TIMEOUT_MS = 10_000;
/** Fonts are local; this only bounds a `document.fonts.ready` that never settles. */
const FONTS_TIMEOUT_MS = 1_500;
/**
 * `afterprint` is the honest end of the job and fires for print and cancel alike.
 * The fallback releases the button on a browser that never fires it.
 */
const AFTERPRINT_FALLBACK_MS = 30_000;
/**
 * Chrome's `print()` blocks until the dialog closes; where it does not (a kiosk
 * build that spools at once, a browser without the event) this is how long after
 * it returns the job is taken as finished.
 */
const RETURN_GRACE_MS = 1_500;
/**
 * How long to leave the frame in the document after the dialog closes. Removing
 * it on `afterprint` alone is too eager — some builds are still reading the
 * frame's layout at that moment, and a frame torn down there prints blank.
 */
const CLEANUP_DELAY_MS = 1_000;

const UNSUPPORTED_REASON =
  'This browser cannot open a print dialog, so the printer installed on this computer cannot be reached from here.';

export function printingSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.print === 'function' && typeof document !== 'undefined';
}

export function printProductionOrder(doc: ProductionOrderDoc, options: PrintOptions = {}): Promise<PrintResult> {
  return submit(doc.orderNumber, 'production-order', () => buildProductionOrderDocument(doc, options.paper ?? '80mm'), options);
}

export function printSaleReceipt(doc: SaleReceiptDoc, options: PrintOptions = {}): Promise<PrintResult> {
  return submit(doc.saleId, 'sale', () => buildSaleReceiptDocument(doc, options.paper ?? '80mm'), options);
}

/**
 * The canonical document for a caller that wants to SHOW it — a preview tab, a
 * diagnostic — rather than print it. Same builder, same validation.
 */
export function productionOrderDocument(doc: ProductionOrderDoc, paper: PaperWidth = '80mm'): PrintDocument {
  return buildProductionOrderDocument(doc, paper);
}

/**
 * Queue the job and hand back its promise. Nothing heavy happens on the caller's
 * stack: the one check here is cheap and worth hearing at once (no print path in
 * this browser); building, loading, measuring and printing run in the lane after
 * the event loop has had a turn, so the button repaints before any of it starts.
 */
function submit(
  id: string,
  kind: PrintDocument['kind'],
  build: () => PrintDocument,
  options: PrintOptions,
): Promise<PrintResult> {
  if (!printingSupported()) {
    return Promise.reject(new PosPrintError('not-supported', UNSUPPORTED_REASON));
  }
  const { promise } = enqueue<PrintResult>({
    key: `${kind}:${id || 'none'}${options.requestId ? `:${options.requestId}` : ''}`,
    printerKey: PRINTER_KEY,
    documentType: kind,
    documentId: id || null,
    onUpdate: options.onJobUpdate,
    run: (reporter) => execute(build, reporter),
  });
  return promise;
}

async function execute(build: () => PrintDocument, reporter: PrintJobReporter): Promise<PrintResult> {
  const startedAt = Date.now();

  const composeStart = now();
  let document: PrintDocument;
  try {
    document = build();
  } catch (error) {
    // A document that does not reconcile is not a printer problem: nothing was
    // sent, and it is reported as the document's fault, not the printer's.
    if (error instanceof InvalidDocumentError) throw new PosPrintError('invalid-document', error.message);
    throw error;
  }
  reporter.composed(now() - composeStart);
  printTrace('document composed', { ms: Math.round(now() - composeStart), bytes: document.html.length, kind: document.kind });

  await printInFrame(document, reporter);

  return { printJobId: reporter.jobId, durationMs: Date.now() - startedAt };
}

/* ────────────────────────────────────────────────────────────────────────────
   The frame
   ──────────────────────────────────────────────────────────────────────────── */

async function printInFrame(document: PrintDocument, reporter: PrintJobReporter): Promise<void> {
  const host = window.document;
  const frame = host.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.setAttribute('tabindex', '-1');
  frame.title = document.title;
  // Off-screen, NOT hidden. A frame that is `display: none`, `visibility: hidden`
  // or `opacity: 0` is a frame Chrome has been seen to print as a blank sheet;
  // one that is merely parked outside the viewport is laid out and painted like
  // any other, and that is what the print engine needs to find pages in it.
  frame.style.cssText = [
    'position:absolute',
    'top:-10000px',
    'left:-10000px',
    `width:${document.paper.paperWidthMm + 20}mm`,
    'height:400mm',
    'border:0',
    'background:#fff',
  ].join(';');

  const cleanup = () => {
    window.setTimeout(() => frame.remove(), CLEANUP_DELAY_MS);
  };

  host.body.appendChild(frame);

  try {
    const prepareStart = now();
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(
        () => reject(new PosPrintError('timeout', 'The receipt could not be prepared for the printer. Try again.')),
        FRAME_LOAD_TIMEOUT_MS,
      );
      frame.addEventListener(
        'load',
        () => {
          window.clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
      frame.srcdoc = document.html;
    });

    const view = frame.contentWindow;
    const doc = frame.contentDocument;
    if (!view || !doc) throw new PosPrintError('print-failed', 'The receipt could not be prepared for the printer. Try again.');
    printTrace('receipt frame loaded');

    // Fonts are local and images are inlined data URLs, so both settle at once;
    // waiting is what guarantees the height measured below is the printed height.
    await settleAssets(doc);
    fitPage(doc, document.paper.paperWidthMm);
    verifyRendered(doc, document);
    reporter.connected(now() - prepareStart);
    printTrace('receipt fitted and verified', { ms: Math.round(now() - prepareStart) });

    const sendStart = now();
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let fallback = 0;
      let grace = 0;
      const teardown = () => {
        window.clearTimeout(fallback);
        window.clearTimeout(grace);
        view.removeEventListener('afterprint', finish);
        window.removeEventListener('afterprint', finish);
      };
      function finish() {
        if (settled) return;
        settled = true;
        teardown();
        printTrace('print dialog finished');
        resolve();
      }
      view.addEventListener('afterprint', finish);
      window.addEventListener('afterprint', finish);
      fallback = window.setTimeout(finish, AFTERPRINT_FALLBACK_MS);
      try {
        view.focus();
        printTrace('frame print() called');
        view.print();
        printTrace('frame print() returned');
      } catch (error) {
        settled = true;
        teardown();
        reject(asPrintError(error, 'print-failed'));
        return;
      }
      // Chrome has already fired `afterprint` by the time `print()` returns; a
      // browser that spools without blocking has not, and gets the grace period.
      grace = window.setTimeout(finish, RETURN_GRACE_MS);
    });
    reporter.sent(now() - sendStart);
  } catch (error) {
    cleanup();
    throw asPrintError(error, 'print-failed');
  }

  cleanup();
}

/** Resolve once the frame's fonts and images are ready, or after a short cap. */
async function settleAssets(doc: Document): Promise<void> {
  const fonts = (doc as Document & { fonts?: { ready?: Promise<unknown> } }).fonts?.ready;
  const images = Array.from(doc.images)
    .filter((img) => !img.complete)
    .map((img) => (typeof img.decode === 'function' ? img.decode().catch(() => undefined) : Promise.resolve()));
  const work = Promise.all([fonts ?? Promise.resolve(), ...images]);
  await Promise.race([work, new Promise((resolve) => setTimeout(resolve, FONTS_TIMEOUT_MS))]);
  // One frame so the layout reflects whatever just arrived.
  await new Promise<void>((resolve) => {
    const raf = (doc.defaultView ?? window).requestAnimationFrame;
    if (typeof raf === 'function') raf(() => resolve());
    else resolve();
  });
}

/**
 * Cut the page box to the receipt.
 *
 * A roll wants a page exactly as long as the receipt: the driver feeds to the
 * end of it and cuts, and anything longer is paper fed and thrown away on every
 * sale. `@page { size: 80mm auto }` cannot express that (`size` takes lengths or
 * `auto`, never a mix), so the height is MEASURED from the rendered receipt and
 * written into the last `@page` rule, which wins on document order.
 *
 * The width stays the paper's: it is a size every roll driver lists. Silent on
 * failure — a receipt printed on the placeholder page beats no receipt.
 */
function fitPage(doc: Document, paperWidthMm: number): void {
  try {
    const gauge = doc.getElementById('mb-gauge');
    const receipt = doc.getElementById('mb-receipt');
    const page = doc.getElementById(PAGE_STYLE_ID);
    if (!gauge || !receipt || !page) return;
    const pxPerMm = gauge.getBoundingClientRect().width / paperWidthMm;
    if (!(pxPerMm > 0)) return;
    const heightMm = receipt.getBoundingClientRect().height / pxPerMm;
    if (!(heightMm > 0)) return;
    // Two millimetres of slack: sub-pixel rounding can otherwise put the last
    // line a hair past the page and spill it onto a second one — on a roll, a
    // second cut with one line of receipt on it.
    const pageHeightMm = Math.ceil(heightMm) + 2;
    page.textContent = `@page { size: ${paperWidthMm}mm ${pageHeightMm}mm; margin: 0; }`;
  } catch {
    /* Measured on a best-effort basis; the placeholder page stands. */
  }
}

/**
 * The blank-paper guard. Reads the rendered frame back and refuses to print a
 * document that has no box or does not say what it claims to say.
 *
 * This is the check the reported failure needed: both the paper and the PDF came
 * out white while the app said "Printed successfully". Whatever the cause on a
 * given machine, a page that does not visibly carry the reference number and the
 * total is not this receipt, and it does not go to the printer.
 */
function verifyRendered(doc: Document, document: PrintDocument): void {
  const receipt = doc.getElementById('mb-receipt');
  const box = receipt?.getBoundingClientRect();
  if (!receipt || !box || !(box.height > 0) || !(box.width > 0)) {
    throw new PosPrintError('invalid-document', 'Print document is empty. Nothing was sent to the printer.');
  }
  const text = normalise(receipt.innerText || receipt.textContent || '');
  if (text.length === 0) {
    throw new PosPrintError('invalid-document', 'Print document is empty. Nothing was sent to the printer.');
  }
  const missing = document.mustContain.filter((needle) => !text.includes(normalise(needle)));
  if (missing.length > 0) {
    throw new PosPrintError(
      'invalid-document',
      'Print document is incomplete. Nothing was sent to the printer.',
      `missing: ${missing.join(', ')}`,
    );
  }
}

function normalise(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export { PosPrintError };
export { isPrinting, subscribeToPrintQueue } from './printQueue';
export type { PrintJobSnapshot } from './printQueue';
