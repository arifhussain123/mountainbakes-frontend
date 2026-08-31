/**
 * ESC/POS — the command language every thermal receipt printer speaks.
 *
 * ---------------------------------------------------------------------------
 * Why the web app builds printer bytes at all
 * ---------------------------------------------------------------------------
 * Because HTML is the wrong output. `window.print()` hands the page to the
 * browser's layout engine, which asks the driver for a page box, renders a
 * bitmap and shows a preview — three steps a receipt printer neither needs nor
 * benefits from, and the first of which is what produced "Print preview failed"
 * (an A4 `@page` asked of an 80mm roll). A thermal printer already knows how to
 * set text; it wants the text, not a picture of it.
 *
 * So the receipt is composed here as bytes and handed to the local print agent,
 * which spools them raw. No layout engine, no page box, no dialog.
 *
 * ---------------------------------------------------------------------------
 * Its sibling on mobile
 * ---------------------------------------------------------------------------
 * `mobile/src/common/printing/escpos.ts` is the same command set for the React
 * Native app, and the two are deliberately parallel — same `Block` model, same
 * wrap rules, same transliteration table — so a receipt printed from the counter
 * tablet and one printed from the till read identically. They are separate files
 * rather than a shared module because the runtimes disagree about primitives
 * this low: Hermes has no `btoa`, the browser has no `Buffer`. Keep them in step
 * by hand when either changes; there is nothing mechanical enforcing it.
 *
 * A command is a byte sequence. `[0x1B, 0x40]` is "reset". Nothing here is
 * device-specific — these are the standard Epson commands the BlackCopper 80mm
 * and every printer of its class implement. What IS device-specific, namely how
 * many characters fit across the roll, lives in `profiles.ts`.
 */

/** Escape. Introduces most commands. */
const ESC = 0x1b;
/** Group separator. Introduces the print-mode and cut commands. */
const GS = 0x1d;
const LF = 0x0a;

export type Align = 'left' | 'center' | 'right';

export interface TextStyle {
  bold?: boolean;
  /** Twice as wide — halves how many characters fit on the line. */
  doubleWidth?: boolean;
  /** Twice as tall. Costs no horizontal room, so it needs no column maths. */
  doubleHeight?: boolean;
}

/**
 * One piece of a document, before it becomes bytes.
 *
 * Blocks rather than a byte stream built inline, because the same list has two
 * consumers: `renderBlocks` turns it into ESC/POS, and `preview` turns it into
 * the plain text the in-app receipt preview shows. That second consumer is what
 * makes the internal preview honest — it is the same wrapping and the same
 * column maths the printer will apply, not a separate HTML approximation of it.
 */
export type Block =
  | { kind: 'text'; text: string; align?: Align; style?: TextStyle }
  /** A full-width rule of `-`, drawn to the profile's column count. */
  | { kind: 'rule' }
  | { kind: 'feed'; lines: number };

/** The text variant on its own, for builders that always produce one. */
export type TextBlock = Extract<Block, { kind: 'text' }>;

/**
 * Reset the printer, then set the code page.
 *
 * `ESC @` clears whatever the last job left behind — a double-width flag, an
 * alignment, a line spacing. Without it a receipt inherits the state of the one
 * before it, which shows up as the second sale of the day printing entirely in
 * double width because the first ended mid-heading.
 *
 * `ESC t 0` selects code page 0 (CP437). Everything sent is transliterated to
 * ASCII by `encode`, so the page choice only decides what a stray byte would
 * look like — but pinning it means that answer does not depend on how the
 * printer was last configured.
 */
export function init(): number[] {
  return [ESC, 0x40, ESC, 0x74, 0x00];
}

/** `ESC a n` — 0 left, 1 centre, 2 right. The printer does the padding. */
export function alignTo(align: Align): number[] {
  const n = align === 'center' ? 1 : align === 'right' ? 2 : 0;
  return [ESC, 0x61, n];
}

/**
 * `ESC E n` for emphasis and `GS ! n` for size, as one call.
 *
 * Both are sent every time, including when the style is empty — that is what
 * makes a block's appearance depend on the block rather than on what preceded
 * it. Sending only the changes is the same bug `ESC @` guards against, one scope
 * down.
 */
