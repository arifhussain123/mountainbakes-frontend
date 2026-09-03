'use client';

import { PosPrintError, asPrintError } from '../errors';
import { previewStyled, type PreviewLine } from '../escpos';
import type { DeviceIdentity, LinkStatus, PosTransport, PrintJob, TransportSupport } from './types';

/**
 * The printer that is already installed on this computer.
 *
 * ---------------------------------------------------------------------------
 * The problem this exists for
 * ---------------------------------------------------------------------------
 * A POS-80 series unit is installed the way every printer is installed: the
 * vendor's driver, *Printers & scanners*, set as default, prints its own test
 * page happily. And then Mountain Bakes does not detect it, because on Windows
 * an installed printer is **owned** by `usbprint.sys` — `navigator.usb` will not
 * list it, and `claimInterface` on it fails with `device-busy`. The one printer
 * the machine is most sure about is the one the other three transports here
 * cannot open at all.
 *
 * The advice that follows from that ("uninstall the driver, bind WinUSB with
 * Zadig") is correct, and it is also a thing nobody at a counter is going to do
 * on a Tuesday. So this transport takes the other road: it stops trying to open
 * the device and hands the receipt to the printer *through the driver that owns
 * it* — the same route Word and Notepad take, which is the route the driver was
 * installed for.
 *
 * ---------------------------------------------------------------------------
 * What is given up, stated plainly
 * ---------------------------------------------------------------------------
 * Three things, and none of them is hidden anywhere else in this app:
 *
 * 1. **A dialog opens**, unless the browser has been told otherwise (see kiosk
 *    printing below). The other transports never show one.
 * 2. **There is no confirmation.** `afterprint` fires identically whether the
 *    receipt printed or the dialog was cancelled, and no browser exposes the
 *    difference. So this transport reports *handed to the printer*, and that is
 *    what the log records — it never claims paper moved, because it cannot know.
 * 3. **The printer is whichever one the OS picks.** A web page cannot name,
 *    list or choose it; `TransportTarget` therefore carries nothing for this
 *    transport, and `DetectedPrinter.isSystemDefault` stays `null` because the
 *    app still cannot *read* what the system default is. Sending to it and
 *    knowing its name are separate powers, and only the first is available.
 *
 * Those are the terms. They are worth it for a till that would otherwise not
 * print at all, and they are wrong for a till that can do WebUSB — which is why
 * this is chosen in Printer Setup, and why detection offers it only when nothing
 * authorised for direct printing is working (`discovery.ts`).
 *
 * ---------------------------------------------------------------------------
 * Getting the dialog out of the way: kiosk printing
 * ---------------------------------------------------------------------------
 * Chrome and Edge started with `--kiosk-printing` send `window.print()` straight
 * to the default printer with no preview and no confirmation. On a dedicated till
 * that is a one-line change to the shortcut and it makes this path silent:
 *
 *     chrome.exe --kiosk-printing --app=https://<the app>
 *
 * That is a decision about the machine, made once, by whoever set the till up. It
 * is not something this code can turn on, and it is not something this code
 * should pretend to have turned on — so Printer Setup says the sentence and the
 * transport behaves the same either way.
 *
 * ---------------------------------------------------------------------------
 * Why an iframe, and why that is not the banned `window.print()`
 * ---------------------------------------------------------------------------
 * `globals.css` declares a global `@page { size: A4; margin: 12mm }`. Handed to
 * an 80mm roll driver that page box is what Chrome cannot render — the original
 * *"Print preview failed"* — which is why nothing in this app may call
 * `window.print()` bare.
 *
 * The receipt is printed from a **detached iframe with its own document**, so the
 * app's stylesheet does not reach it at all: no cascade to fight, no global rule
 * to inject and remember to remove, and the page on screen is neither rebuilt nor
 * hidden while it happens. The `@page` in that document is the roll, written
 * once, scoped to the one document that wants it.
 *
 * ---------------------------------------------------------------------------
 * Why the text is the same text
 * ---------------------------------------------------------------------------
 * The page is built from `previewStyled(blocks, columns)` — the exact lines the
 * ESC/POS path would print, wrapped by the same code, padded by the same column
 * maths, and carrying the same emphasis. Not an HTML re-layout of the receipt: an
 * HTML *rendering of the receipt's lines*. A till that switches between this
 * transport and USB gets the same receipt, character for character, and the
 * totals column cannot drift between the two because there is only one
 * implementation of it.
 *
 * ---------------------------------------------------------------------------
 * The one thing CSS cannot do: the browser's own header and footer
 * ---------------------------------------------------------------------------
 * The URL, the page number and the date Chrome draws on a printed page are drawn
 * *in the page margin*, and `@page { margin: 0 }` below is the whole of what a
 * document can do about them — with no margin there is no band to draw them in.
 * That is why the margin is zero here and why nothing else in this file tries.
 *
 * If they still appear, the print dialog's **Headers and footers** checkbox is
 * on, and only the person at the machine can turn it off: it is a browser
 * setting, it is remembered per user, and no page can read or change it. Turning
 * it off once, or starting the till's browser with `--kiosk-printing` (which
 * skips the dialog entirely), is the fix. This transport cannot do it and does
 * not pretend to.
 */

