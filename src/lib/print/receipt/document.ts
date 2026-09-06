import type { PrintDocumentType } from '../printQueue';
import { PAGE_STYLE_ID, receiptCss, type PaperSpec } from './styles';

/**
 * The canonical print document: what every destination prints.
 *
 * ---------------------------------------------------------------------------
 * One source of truth
 * ---------------------------------------------------------------------------
 * Preview, PDF and the installed printer all receive THIS — a self-contained HTML
 * document built once from the caller's figures. There is no second template for
 * the PDF and no third for the paper; the only thing that varies is where the
 * browser is asked to send it. That is what makes "the preview shows the bill
 * but the paper is white" impossible to reintroduce by editing one and not the
 * other.
 *
 * `mustContain` is the document's own statement of what it should visibly say —
 * the reference number and the total, at least. `systemPrinter.ts` reads the
 * rendered text back out of the print frame and refuses to print if any of it is
 * missing, so an empty page is stopped before paper is fed and cut.
 */
export interface PrintDocument {
  kind: PrintDocumentType;
  /** The reference this document is about — the sale or demand number. */
  id: string;
  /** What the operating system's print queue shows. */
  title: string;
  paper: PaperSpec;
  /** A complete `<!doctype html>` document with its own stylesheet. */
  html: string;
  /** Strings that must be present in the rendered text, or nothing is printed. */
  mustContain: string[];
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** `1,234` — thousands-separated, no symbol. */
export function num(value: number): string {
  return Math.round(value).toLocaleString('en-US');
}

/** `Rs. 1,234` — symbol, a space, the figure. */
export function money(value: number, symbol: string): string {
  return `${symbol.trim()} ${num(value)}`;
}

/** Label left, value right, on one line. The receipt's basic layout primitive. */
export function kv(label: string, value: string, classes = ''): string {
  return `<div class="kv ${classes}"><span class="k">${escapeHtml(label)}</span><span class="v">${escapeHtml(value)}</span></div>`;
}

export function rule(dashed = false): string {
  return `<hr class="rule${dashed ? ' dashed' : ''}">`;
}

/**
 * The logo, only when it is already in hand as bytes.
 *
 * A `data:` URL needs no network, so the frame is printable the moment it has laid
 * out. A plain URL would put a fetch inside the print, and a fetch that fails or
 * stalls must never decide whether a bill prints — so it is left off rather than
 * waited for. The receipt is text first; the logo is a courtesy.
 */
export function logoHtml(logo: string | null | undefined): string {
  if (!logo || !logo.startsWith('data:image/')) return '';
  return `<img class="logo" src="${logo}" alt="">`;
}

/**
 * Wrap a receipt body in the full document.
 *
 * `#mb-gauge` is one paper-width wide and is what the printer route measures
 * pixels-per-millimetre against; the empty `#mb-page` style is where it writes the
 * measured page height. Both are in the document rather than injected so the
 * measurement cannot drift from the stylesheet it is measuring.
 */
export function wrapDocument(title: string, paper: PaperSpec, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="color-scheme" content="light only">
<title>${escapeHtml(title)}</title>
<style>${receiptCss(paper)}</style>
<style id="${PAGE_STYLE_ID}"></style>
</head>
<body><div id="mb-gauge"></div><div class="receipt" id="mb-receipt">${body}</div></body>
</html>`;
}