export function styleTo(style: TextStyle | undefined): number[] {
  const bold = style?.bold ? 1 : 0;
  // GS ! packs width in the high nibble and height in the low one.
  const size = (style?.doubleWidth ? 0x10 : 0) | (style?.doubleHeight ? 0x01 : 0);
  return [ESC, 0x45, bold, GS, 0x21, size];
}

export function feed(lines: number): number[] {
  const n = Math.max(0, Math.min(255, Math.trunc(lines)));
  return [ESC, 0x64, n];
}

/**
 * Feed clear of the head, then ask for a partial cut.
 *
 * The feed is not optional: the cutter sits a couple of centimetres past the
 * print head, so cutting without it slices through the last lines of the
 * receipt. Three lines is the usual clearance.
 *
 * `GS V 1` is a partial cut — it leaves a small tab so the receipt stays
 * attached until torn. A printer with no cutter fitted ignores the command
 * rather than faulting, which is why it is sent unconditionally: the alternative
 * is a per-model flag that would be wrong for half the units in the field.
 */
export function cut(): number[] {
  return [...feed(3), GS, 0x56, 0x01];
}

/**
 * Text as CP437-safe bytes, transliterated rather than escaped.
 *
 * A thermal printer has no Unicode. Handed a `—` it prints whatever glyph sits
 * at that byte in its current code page, usually a box-drawing character. The
 * app's own strings are full of typographic punctuation — an em dash in every
 * slip heading, `×` between quantity and rate — so this is not a theoretical
 * case.
 *
 * The map covers what the app actually emits. Anything else non-ASCII becomes
 * `?`: visible, one character wide, and honest about having lost something. The
 * alternative, dropping it, silently shortens a product name and leaves nobody a
 * reason to look.
 *
 * This means a product named in Urdu prints as question marks. Making that work
 * needs the printer's own code page for the script plus a per-model table, and
 * it should not be hidden behind a `?` — the test page says so in as many words.
 */
export function encode(text: string): number[] {
  const out: number[] = [];
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0x3f;
    if (code >= 0x20 && code <= 0x7e) {
      out.push(code);
      continue;
    }
    const mapped = TRANSLITERATION[char];
    if (mapped !== undefined) {
      for (let i = 0; i < mapped.length; i++) out.push(mapped.charCodeAt(i));
      continue;
    }
    // Tabs and newlines are structure, not text: a caller that wants a new line
    // emits a block. A literal one here would desynchronise the column maths.
    out.push(0x3f);
  }
  return out;
}

/** Only what the app's own formatters and copy actually produce. */
const TRANSLITERATION: Readonly<Record<string, string>> = {
  '—': '-',
  '–': '-',
  '−': '-',
  '·': '-',
  '×': 'x',
  '•': '*',
  '…': '...',
  '‘': "'",
  '’': "'",
  '“': '"',
  '”': '"',
  '₨': 'Rs.',
  '₹': 'Rs.',
  ' ': ' ',
  ' ': ' ',
  ' ': ' ',
};

/**
 * How many characters of the profile's width one block occupies per column.
 * Double width halves the line; double height costs nothing horizontally.
 */
function widthFactor(style: TextStyle | undefined): number {
  return style?.doubleWidth ? 2 : 1;
}

/**
 * Break `text` to fit `width`, splitting on spaces and hard-splitting a word
 * that cannot fit on a line of its own.
 *
 * **A line that already fits is returned untouched, and that is load-bearing
 * rather than an optimisation.** Every totals row and every table row arrives
 * here already padded — `amountRow` builds `TOTAL` + 28 spaces + the amount —
 * and the re-flow below splits on `/\s+/` and rejoins with single spaces, which
 * would collapse that run to one space and hand the printer a left-ragged column
 * of amounts. Only a line that has to be broken gets its whitespace normalised,
 * where losing the original spacing is unavoidable anyway.
 */
