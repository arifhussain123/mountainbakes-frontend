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
}

const KEY = 'mb.posPrintLog';
const LIMIT = 200;
const CHANGE_EVENT = 'mb:pos-print-log';

export function readPrintLog(): PrintLogEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PrintLogEntry[]) : [];
  } catch {
    return [];
  }
}

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
