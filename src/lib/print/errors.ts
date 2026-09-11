/**
 * Every way a receipt print can fail, named — and every name paired with what to
 * do about it.
 *
 * The list is short on purpose. There used to be a dozen codes for a dozen ways
 * of reaching a printer (WebUSB, Web Serial, a socket, a print agent); there is
 * one way now — the printer the operating system has installed — and it fails in
 * only a few distinguishable ways. A counter handed one message for all of them
 * learns that the message means nothing, so the four kept here each lead to a
 * different action: open the app in a browser that can print, fix the figures on
 * the document, try again, or tell someone the printer itself is off.
 */

export type PrintErrorCode =
  /** This browser has no print path at all. Permanent here. */
  | 'not-supported'
  /** The document failed validation, or rendered with nothing on it. Nothing was sent. */
  | 'invalid-document'
  /** The print frame did not become ready in time. */
  | 'timeout'
  /** The print was withdrawn before it started. */
  | 'cancelled'
  /** Anything that got this far without a name of its own. */
  | 'print-failed';

export class PosPrintError extends Error {
  readonly code: PrintErrorCode;
  /** Developer-facing context, never shown to counter staff. */
  readonly detail: string | null;

  constructor(code: PrintErrorCode, message: string, detail?: string | null) {
    super(message);
    this.name = 'PosPrintError';
    this.code = code;
    this.detail = detail ?? null;
  }
}

/**
 * What to tell the person at the till.
 *
 * Each names the next action rather than the internal cause, and none carries a
 * stack or an error number. A caller that knows more than this side does supplies
 * its own sentence; these are the fallback.
 */
export function printErrorMessage(code: PrintErrorCode): string {
  switch (code) {
    case 'not-supported':
      return 'This browser cannot print. Open Mountain Bakes in Chrome or Edge on the till.';
    case 'invalid-document':
      return 'Print document is empty. Nothing was sent to the printer.';
    case 'timeout':
      return 'The receipt could not be prepared for the printer in time. Try again.';
    case 'cancelled':
      return 'Printing was cancelled.';
    case 'print-failed':
      return 'Printing failed. Check the printer is switched on and set as the default printer on this computer.';
  }
}

/** Whether trying the same print again could plausibly work. Drives the Retry affordance. */
export function isRetryable(code: PrintErrorCode): boolean {
  return code !== 'invalid-document' && code !== 'not-supported';
}

/**
 * A thrown `unknown` as a typed error, without swallowing what it was.
 *
 * The original text is kept as `detail` for the console trace; the person at
 * the counter gets the sentence for the code.
 */
export function asPrintError(error: unknown, fallback: PrintErrorCode = 'print-failed'): PosPrintError {
  if (error instanceof PosPrintError) return error;
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return new PosPrintError(fallback, printErrorMessage(fallback), detail);
}
