'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { printDocument, whenPrintAreaReady, type PrintDocumentOptions } from '@/lib/print/browser/documentPrint';

/**
 * A browser print whose document exists only while it is being printed.
 *
 * ---------------------------------------------------------------------------
 * The problem
 * ---------------------------------------------------------------------------
 * The surfaces that print a document through the dialog — the production slip,
 * the sale invoice, the daily-sale sheet — used to keep their print DOM mounted
 * in a `PrintPortal` for the whole life of the dialog, hidden with
 * `display: none`. Hidden is not free: every re-render of the dialog (each
 * keystroke in an Approved-quantity field, each status tick) re-rendered the
 * Customer Copy, the Company Copy and the check sheet along with it — two or
 * three full tables nobody could see, for a print that might never happen. And
 * the print itself then handed the browser the largest DOM of the session to
 * lay out under print media.
 *
 * ---------------------------------------------------------------------------
 * The shape now
 * ---------------------------------------------------------------------------
 *   press → `printing = true` → the portal mounts the print DOM
 *         → next frame, images decoded → `window.print()`
 *         → `afterprint` → `printing = false` → the portal unmounts it
 *
 * So the print DOM costs nothing until the press, is measured once by the
 * browser, and is gone the moment the dialog closes. `window.print()` itself is
 * still modal in Chrome — no page can change that — but what it has to lay out
 * is the document and nothing else.
 *
 * Pass `printing` to `<PrintPortal active={printing}>` and call `print()` from
 * the button. Any option (`paper`, `onAfterPrint`) goes through unchanged.
 */

/** A print that never reports back must not leave the surface stuck. */
const SETTLE_FALLBACK_MS = 120_000;

export interface DocumentPrint {
  /** `true` from the press until the dialog has been dismissed. Mount the print DOM on it. */
  printing: boolean;
  /** Start a print. A second call while one is open is ignored. */
  print: (options?: PrintDocumentOptions) => void;
}

export function useDocumentPrint(): DocumentPrint {
  const [printing, setPrinting] = useState(false);
  const pending = useRef<PrintDocumentOptions | null>(null);

  const print = useCallback((options: PrintDocumentOptions = {}) => {
    pending.current = options;
    setPrinting(true);
  }, []);

  useEffect(() => {
    if (!printing) return;
    let cancelled = false;
    let settled = false;
    const options = pending.current ?? {};
    pending.current = null;

    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(fallback);
      if (!cancelled) setPrinting(false);
      options.onAfterPrint?.();
    };
    const fallback = window.setTimeout(finish, SETTLE_FALLBACK_MS);

    // The portal has committed its children by the time this effect runs; what
    // is still outstanding is layout and any logo the sheet carries. Waiting for
    // both is what stops a blank sheet or a missing logo in the preview.
    void whenPrintAreaReady().then(() => {
      if (cancelled) return;
      printDocument({ ...options, onAfterPrint: finish });
    });

    return () => {
      cancelled = true;
      window.clearTimeout(fallback);
    };
  }, [printing]);

  return { printing, print };
}
