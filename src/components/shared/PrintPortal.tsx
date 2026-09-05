'use client';

import { useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** Never fires — `mounted` only ever flips once, at hydration. */
const noop = () => () => {};

/**
 * Renders print-only content as a direct child of `<body>`.
 *
 * `@media print` in `globals.css` reveals `.print-area` and positions it
 * `absolute; top: 0; left: 0` so it fills the page. An absolutely positioned
 * element is laid out inside — and clipped by — its nearest positioned or
 * transformed ancestor, and `DialogContent` is all three at once: `fixed`,
 * `overflow-y-auto` with a `max-h`, and `-translate-x/y-1/2` on md and up.
 * Print content rendered inside a dialog therefore lands in the dialog's own
 * box and gets cropped to it, which is why the slip came out blank or with only
 * a sliver of the first page. Page breaks can't paginate out of a clipped
 * scroll container either.
 *
 * Portalling to `<body>` removes every one of those ancestors, so the print
 * rules apply against the page box as they were written to.
 *
 * ---------------------------------------------------------------------------
 * `active` — mount the document only while it is being printed
 * ---------------------------------------------------------------------------
 * Pass `printing` from `useDocumentPrint`. While it is `false` nothing is
 * rendered at all — not hidden, absent — so the dialog's own re-renders (every
 * keystroke in a quantity field) no longer rebuild two invisible copies of the
 * slip, and the browser's print pass lays out one document rather than the
 * biggest DOM on the screen. Omitting it keeps the old always-mounted
 * behaviour, for a surface whose print DOM is small and whose button cannot
 * wait a frame.
 *
 * Children stay hidden on screen — the wrapper carries `print-only`, so do NOT
 * put anything here that needs to be visible in the browser.
 */
export function PrintPortal({ children, active = true }: { children: ReactNode; active?: boolean }) {
  // The static export prerenders this on the server, where `document` does not
  // exist; gate on hydration so the portal is only created in the browser.
  const mounted = useSyncExternalStore(noop, () => true, () => false);

  if (!mounted || !active) return null;
  return createPortal(<div className="print-area print-only">{children}</div>, document.body);
}
