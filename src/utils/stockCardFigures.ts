import type { StockRow } from '@mb/shared';

/** How a figure is coloured on the phone card: green for a rise, red for anything negative, plain text otherwise. */
export type StockFigureTone = 'positive' | 'negative' | 'neutral';

export interface StockCardFigure {
  key: 'opening' | 'newQty' | 'sold' | 'returned' | 'adjustment' | 'waitingDemand' | 'expectedBalance';
  label: string;
  value: string;
  tone: StockFigureTone;
}

/**
 * Waiting demand for this row, or why there is none to show:
 * `'not-today'` — a past business day, where unverified demand describes no
 * moment that existed (the desktop table drops the columns for the same
 * reason); `'loading'` — today, but the production orders have not arrived,
 * and unknown must not read as 0.
 */
export type WaitingDemand = number | 'not-today' | 'loading';

/** `+N` / `-N`, and a bare "0" — never "+0" or "-0" (negating a zero sold figure gives -0). */
const signed = (n: number) => (n > 0 ? `+${n.toLocaleString()}` : n < 0 ? n.toLocaleString() : '0');
const toneOf = (n: number): StockFigureTone => (n > 0 ? 'positive' : n < 0 ? 'negative' : 'neutral');
/** A level (opening, expected, stock) is only flagged once it goes negative — holding stock is not a "gain". */
const levelTone = (n: number): StockFigureTone => (n < 0 ? 'negative' : 'neutral');

/**
 * The phone card's seven columns in their fixed order — Opening Stock, New
 * Stock, Sold, Return, Adjust, Waiting, Expected. Display only: every value
 * is the row's own field, signed the way the desktop table signs it (sold and
 * returned as negatives, adjustment ±, waiting as `+N` because it lands in New
 * Stock once verified), and Expected is `balance + waiting` exactly as the
 * desktop Expected Balance column computes it. A zero always reads "0".
 */
export function stockCardFigures(row: StockRow, waiting: WaitingDemand): StockCardFigure[] {
  const known = typeof waiting === 'number';
  const expected = known ? row.balance + waiting : null;
  return [
    { key: 'opening', label: 'Opening Stock', value: row.opening.toLocaleString(), tone: levelTone(row.opening) },
    { key: 'newQty', label: 'New Stock', value: signed(row.newQty), tone: toneOf(row.newQty) },
    { key: 'sold', label: 'Sold', value: signed(-row.sold), tone: toneOf(-row.sold) },
    { key: 'returned', label: 'Return', value: signed(-row.returned), tone: toneOf(-row.returned) },
    { key: 'adjustment', label: 'Adjust', value: signed(row.adjustment), tone: toneOf(row.adjustment) },
    { key: 'waitingDemand', label: 'Waiting', value: known ? signed(waiting) : '—', tone: known ? toneOf(waiting) : 'neutral' },
    {
      key: 'expectedBalance',
      label: 'Expected',
      value: expected === null ? '—' : expected.toLocaleString(),
      tone: expected === null ? 'neutral' : levelTone(expected),
    },
  ];
}

/** The card's "Stock" line — the row's live balance, red only when negative. */
export function stockBalanceTone(balance: number): StockFigureTone {
  return levelTone(balance);
}