/** The one printer this transport can address, and it cannot name it. */
const SYSTEM_DEVICE_ID = 'system:default';
const SYSTEM_LABEL = 'System default printer';

export const SYSTEM_DEVICE = { deviceId: SYSTEM_DEVICE_ID, label: SYSTEM_LABEL } as const;

/**
 * How long to leave the print frame in the document after the dialog closes.
 *
 * Removing it on `afterprint` alone is too eager: the event fires when the dialog
 * is dismissed, and some builds are still reading the frame's layout at that
 * moment — a frame torn down there prints the last page blank. A short grace
 * period costs nothing and is invisible.
 */
const CLEANUP_DELAY_MS = 1_000;

/**
 * How long to wait for the print frame to become printable.
 *
 * Only a guard against a frame that never loads (a policy blocking `srcdoc`, an
 * extension that ate it). The normal case resolves in a few milliseconds.
 */
const FRAME_LOAD_TIMEOUT_MS = 10_000;

/**
 * A monospace character's advance, as a fraction of the font size.
 *
 * 0.6 is Courier New, which is on every Windows machine and is what the stack
 * below asks for first. It turns "48 characters across a 72mm print area" into a
 * font size, and getting it wrong is the one way this transport produces a
 * visibly broken receipt: too high and the line runs off the edge of the roll,
 * too low and the receipt prints as a narrow strip up the middle of it.
 *
 * Which is why it is only a **starting** value. Monospace fonts do not agree on
 * this — Consolas is 0.55, DejaVu Sans Mono 0.602 — and which one a given machine
 * resolves cannot be known from here. `fitToRoll` measures the real thing in the
 * loaded document and corrects the size before printing, so this constant only
 * has to be close enough that the correction is small.
 */
const MONO_ADVANCE = 0.6;

/**
 * Shaved off the fitted size so rounding cannot push the line over the edge.
 *
 * `white-space: pre` never wraps, so an overshoot does not reflow the receipt —
 * it pushes the last character or two past the print area, where the printer
 * loses them. A tenth of a percent is 0.07mm across a whole 80mm line, which is
 * invisible, and it is the difference between a total that ends in `00` and one
 * that ends in `0`.
 */
const FIT_SAFETY = 0.999;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * One rendered line as one element, carrying the emphasis ESC/POS would apply.
 *
 * This is what stops the driver page from being a flattened copy of the receipt.
 * The bytes path prints the company name double-height and the grand total bold
 * and double-height; rendered as plain text those came out identical to a line
 * item, so the one document a customer actually reads for its total had no total
 * to look at. Same lines, same padding — set the way the printer would set them.
 *
 * An empty line still needs a box, or a `feed` block collapses to nothing and the
 * receipt shortens by however many blank lines it asked for. `&nbsp;` rather than
 * a height rule, because the height then comes from the same line-height as every
 * other line instead of being a second number to keep in step.
 */
function lineHtml(line: PreviewLine): string {
  const classes = ['l'];
  if (line.style?.bold) classes.push('b');
  if (line.style?.doubleHeight) classes.push('h2');
  if (line.style?.doubleWidth) classes.push('w2');
  const text = line.text.length === 0 ? '&nbsp;' : escapeHtml(line.text);
  return `<div class="${classes.join(' ')}">${text}</div>`;
}

/**
 * The job as a printable document, sized to the roll.
 *
 * ---------------------------------------------------------------------------
 * The page box is measured, not guessed
 * ---------------------------------------------------------------------------
 * A roll wants a page exactly as long as the receipt: the driver feeds to the end
 * of it and cuts. The obvious way to ask for that is `@page { size: 80mm auto }`,
 * and it is not a way that can be relied on — `size` takes lengths *or* `auto`,
 * never a mix, so whether the declaration survives is a question about the
 * engine's parser rather than about this app. Where it is dropped the fallback
 * height applies instead, and on a continuous roll a fallback of A4 means 30cm of
 * paper fed and cut for a 10cm receipt.
 *
 * So the height here is a placeholder, and `fitDocument` replaces it with the
 * measured height of the rendered receipt before the dialog opens. That is exact,
 * it needs no `auto`, and it behaves the same in every engine — measuring the
 * thing being printed is available in a way that parser behaviour is not.
 */
