'use client';

import type { PrintErrorCode } from './errors';

/**
 * A record of what this till printed, kept so a POS problem can be diagnosed
 * after the fact.
 *
 * ---------------------------------------------------------------------------
 * Why it is local and not a table
 * ---------------------------------------------------------------------------
 * The brief for this work says not to change the database structure unless it is
 * necessary, and for the question this log actually answers it is not. What
 * anyone asks is "did the receipt for sale MB-000786 come out of *this* printer,
 * and if not what did it say" — a question about one machine, answered on that
 * machine. Shipping every print attempt to the API would add write traffic on the
 * hot path of a sale, and would still not record the attempts that failed because
 * the network was the thing that was down.
 *
 * If the shop later wants print history across branches, this is the shape to
 * send: `PrintLogEntry` is already the row.
 *
 * A ring buffer, capped, because a busy counter prints a few hundred receipts a
 * day and localStorage is a few megabytes.
 */

export type PrintDocumentType = 'sale' | 'production-order' | 'test-page';

/**
 * What was actually put on the wire, as opposed to how it was addressed.
 *
 * `escpos` is the printer's own command language written straight to a device.
 * `driver-page` is the installed-printer route: a rendered page handed to the
 * operating system's driver (`transport/system.ts`). The two fail in completely
 * different ways — a blank roll from `escpos` means the bytes went nowhere or the
 * head is not printing them, and a blank roll from `driver-page` means the driver
 * got a page it could not render — so this is the first field worth reading when
 * a till reports white paper.
 */
export type PrintFormat = 'escpos' | 'driver-page';

export interface PrintLogEntry {
  printJobId: string;
  documentType: PrintDocumentType;
  /** The sale or demand reference. `null` for a test page. */
  documentId: string | null;
  branchId: string | null;
  branchName: string | null;
  printerId: string;
  printerName: string;
  /** Who was signed in. An id, never an email — this sits in the browser. */
  userId: string | null;
  createdAt: string; // ISO
  status: 'success' | 'failed';
  /** Present on a failure. The machine-readable half of what went wrong. */
  errorCode?: PrintErrorCode;
  /** The sentence that was shown. Kept because it is what the user will quote. */
  errorMessage?: string;
  durationMs?: number;
  bytes?: number;

  /* ── What the job was, physically ──────────────────────────────────────────
     Recorded because "the receipt printed wrong" is a question about the paper
     and the format, and neither is recoverable after the fact: the config is
     per-device localStorage that may have been changed since, and the profile it
     resolved to is not stored anywhere at all. Without these, a report of clipped
     columns cannot be told apart from a report of the wrong roll. */

  /** How the printer was addressed — `usb`, `serial`, `network`, `system`. */
  connection?: string;
  /** The roll this job was composed for. `80mm` / `58mm`. */
  paperWidth?: string;
  /** Characters across the line, after any hand-set override. The column maths. */
  columns?: number;
  /** How many copies were asked for. */
  copies?: number;
  /** Bytes, or a page for a driver. See `PrintFormat`. */
  printFormat?: PrintFormat;
  /**
   * Where the link stood when the job failed, checked at the moment of failure.
   *
   * Only on a failure, and only ever a *report* — the print was already attempted
   * by the time this is read, so it costs a customer nothing and it answers the
   * one question the error code cannot: was the printer there at all. Absent when
   * the check itself could not be made.
   */
  printerState?: string;
}

const KEY = 'mb.posPrintLog';
const LIMIT = 200;
const CHANGE_EVENT = 'mb:pos-print-log';

/**
 * The parsed log, memoised on the RAW stored string.
 *
 * ---------------------------------------------------------------------------
 * Why this is a cache and not a plain read
 * ---------------------------------------------------------------------------
 * Because `useSyncExternalStore` compares snapshots with `Object.is`, and this
 * function is one — `DebugPanel` subscribes to it. A `getSnapshot` that parses
 * JSON on every call hands React a new array every render, React sees the store
 * change, re-renders to catch up, gets another new array, and never settles: the
 * tab pegs a core and the whole app stops responding for as long as the panel is
 * mounted. It is not a slow render, it is an infinite one, and the empty case
 * loops just as hard because `return []` is a fresh array too.
 *
 * `printerConfig.configSnapshot` solved exactly this for the config and carries
 * the same note. This is the second store on the same page and it needed the
 * same treatment; the `EMPTY_LOG` constant used for the server snapshot shows the
 * rule was known and applied to only one of the three arguments.
 *
 * Keyed on the raw string rather than a revision counter so it stays correct
 * across tabs: a `storage` event from another till session changes the string,
 * and the next read reparses because of that alone.
 */
let CACHE: { raw: string | null; value: PrintLogEntry[] } | null = null;

export function readPrintLog(): PrintLogEntry[] {
  if (typeof window === 'undefined') return EMPTY;
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    // Private mode or storage disabled by policy. One stable value, so a browser
    // that cannot store anything does not loop either.
    return EMPTY;
  }

  if (CACHE && CACHE.raw === raw) return CACHE.value;

  let value: PrintLogEntry[] = EMPTY;
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) value = parsed as PrintLogEntry[];
    } catch {
      /* A corrupted entry reads as no history rather than throwing at a cashier. */
    }
  }
  CACHE = { raw, value };
  return value;
}

/** One array for every empty result, so the identity is stable across reads. */
const EMPTY: PrintLogEntry[] = [];

/** Newest first, so a reader sees the print they just attempted at the top. */
export function appendPrintLog(entry: PrintLogEntry): void {
  if (typeof window === 'undefined') return;
  try {
    const next = [entry, ...readPrintLog()].slice(0, LIMIT);
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // A full or disabled store must never be the reason a receipt does not
    // print — this is a diagnostic, and the print already happened.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function clearPrintLog(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function subscribeToPrintLog(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener('storage', onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}
