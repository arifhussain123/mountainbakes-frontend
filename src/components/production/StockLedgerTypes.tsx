'use client';

import type { ProductionLedgerType } from '@mb/shared';
import { cn } from '@/lib/utils';

/**
 * How each ledger transaction type reads on screen (§13).
 *
 * Colour carries DIRECTION, not category: everything that adds to the pool is
 * emerald, everything that takes from it is red or amber, and the two derived
 * bookends are neutral. Someone scanning the column should be able to tell "did
 * stock go up or down" without reading a single word — which is also why the
 * quantity beside it is always rendered signed.
 *
 * DEMAND_RESERVED is amber rather than red because nothing has actually moved: it
 * is a claim on the shelf, not a withdrawal from it, and colouring it like a
 * fulfilment would make an unverified demand look like goods already gone.
 */
export const LEDGER_TYPE_META: Record<
  ProductionLedgerType,
  { label: string; className: string }
> = {
  OPENING: { label: 'Opening', className: 'bg-muted text-muted-foreground' },
  PREPARED: { label: 'Prepared', className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400' },
  DEMAND_RESERVED: { label: 'Demand reserved', className: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400' },
  DEMAND_FULFILLED: { label: 'Demand fulfilled', className: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400' },
  SALE: { label: 'Sale', className: 'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-400' },
  RETURN: { label: 'Return', className: 'bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-400' },
  ADJUSTMENT_IN: { label: 'Adjustment in', className: 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-400' },
  ADJUSTMENT_OUT: { label: 'Adjustment out', className: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400' },
  CLOSING: { label: 'Closing', className: 'bg-muted text-muted-foreground font-semibold' },
};

/** The types a human can filter by, in ledger order rather than alphabetically. */
export const LEDGER_TYPE_OPTIONS: ProductionLedgerType[] = [
  'PREPARED',
  'DEMAND_FULFILLED',
  'SALE',
  'RETURN',
  'ADJUSTMENT_IN',
  'ADJUSTMENT_OUT',
];

/**
 * Defensive for the same reason as the status chip: the ledger vocabulary is
 * decided server-side, so a client one release ahead of the API can be handed a
 * type it has no entry for. An unknown type renders as itself rather than
 * throwing and taking the page down.
 */
export function LedgerTypeChip({ type }: { type: ProductionLedgerType | undefined }) {
  const meta = type ? LEDGER_TYPE_META[type] : undefined;
  if (!meta) {
    return (
      <span className="inline-flex whitespace-nowrap rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
        {type ?? '—'}
      </span>
    );
  }
  return (
    <span className={cn('inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium', meta.className)}>
      {meta.label}
    </span>
  );
}

/**
 * A signed movement quantity.
 *
 * Always shows the sign, including on positives. A bare "40" in a column that also
 * holds "-40" forces the reader to check the type chip to know which way it went;
 * "+40" does not.
 */
export function LedgerQty({ qty }: { qty: number }) {
  if (!qty) return <span className="tabular-nums text-muted-foreground">0</span>;
  return (
    <span
      className={cn(
        'font-medium tabular-nums',
        qty > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400',
      )}
    >
      {qty > 0 ? `+${qty}` : qty}
    </span>
  );
}
