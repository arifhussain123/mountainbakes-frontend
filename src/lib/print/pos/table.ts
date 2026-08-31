import type { Block, TextBlock } from './escpos';

/**
 * The fixed-column table formatter — PRODUCT | QTY | RATE | AMOUNT.
 *
 * ---------------------------------------------------------------------------
 * Why a formatter and not four padded strings at the call site
 * ---------------------------------------------------------------------------
 * Because the failure modes are silent and expensive. "Chocolate Truffle
 * Celebration Cake 2lb" is 41 characters on a 48-character roll; padded naively
 * it pushes RATE and AMOUNT past the edge of the paper, and what the customer is
 * handed is a receipt whose total has been trimmed off by the print head. Nobody
 * notices until a dispute.
 *
 * Two rules follow from that, and everything here exists to keep them:
 *
 *   1. **The name wraps; the figures never move.** The name column has a hard
 *      ceiling and continuation lines carry the rest of it and nothing else, so
 *      QTY, RATE and AMOUNT sit at the same offset on every row of every receipt.
 *   2. **A figure is never truncated and never touches its neighbour.** Widths
 *      are MEASURED from the rows being printed rather than guessed as a
 *      percentage of the roll, and every column is separated by a real space.
 *
 * Rule 2 is not theoretical. A proportional guess gives RATE six characters on a
 * 58mm roll, and a twelve-thousand-rupee cake prints `112,500` — a quantity of 1
 * fused to a rate of 12,500, which reads as neither. Measuring first costs one
 * pass over the rows and makes that unrepresentable.
 *
 * Every row this produces is exactly `columns` characters wide, which is what
 * lets `escpos.wrap` pass it through untouched (see the note on that function —
 * a row it decided to re-flow would have its padding collapsed and the column
 * would go ragged).
 */

/** One space between columns, always, so a full-width figure still reads apart from its neighbour. */
const GAP = 1;

/**
 * Below this the name column stops being a product name and starts being an
 * abbreviation nobody can check a delivery against. When the figures are wide
 * enough to push it under this, the row stacks instead — see `tableRow`.
 */
const NAME_FLOOR = 10;

export interface ColumnLayout {
  /** Total line width, from the printer profile. */
  columns: number;
  name: number;
  qty: number;
  rate: number;
  amount: number;
  /**
   * `true` when the figures cannot share a line with a usable name column, so
   * each item prints as its name followed by an indented `qty x rate … amount`
   * line. Narrow rolls and five-figure prices; never the 80mm case.
   */
  stacked: boolean;
}

/** What the layout has to hold. Passed as pre-formatted strings — the formatter owns the number formatting. */
export interface TableCells {
  productName: string;
  qty: string;
  rate: string;
  amount: string;
}

/**
 * Column widths measured against the rows that will actually print.
 *
 * The headings count too: a `QTY` column narrower than the word "QTY" would put
 * the heading over the wrong column, which is a subtler version of the same bug.
 */
export function columnLayout(columns: number, rows: readonly TableCells[]): ColumnLayout {
  const widest = (pick: (row: TableCells) => string, heading: string) =>
    rows.reduce((max, row) => Math.max(max, pick(row).length), heading.length);

  const qty = widest((r) => r.qty, 'QTY');
  const rate = widest((r) => r.rate, 'RATE');
  const amount = widest((r) => r.amount, 'AMOUNT');
  const name = columns - amount - rate - qty - GAP * 3;

  if (name < NAME_FLOOR) {
    return { columns, name: columns, qty, rate, amount, stacked: true };
  }
  return { columns, name, qty, rate, amount, stacked: false };
}

function padLeft(text: string, width: number): string {
  // No slice on overflow. Widths are measured from these very strings, so an
  // overflow here means the layout was built from different rows than the ones
  // being printed — and a receipt one character wide is a far better symptom
  // than an amount quietly missing its leading digit.
  return text.length >= width ? text : ' '.repeat(width - text.length) + text;
}

function padRight(text: string, width: number): string {
  return text.length >= width ? text.slice(0, width) : text + ' '.repeat(width - text.length);
}

/**
 * Break a product name into pieces that fit the name column.
 *
 * Word-wrapped, with a hard split for a single word longer than the column — a
 * SKU-style name with no spaces still has to reach the paper rather than being
 * truncated into something that names a different product.
 */
