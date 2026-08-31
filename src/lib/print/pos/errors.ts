/**
 * Every way a POS print can fail, named — and every name paired with what to do
 * about it.
 *
 * ---------------------------------------------------------------------------
 * Why the codes are not collapsed into "Print failed"
 * ---------------------------------------------------------------------------
 * Because these lead to genuinely different actions: plug the printer in, press
 * Connect and pick it again, switch to a browser that can do this at all, fix the
 * figures on the sale, or wait and retry. A counter handed one message for all of
 * them learns that the message means nothing, and by Thursday the receipt book is
 * back on the desk.
 *
 * ---------------------------------------------------------------------------
 * What is NOT in this list any more
 * ---------------------------------------------------------------------------
 * `service-unavailable` — "POS printing service is not running". There is no
 * local print service to be running: the browser opens the printer itself
 * (`transport/`). Nothing in this app may reintroduce that sentence, because the
 * only honest fix it ever offered was to install and babysit a second program on
 * every till.
 *
 * The codes that replaced it draw a line the old one blurred, between a browser
 * that *cannot* do this (`not-supported` — a different browser is the only fix)
 * and a printer that is not there *right now* (`not-connected`, `printer-offline`
 * — plug it in, press Reconnect). Those need different words and different
 * buttons.
 */

export type PrintErrorCode =
  /** This browser has no API that can reach this kind of printer. Permanent here. */
  | 'not-supported'
  /** No printer has been set up on this device yet. */
  | 'no-printer'
  /** Set up, but the link is not open — unplugged, switched off, or never reconnected. */
  | 'not-connected'
  /** The user closed the browser's device chooser without picking anything. */
  | 'cancelled'
  /** The browser or the OS refused access to the device. */
  | 'permission-denied'
  /** Another program (usually the printer's own driver) is holding the device. */
  | 'device-busy'
  /** The saved printer is not attached to this computer any more. */
  | 'printer-not-found'
  /** Attached, but not answering — off, out of paper, or asleep. */
  | 'printer-offline'
  /** The printer accepted the connection and then stopped part-way. */
  | 'write-failed'
  /** The device did not accept the job in time. */
  | 'timeout'
  /** The saved settings cannot address a printer — a blank IP, a bad port. */
  | 'invalid-config'
  /** The document did not reconcile, or had nothing to print. */
  | 'invalid-document'
  /** This same document is already being printed. */
  | 'duplicate'
  /** Anything that got this far without a name of its own. */
  | 'print-failed';

export class PosPrintError extends Error {
  readonly code: PrintErrorCode;
  /** Developer-facing context. Shown only in debug mode, never to counter staff. */
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
 * Each names the next action rather than the internal cause, and none of them
 * carries a stack, a device path or an error number — those go to the debug
 * panel. A transport that knows more than this side does (which port, which
 * driver) supplies its own sentence; these are the fallback.
 */
export function printErrorMessage(code: PrintErrorCode): string {
  switch (code) {
    case 'not-supported':
      return 'This browser cannot print directly to a POS printer. Open Mountain Bakes in Chrome, Edge or Opera on the till.';
    case 'no-printer':
      return 'No POS printer set up on this device. Set one up in Printer Settings.';
    case 'not-connected':
      return 'POS printer is not connected. Check it is switched on and plugged in, then reconnect.';
    case 'cancelled':
      return 'No printer was chosen.';
    case 'permission-denied':
      return 'This computer refused access to the printer. Reconnect it in Printer Settings.';
    case 'device-busy':
      return 'Another program on this computer is using the printer. Close it, or remove the printer from Windows printers, then reconnect.';
    case 'printer-not-found':
      return 'POS printer is not connected. Plug it in, switch it on, then press Reconnect.';
    case 'printer-offline':
      return 'POS printer is not connected. Check it is switched on, plugged in and loaded with paper.';
    case 'write-failed':
      return 'The receipt was cut short. Check the paper roll, then print again.';
    case 'timeout':
      return 'The printer did not respond in time. Check it is switched on, then try again.';
    case 'invalid-config':
      return 'This printer is set up incorrectly. Review it in Printer Settings.';
    case 'invalid-document':
      return 'This document cannot be printed — its figures do not add up. Nothing was sent to the printer.';
    case 'duplicate':
      return 'This document is already printing.';
    case 'print-failed':
      return 'Unable to print. Check the POS printer connection.';
  }
}

/** Whether trying the same print again could plausibly work. Drives the Retry button. */
export function isRetryable(code: PrintErrorCode): boolean {
  return code !== 'invalid-document' && code !== 'duplicate' && code !== 'not-supported';
}

/** Whether the fix is in Printer Settings rather than at the printer. */
export function needsSettings(code: PrintErrorCode): boolean {
  return (
    code === 'no-printer' ||
    code === 'printer-not-found' ||
    code === 'invalid-config' ||
    code === 'permission-denied' ||
    code === 'device-busy' ||
    code === 'not-supported'
  );
}

/**
 * Whether the printer is merely *not attached right now*.
 *
 * The failure panel offers Reconnect for exactly these, and only these: pressing
 * it re-adopts an already-authorised device without a chooser, which is the right
 * one-press fix for a printer that was switched off overnight and the wrong
 * response to a browser that cannot do USB at all.
 */
export function canReconnect(code: PrintErrorCode): boolean {
  return code === 'not-connected' || code === 'printer-offline' || code === 'printer-not-found';
}

/**
 * A thrown `unknown` as a typed error, without swallowing what it was.
 *
 * The device APIs throw `DOMException`s whose `name` is the only machine-readable
 * part; the transports map the ones they can interpret and hand anything else
 * here, where it becomes `print-failed` with the original text kept as detail for
 * the debug panel.
 */
export function asPrintError(error: unknown, fallback: PrintErrorCode = 'print-failed'): PosPrintError {
  if (error instanceof PosPrintError) return error;
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return new PosPrintError(fallback, printErrorMessage(fallback), detail);
}