function documentHtml(job: PrintJob): string {
  const lines = previewStyled(job.blocks, job.columns);
  const fontSizeMm = job.printableWidthMm / job.columns / MONO_ADVANCE;
  const body = lines.map(lineHtml).join('');
  // What `fitToRoll` measures against: a box exactly one print area wide, and a
  // line of exactly the column count in the receipt's own font. Both are in the
  // document rather than built by script, so they cannot drift from `.receipt`.
  const gauge = `<div id="mb-gauge"></div><span id="mb-probe">${'0'.repeat(job.columns)}</span>`;

  // Copies are pages of one document, not repeats of the job. Repeating the job
  // would open the dialog once per copy, which is the whole failure this avoids.
  const copies = Math.max(1, Math.trunc(job.copies));
  const pages = Array.from(
    { length: copies },
    (_, index) => `<div class="receipt${index < copies - 1 ? ' cut' : ''}">${body}</div>`,
  ).join('');

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${escapeHtml(job.title)}</title>
<style>
  @page {
    margin: 0;
    /* Replaced by fitDocument() with the receipt's measured height. This one only
       has to be long enough not to split a receipt if measuring ever fails. */
    size: ${job.paperWidthMm}mm 297mm;
  }
  html, body {
    margin: 0;
    padding: 0;
    background: #fff;
    color: #000;
  }
  :root {
    /* Replaced by the measured size before printing. The mm value is the estimate
       that stands if measuring is somehow impossible. */
    --mb-font: ${fontSizeMm.toFixed(3)}mm;
  }
  .receipt, #mb-probe {
    font-family: "Courier New", "Liberation Mono", "DejaVu Sans Mono", monospace;
    font-size: var(--mb-font);
    /* The lines are already wrapped and padded to the column count. Re-wrapping
       them here is what would make this receipt differ from the ESC/POS one, and
       it would do it silently. */
    white-space: pre;
    /*
     * Bold is the fix for faint output, and it belongs on the PROBE as well as
     * the receipt.
     *
     * A thermal driver gets a greyscale bitmap from the browser and has one ink.
     * Courier New's stems at receipt size land as mid-grey, and thresholding
     * those drops roughly half the dots in every glyph — which is the "very
     * faint, some characters unreadable" output this transport was producing,
     * and it is a rasterisation problem rather than anything the ESC/POS path
     * can suffer (there the printer sets the glyph itself, at full density).
     * Bold stems survive the threshold intact.
     *
     * Safe for the column maths only because Courier New Bold is metrically
     * identical to the regular face — same 0.6em advance — so 48 characters
     * still measure one print area. That is exactly why the weight is declared
     * on this shared selector: #mb-probe must be set in the same face it is
     * measuring, or fitDocument() scales the receipt against the wrong advance.
     */
    font-weight: bold;
    /*
     * Everything below changes glyph ADVANCE, so it has to sit on this shared
     * selector rather than on .receipt alone: #mb-probe is the ruler fitDocument()
     * scales the receipt against, and a ruler rendered in a different mode from
     * the thing it measures gives a wrong answer confidently.
     */
    font-variant-ligatures: none;
    -webkit-font-smoothing: none;
    text-rendering: geometricPrecision;
  }
  #mb-gauge {
    /* One print area wide and nothing else — the measurement target. */
    width: ${job.printableWidthMm}mm;
    height: 0;
  }
  #mb-gauge, #mb-probe {
    position: absolute;
    top: 0;
    left: 0;
    visibility: hidden;
  }
  @media print {
    /* Hidden already; this is what keeps them from claiming a page of their own. */
    #mb-gauge, #mb-probe { display: none; }
  }
  .receipt {
    /* The print area, centred on the roll by the margin the head cannot reach. */
    width: ${job.printableWidthMm}mm;
    margin: 0 auto;
    /*
     * No padding. It was 2mm top and bottom, which is 4mm of blank roll on every
     * sale and the top half of the "excessive blank paper" complaint — the rest
     * of which is the page box, measured in fitDocument(). The head already
     * cannot print in the first millimetre or so of paper, so a deliberate
     * margin on top of that is paper spent twice.
     */
    padding: 0;
    /*
     * 1.0 is what the ESC/POS path does: 24 dots of leading for a 24-dot glyph,
     * lines sitting directly under one another. This was 1.15, which is a 15%
     * longer receipt for nothing — on a 40-line demand, several centimetres of
     * roll and the "excessive vertical line spacing" that was reported.
     */
    line-height: 1;
    /* Forbid the engine lightening anything to save ink it has no concept of.
       The antialiasing settings that go with this are on the shared selector
       above, because they move glyph advances and the fit probe must match. */
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .receipt .l {
    /* Each line is its own box so it can carry its own emphasis; none of them
       may add spacing of their own on top of the line-height above. */
    margin: 0;
    padding: 0;
  }
  /*
   * Emphasis, matching what renderBlocks() sends for the same block.
   *
   * The base face is already bold (see above), so ESC E 1 cannot be reproduced
   * by going bolder — there is nowhere left to go on a one-ink device, which is
   * the same reason the printer's own bold is a modest thing. It is left as the
   * one difference between the two paths, and it is invisible on paper.
   */
  .receipt .h2 {
    /*
     * GS ! double height: twice as tall, and NOT ONE CHARACTER WIDER.
     *
     * font-size: 2em was wrong and wrong in the expensive direction. It scales
     * both axes, so a total already padded to the full 48 columns rendered 96
     * columns wide — 144mm of text on a 72mm print area — and what runs off the
     * edge of the roll is the right-hand end of the line, which is the amount.
     * The one figure that has to survive is the one it dropped.
     *
     * So the glyphs are scaled on Y alone, and the line box is given two lines
     * of room to hold them. Height is reserved by line-height (which is layout,
     * and so is what fitDocument measures) while the scale is paint only; the
     * two are set to the same factor, which is what keeps a tall line from
     * overlapping its neighbour.
     */
    line-height: 2;
    transform: scaleY(2);
  }
  .receipt .h2.w2 {
    /*
     * Both at once. transform is a single property, so the rules either side of
     * this would not combine — the later one would simply replace the earlier.
     * Nothing composes the two today, and a silently half-applied style is not
     * what should happen the day something does.
     */
    transform-origin: left center;
    transform: scale(2);
  }
  .receipt .w2 {
    /* Double width. The line's text is already half the column count (previewStyled()
       halves the width for these), so it is stretched rather than re-set — the
       character count is what has to match, and scaling keeps it exact. */
    display: inline-block;
    transform: scaleX(2);
    transform-origin: left center;
  }
  .receipt.cut {
    break-after: page;
    page-break-after: always;
  }
</style>
<!--
  Last in the head, and that position is the whole point: fitDocument() writes the
  measured page box in here, and two @page rules setting the same property are
  resolved by document order. Put this first and the placeholder above wins — the
  receipt then prints on a 297mm page, which on a continuous roll is a foot of
  paper fed and cut for every sale. It was in the wrong place once.
-->
<style id="mb-page"></style>
</head>
<body>${gauge}${pages}</body>
</html>`;
}

/**
 * Fit the rendered document to the roll: the font first, then the page box.
 *
 * Both halves are measurements of the live document rather than predictions about
 * it, and both are taken here, in the one place, because the second depends on the
 * first — resizing the text changes how tall the receipt is.
 *
 * ---------------------------------------------------------------------------
 * The font
 * ---------------------------------------------------------------------------
 * `MONO_ADVANCE` assumes Courier New. A machine without it resolves something
 * else with a different advance, and the receipt then prints narrow (harmless but
 * wrong) or over the edge of the roll (a lost digit). Neither is detectable on the
 * machine that *composed* the page — and both are trivially measurable on the one
 * that rendered it, which is what this does: compare a line of the real column
 * count against a box one print area wide, and scale the size by the ratio.
 *
 * It is the test page's ruler done in software and before the paper. The paper
 * ruler still matters — it is what catches a *printer* set to a different font,
 * which no measurement in a browser can see.
 *
 * ---------------------------------------------------------------------------
 * The page box
 * ---------------------------------------------------------------------------
 * The same gauge gives the pixels-per-millimetre of this document, so the
 * receipt's rendered height converts straight into the `@page` height. A page cut
 * to the receipt is what a roll wants; anything longer is paper fed and thrown
 * away on every sale.
 *
 * Silent on failure throughout, deliberately. If the gauges are missing or measure
 * zero, the estimate and the fallback page stand — which is right on every machine
 * that has Courier New, and in every case a receipt printed on an estimate beats
 * no receipt.
 */
function fitDocument(view: Window, printableWidthMm: number, paperWidthMm: number): void {
  try {
    const doc = view.document;
    const gauge = doc.getElementById('mb-gauge');
    const probe = doc.getElementById('mb-probe');
    if (!gauge || !probe) return;

    const target = gauge.getBoundingClientRect().width;
    const actual = probe.getBoundingClientRect().width;
    if (!(target > 0) || !(actual > 0)) return;

    // Read back what the browser resolved `--mb-font` to, in px, so the scale
    // factor applies to a number in the same unit as the measurements.
    const current = Number.parseFloat(view.getComputedStyle(probe).fontSize);
    if (Number.isFinite(current) && current > 0) {
      const fitted = ((current * target) / actual) * FIT_SAFETY;
      doc.documentElement.style.setProperty('--mb-font', `${fitted.toFixed(4)}px`);
    }

    // Read AFTER the font is set: the height being measured is the height the
    // resized text produced, not the one the estimate did.
    const pxPerMm = target / printableWidthMm;
    const receipt = doc.querySelector('.receipt');
    const page = doc.getElementById('mb-page');
    if (!receipt || !page || !(pxPerMm > 0)) return;

    const heightMm = receipt.getBoundingClientRect().height / pxPerMm;
    if (!(heightMm > 0)) return;

    // A millimetre of slack. Sub-pixel rounding in the layout can otherwise put
    // the final line a hair past the page and spill it onto a second one — which
    // on a roll is a second cut with one line of receipt on it.
    const pageHeightMm = Math.ceil(heightMm) + 1;
    page.textContent = `@page { margin: 0; size: ${paperWidthMm}mm ${pageHeightMm}mm; }`;
  } catch {
    /* A frame that cannot be read is a frame that prints on the estimate. */
  }
}

/**
 * Print one document from a frame of its own, then take the frame away.
 *
 * Resolves when the browser has finished with the dialog — printed or cancelled,
 * which are indistinguishable from here. It does not resolve *early*: returning
 * before `afterprint` would let `printerService` log a result and let the button
 * re-enable while the preview is still open, and a second press then queues a
 * second dialog behind the first.
 */
async function printInFrame(job: PrintJob): Promise<void> {
  const html = documentHtml(job);
  if (typeof document === 'undefined') {
    throw new PosPrintError('not-supported', UNSUPPORTED_REASON);
  }

  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.setAttribute('tabindex', '-1');
  frame.title = 'Receipt';
  // Off-screen rather than `display: none`: a frame that is not laid out has no
  // pages to print, and Chrome prints a blank sheet from one.
  frame.style.cssText =
    'position:fixed;left:-10000px;top:0;width:120mm;height:400mm;border:0;opacity:0;pointer-events:none;';

  const cleanup = () => {
    window.setTimeout(() => frame.remove(), CLEANUP_DELAY_MS);
  };

  document.body.appendChild(frame);

  try {
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
      frame.srcdoc = html;
    });

    const view = frame.contentWindow;
    if (!view) throw new PosPrintError('print-failed', 'The receipt could not be prepared for the printer. Try again.');

    // Before the dialog, while the document is live and measurable.
    fitDocument(view, job.printableWidthMm, job.paperWidthMm);

    await new Promise<void>((resolve, reject) => {
      let settled = false;

      /*
       * Everything this job registered, taken back down whichever way it ends.
       *
       * `{ once: true }` is not cleanup here and treating it as such leaked on
       * every receipt. It removes a listener only when that listener FIRES, and
       * in the normal case exactly one of these two does: the frame's own
       * `afterprint` arrives, the parent window's never will, and the one on
       * `window` stays registered for the life of the page — holding this
       * closure, and through it the job's bytes and the frame, from being
       * collected. A till printing a few hundred receipts a day accumulates a few
       * hundred of them, which is a page that gets slower the longer the shift
       * runs and is worst right after a print. The 60s timer had the same shape:
       * cleared on the throw path only, so every successful print left a minute
       * of retained job behind it.
       */
      let fallback = 0;
      const teardown = () => {
        window.clearTimeout(fallback);
        view.removeEventListener('afterprint', finish);
        window.removeEventListener('afterprint', finish);
      };

      function finish() {
        if (settled) return;
        settled = true;
        teardown();
        resolve();
      }

      // `afterprint` is the honest end of the job and fires for both outcomes.
      // The fallback timer is not a guess at success — it releases this promise
      // on a browser that never fires the event, so the till is not left with a
      // permanently disabled Print button.
      view.addEventListener('afterprint', finish);
      window.addEventListener('afterprint', finish);
      fallback = window.setTimeout(finish, 60_000);
      try {
        view.focus();
        view.print();
      } catch (error) {
        settled = true;
        teardown();
        reject(error);
        return;
      }
      // `window.print()` blocks in Chrome and does not in others, so the event
      // above may already have fired by the time we get here. Both are covered:
      // `finish` is idempotent.
      window.setTimeout(finish, 0);
    });
  } catch (error) {
    cleanup();
    throw asPrintError(error, 'print-failed');
  }

  cleanup();
}

const UNSUPPORTED_REASON =
  'This browser cannot open a print dialog, so the printer installed on this computer cannot be reached from here.';

/**
 * The transport. Almost every method is a statement about what cannot be known.
 *
 * There is no link to open, so `restore` and `release` have nothing to do;
 * there is no device to enumerate, so `discover` answers with the one entry that
 * is always true when a print dialog exists. Everything real happens in `send`.
 */
export const systemPrintTransport: PosTransport = {
  type: 'system',

  /**
   * Supported wherever there is a print dialog — which is everywhere, including
   * the browsers the other three transports rule out.
   *
   * That is the point of it: Firefox and Safari cannot do WebUSB, Web Serial or
   * a raw socket, and this is the one path in this file that works on them.
   */
  support(): TransportSupport {
    if (typeof window === 'undefined' || typeof window.print !== 'function') {
      return { supported: false, reason: UNSUPPORTED_REASON };
    }
    return { supported: true };
  },

  /** Nothing to re-adopt. The route either exists in this browser or it does not. */
  async restore(): Promise<DeviceIdentity | null> {
    return this.support().supported ? { ...SYSTEM_DEVICE } : null;
  },

  /**
   * The one entry, and what it does and does not assert.
   *
   * It says: *this machine has a print path, and Mountain Bakes can send a
   * receipt down it.* It does not say a printer is installed, switched on, or
   * loaded with paper — the operating system owns all three and tells a web page
   * none of them. `discovery.ts` therefore offers this only when no device has
   * been authorised for direct printing, so it is a route out of "nothing works"
   * rather than a competitor to a printer this app can actually open and check.
   */
  async discover(): Promise<DeviceIdentity[]> {
    return this.support().supported ? [{ ...SYSTEM_DEVICE }] : [];
  },

  /** No chooser exists for this — the operating system's choice is the choice. */
  async request(): Promise<DeviceIdentity> {
    const support = this.support();
    if (!support.supported) throw new PosPrintError('not-supported', support.reason ?? UNSUPPORTED_REASON);
    return { ...SYSTEM_DEVICE };
  },

  /**
   * There is nothing to probe, and this says so by answering about the route.
   *
   * Every other transport's `probe` opens a device, which is real evidence. Here
   * there is no device and no handshake: the only thing that can be checked
   * without printing is that this browser has a print path. Printer Setup
   * therefore leads with **Test Print** for this connection rather than *Test
   * Connection*, because a page coming out of the printer is the only proof
   * available and it is a perfectly good one.
   */
  async probe(): Promise<DeviceIdentity> {
    const support = this.support();
    if (!support.supported) throw new PosPrintError('not-supported', support.reason ?? UNSUPPORTED_REASON);
    return { ...SYSTEM_DEVICE };
  },

  async send(_target, job): Promise<void> {
    const support = this.support();
    if (!support.supported) throw new PosPrintError('not-supported', support.reason ?? UNSUPPORTED_REASON);
    if (!job.blocks.length) {
      throw new PosPrintError('invalid-document', 'There was nothing to print.');
    }
    await printInFrame(job);
  },

  /**
   * `connected` here means the route is open, not that a printer answered.
   *
   * It is the strongest true statement available — the same shape as the network
   * transport's freshness claim, and for the same reason: nothing on the other
   * side of this can be interrogated. The sentence that keeps it from being read
   * as more than it is travels with the detected printer in `discovery.ts`.
   */
  async status(): Promise<LinkStatus> {
    const support = this.support();
    if (!support.supported) return { state: 'unsupported', reason: support.reason };
    return { state: 'connected', device: { ...SYSTEM_DEVICE } };
  },

  async release(): Promise<void> {
    /* Nothing is held. The driver owns the device and always did. */
  },
};