export function wrapName(name: string, width: number): string[] {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [''];

  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= width) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = word;
    while (current.length > width) {
      lines.push(current.slice(0, width));
      current = current.slice(width);
    }
  }
  if (current) lines.push(current);
  return lines;
}

/** The column headings, on one line, aligned with the rows beneath. */
export function tableHeader(layout: ColumnLayout): TextBlock {
  if (layout.stacked) {
    // One heading pair, because in stacked mode there is one figure per line and
    // three headings would name columns that are not there.
    return {
      kind: 'text',
      text: padRight('PRODUCT', layout.columns - 'AMOUNT'.length) + 'AMOUNT',
      style: { bold: true },
    };
  }
  const text =
    padRight('PRODUCT', layout.name) +
    ' '.repeat(GAP) + padLeft('QTY', layout.qty) +
    ' '.repeat(GAP) + padLeft('RATE', layout.rate) +
    ' '.repeat(GAP) + padLeft('AMOUNT', layout.amount);
  return { kind: 'text', text, style: { bold: true } };
}

/**
 * One item, as one or more lines.
 *
 * In the normal (columnar) case the figures go on the FIRST line rather than the
 * last. A row read top to bottom then reads "Chocolate Truffle | 1 | 12,500 |
 * 12,500" / "Celebration Cake", which is the order the information is wanted in;
 * putting the figures on the last line would leave the eye scanning down a column
 * of names for where the numbers restart.
 *
 * In stacked mode the arithmetic moves to its own indented line under the name,
 * which is the only honest layout when the roll cannot hold both.
 */
export function tableRow(row: TableCells, layout: ColumnLayout): Block[] {
  if (layout.stacked) {
    const blocks: Block[] = [];
    for (const line of wrapName(row.productName, layout.columns)) {
      blocks.push({ kind: 'text', text: padRight(line, layout.columns) });
    }
    blocks.push(amountRow(`  ${row.qty} x ${row.rate}`, row.amount, layout.columns));
    return blocks;
  }

  const lines = wrapName(row.productName, layout.name);
  const first =
    padRight(lines[0] ?? '', layout.name) +
    ' '.repeat(GAP) + padLeft(row.qty, layout.qty) +
    ' '.repeat(GAP) + padLeft(row.rate, layout.rate) +
    ' '.repeat(GAP) + padLeft(row.amount, layout.amount);

  const blocks: Block[] = [{ kind: 'text', text: first }];
  for (const continuation of lines.slice(1)) {
    // Padded to the full line width, not just the name column: an unpadded
    // continuation is shorter than `columns`, and a later edit that centred or
    // right-aligned the table would move it out from under the name.
    blocks.push({ kind: 'text', text: padRight(continuation, layout.columns) });
  }
  return blocks;
}

/**
 * A label on the left and an amount hard against the right edge.
 *
 * Not `align: 'right'` on the block — that would push the label right as well.
 * The pad is measured against the full column count because every row that uses
 * this is single-width; a double-width one would have to halve it, and the only
 * one that could be (the grand total) is deliberately double *height* instead.
 *
 * A pair too long for the line keeps one space between them and overflows, which
 * the wrapper then breaks. That beats truncating: the amount is the one thing on
 * a receipt that has to be readable in full.
 */
export function amountRow(label: string, amount: string, columns: number): TextBlock {
  const slack = columns - label.length - amount.length;
  return { kind: 'text', text: `${label}${' '.repeat(Math.max(1, slack))}${amount}` };
}

/**
 * Two label/value pairs sharing one line — the compact header block.
 *
 * "Date: 31/08/2026" and "Time: 09:30 PM" belong beside each other, not as two of
 * four stacked sections that push the actual order off the top of the receipt.
 * Where the roll genuinely cannot hold both (58mm, a long reference) they fall
 * back to a line each rather than colliding: a header that ran two values
 * together would be worse than one that took an extra line.
 */
export function pairRow(left: string, right: string, columns: number): Block[] {
  const slack = columns - left.length - right.length;
  if (slack < 2) {
    return [
      { kind: 'text', text: left },
      { kind: 'text', text: right },
    ];
  }
  return [{ kind: 'text', text: `${left}${' '.repeat(slack)}${right}` }];
}
