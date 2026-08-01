import type { Cell, Row, RowData } from '@tanstack/react-table';

/**
 * Where a column's cell lands when {@link DataTable} renders a row as a card
 * below `md`.
 *
 * Every role is optional. An un-annotated table still produces a usable card:
 * the first cell becomes the title and the `actions` column is detected by id.
 * Annotate only the columns that read wrong.
 */
export type MobileRole =
  /** Card headline. First one wins; any later 'title' falls back to a field. */
  | 'title'
  /** Muted line directly under the title — SKU, reference number, phone. */
  | 'subtitle'
  /** Top-right of the card head. Status pills. */
  | 'badge'
  /** A label:value pair in the field grid. The default — never needs writing. */
  | 'meta'
  /** Card footer. Auto-detected when `column.id === 'actions'`. */
  | 'actions'
  /** Dropped on mobile — noise that only earns its keep in a wide table. */
  | 'hidden';

/**
 * Extra per-column hints read by the mobile card renderer.
 *
 * Declaration merging into TanStack's intentionally-empty `ColumnMeta`. Two
 * things about this that are easy to get wrong:
 *
 *  - It augments `@tanstack/react-table`, not `@tanstack/table-core`. Only the
 *    former is a direct dependency, so under pnpm's isolated node_modules the
 *    latter would not resolve from app code.
 *  - This file has real imports, so it is a *module*. A bare `declare module`
 *    in a script file is an ambient declaration that would *replace* the
 *    package's types instead of merging with them.
 */
declare module '@tanstack/react-table' {
  // Both parameters are required to match the original declaration's arity and
  // constraints; declaration merging is what "uses" them.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    /** Card slot for this column. Omit for `'meta'`. */
    mobile?: MobileRole;
    /**
     * Label beside the value in the field grid. Defaults to `header` when it is
     * a plain string, else the column id — so this is only needed when `header`
     * is a render function.
     */
    mobileLabel?: string;
    /** Give this field the full card width — notes, messages, long item lists. */
    mobileFull?: boolean;
  }
}

/** A row's cells sorted into card slots. */
export interface MobileCardSlots<TData> {
  title?: Cell<TData, unknown>;
  subtitle?: Cell<TData, unknown>;
  badges: Cell<TData, unknown>[];
  fields: Cell<TData, unknown>[];
  actions?: Cell<TData, unknown>;
}

/**
 * Sort a row's visible cells into card slots.
 *
 * `getVisibleCells()` already honours `columnVisibility`, so a column hidden to
 * make it searchable-but-not-shown never leaks into a card.
 */
export function bucketCells<TData>(row: Row<TData>): MobileCardSlots<TData> {
  const slots: MobileCardSlots<TData> = { badges: [], fields: [] };

  for (const cell of row.getVisibleCells()) {
    const role =
      cell.column.columnDef.meta?.mobile ??
      (cell.column.id === 'actions' ? 'actions' : 'meta');

    switch (role) {
      case 'hidden':
        break;
      case 'title':
        if (slots.title) slots.fields.push(cell);
        else slots.title = cell;
        break;
      case 'subtitle':
        if (slots.subtitle) slots.fields.push(cell);
        else slots.subtitle = cell;
        break;
      case 'badge':
        slots.badges.push(cell);
        break;
      case 'actions':
        if (slots.actions) slots.fields.push(cell);
        else slots.actions = cell;
        break;
      default:
        slots.fields.push(cell);
    }
  }

  // Nothing annotated? The first column is the identity column on every screen
  // that uses DataTable, so promoting it keeps un-migrated tables readable.
  if (!slots.title && slots.fields.length > 0) slots.title = slots.fields.shift();

  return slots;
}

/** The label shown beside a field's value in the card's field grid. */
export function mobileLabel<TData>(cell: Cell<TData, unknown>): string {
  const def = cell.column.columnDef;
  if (def.meta?.mobileLabel) return def.meta.mobileLabel;
  if (typeof def.header === 'string' && def.header.length > 0) return def.header;
  return cell.column.id;
}