export function wrap(text: string, width: number): string[] {
  if (width <= 0) return [text];
  const out: string[] = [];
  for (const paragraph of text.split('\n')) {
    if (paragraph.length <= width) {
      out.push(paragraph);
      continue;
    }
    let current = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (current === '') {
        current = word;
      } else if (current.length + 1 + word.length <= width) {
        current = `${current} ${word}`;
      } else {
        out.push(current);
        current = word;
      }
      // A single word longer than the line: emit full-width pieces until the
      // remainder fits, rather than letting the printer wrap it wherever.
      while (current.length > width) {
        out.push(current.slice(0, width));
        current = current.slice(width);
      }
    }
    out.push(current);
  }
  return out;
}

/**
 * The blocks as the plain text they will print as — what the in-app preview
 * shows and what a reviewer reads.
 *
 * Same wrapping and same rules as `renderBlocks`, so a line that fits here fits
 * on the roll. Alignment is applied by padding, which the printer does itself
 * for real; that difference is invisible in the output because a receipt is
 * monospaced.
 */
export function preview(blocks: readonly Block[], columns: number): string[] {
  const out: string[] = [];
  for (const block of blocks) {
    if (block.kind === 'rule') {
      out.push('-'.repeat(columns));
      continue;
    }
    if (block.kind === 'feed') {
      for (let i = 0; i < block.lines; i++) out.push('');
      continue;
    }
    const width = Math.floor(columns / widthFactor(block.style));
    for (const line of wrap(block.text, width)) {
      out.push(pad(line, width, block.align ?? 'left'));
    }
  }
  return out;
}

function pad(line: string, width: number, align: Align): string {
  if (align === 'left' || line.length >= width) return line;
  const slack = width - line.length;
  if (align === 'right') return ' '.repeat(slack) + line;
  return ' '.repeat(Math.floor(slack / 2)) + line;
}

/**
 * The blocks as ESC/POS bytes, ready for the print agent.
 *
 * Ends with `cut` and a reset. The reset matters as much as the one at the
 * start: it is what stops a receipt that ended in double-width bold from leaving
 * the printer that way for whatever the next job turns out to be — including a
 * job sent by a different application.
 */
export function renderBlocks(blocks: readonly Block[], columns: number): number[] {
  const bytes: number[] = [...init()];

  for (const block of blocks) {
    if (block.kind === 'rule') {
      bytes.push(...alignTo('left'), ...styleTo(undefined), ...encode('-'.repeat(columns)), LF);
      continue;
    }
    if (block.kind === 'feed') {
      bytes.push(...feed(block.lines));
      continue;
    }
    bytes.push(...alignTo(block.align ?? 'left'), ...styleTo(block.style));
    for (const line of wrap(block.text, Math.floor(columns / widthFactor(block.style)))) {
      bytes.push(...encode(line), LF);
    }
  }

  bytes.push(...alignTo('left'), ...styleTo(undefined), ...cut(), ...init());
  return bytes;
}

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Bytes as base64, which is how they cross to the print agent.
 *
 * `btoa` is used where it exists and this loop is the fallback — not the other
 * way round, and not `btoa` alone. `btoa` throws on any code unit above 0xFF, so
 * it can only be fed a binary string built one `String.fromCharCode` at a time,
 * and that intermediate is both an allocation per byte and an easy place for a
 * future edit to hand it real text by mistake. Encoding from the number array
 * directly cannot go wrong that way. Input is masked to a byte — a value out of
 * range is a bug in a command builder above, and truncating it quietly would
 * send the printer a byte nobody wrote.
 */
export function toBase64(bytes: readonly number[]): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = (bytes[i] ?? 0) & 0xff;
    const b1 = (bytes[i + 1] ?? 0) & 0xff;
    const b2 = (bytes[i + 2] ?? 0) & 0xff;
    const triple = (b0 << 16) | (b1 << 8) | b2;

    out += BASE64_ALPHABET[(triple >> 18) & 0x3f];
    out += BASE64_ALPHABET[(triple >> 12) & 0x3f];
    out += i + 1 < bytes.length ? BASE64_ALPHABET[(triple >> 6) & 0x3f] : '=';
    out += i + 2 < bytes.length ? BASE64_ALPHABET[triple & 0x3f] : '=';
  }
  return out;
}
