/**
 * Every way a POS print can fail, named — and every name paired with what to do
 * about it.
 *
 * ---------------------------------------------------------------------------
 * Why the codes are not collapsed into "Print failed"
 * ---------------------------------------------------------------------------
 * Because these lead to five genuinely different actions: start the agent, plug
 * the printer in, pick a printer in settings, wait and retry, or call someone.
 * A counter handed one message for all of them learns that the message means
 * nothing, and by Thursday the receipt book is back on the desk.
 *
 * The agent returns the same vocabulary (`print-agent/src/transports.mjs`), so a
 * code crosses the wire unchanged rather than being re-guessed from an HTTP
 * status. Anything the agent sends that is not in this list maps to `print-failed`
 * — the code whose advice is the most likely to be useful when the cause is
 * unknown.
 */

export type PrintErrorCode =
  /** The agent is not running, or not reachable at the configured URL. */
  | 'service-unavailable'
  /** The agent is up but rejected this origin, or the shared token is wrong. */
  | 'permission-denied'
  /** No printer has been chosen on this device yet. */
  | 'no-printer'
  /** The chosen printer is not installed on this computer any more. */
  | 'printer-not-found'
  /** Installed, but not answering — off, out of paper, or unplugged. */
  | 'printer-offline'
  /** The printer accepted the connection and then stopped part-way. */
  | 'write-failed'
  /** The job took too long to be accepted. */
  | 'timeout'
  /** The agent could not use the printer entry it was given. */
  | 'invalid-config'
  /** The document did not reconcile, or had nothing to print. */
  | 'invalid-document'
  /** This same document is already being printed. */
  | 'duplicate'
  /** Anything the agent reported that this app does not have a name for. */
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
 * carries a stack, a URL or an HTTP status — those go to the debug panel. The
 * agent supplies its own sentence for the cases where it knows more than this
 * side does (which printer, which port); those are used in preference and these
 * are the fallback.
 */
export function printErrorMessage(code: PrintErrorCode): string {
  switch (code) {
    case 'service-unavailable':
      return 'POS printing service is not running. Start the local print service on this computer and try again.';
    case 'permission-denied':
      return 'The print service refused this request. Check the print service settings on this computer.';
    case 'no-printer':
      return 'No POS printer set up on this device. Choose one in Printer Settings.';
    case 'printer-not-found':
      return 'The chosen printer is no longer installed on this computer. Pick it again in Printer Settings.';
    case 'printer-offline':
      return 'POS printer is not connected. Check it is switched on, plugged in and loaded with paper.';
    case 'write-failed':
      return 'The receipt was cut short. Check the paper roll, then print again.';
    case 'timeout':
      return 'The printer did not respond in time. Check it is switched on, then try again.';
    case 'invalid-config':
      return 'This printer is configured incorrectly. Review it in Printer Settings.';
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
  return code !== 'invalid-document' && code !== 'duplicate';
}

/** Whether the fix is in Printer Settings rather than at the printer. */
export function needsSettings(code: PrintErrorCode): boolean {
  return code === 'no-printer' || code === 'printer-not-found' || code === 'invalid-config' || code === 'permission-denied';
}

const AGENT_CODES: readonly PrintErrorCode[] = [
  'no-printer',
  'printer-not-found',
  'printer-offline',
  'permission-denied',
  'timeout',
  'invalid-config',
  'write-failed',
];

/** An agent response body as a typed error. Unknown codes become `print-failed`. */
export function fromAgentResponse(body: unknown, fallback: PrintErrorCode = 'print-failed'): PosPrintError {
  const record = (body ?? {}) as { code?: unknown; message?: unknown; detail?: unknown };
  const code = typeof record.code === 'string' && (AGENT_CODES as readonly string[]).includes(record.code)
    ? (record.code as PrintErrorCode)
    : fallback;
  // The agent's own sentence names the printer and the port; this side's generic
  // one does not. Prefer the specific message wherever there is one.
  const message = typeof record.message === 'string' && record.message ? record.message : printErrorMessage(code);
  const detail = typeof record.detail === 'string' ? record.detail : null;
  return new PosPrintError(code, message, detail);
}
