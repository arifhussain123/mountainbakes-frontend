import { cn } from '@/lib/utils';
import { EmptyState } from './EmptyState';

export type MatrixCell = React.ReactNode;

/**
 * A plain headers/rows grid that becomes a card list below `md`.
 *
 * For the report-shaped tables that arrive from the API as `headers: string[]`
 * plus `rows: cell[][]` — there is no row model to hang column metadata off, so
 * {@link DataTable}'s `meta` annotations don't apply. The first column is taken
 * as the row's identity (it becomes the card title); the rest become
 * label:value pairs, matching how these tables already render on desktop.
 */
export function ResponsiveMatrix({
  headers,
  rows,
  emptyTitle = 'Nothing to show',
  emptyDescription,
  className,
  /** Right-align every column but the first — the default for numeric reports. */
  numeric = true,
}: {
  headers: string[];
  rows: MatrixCell[][];
  emptyTitle?: string;
  emptyDescription?: string;
  className?: string;
  numeric?: boolean;
}) {
  if (rows.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} className={className} />;
  }

  return (
    <div className={className}>
      {/* Desktop table. `print-table-wrap` forces it onto paper — these reports
          are printed, and whether `md:` applies depends on the print page box. */}
      <div className="hidden overflow-x-auto rounded-lg border md:block print-table-wrap">
        <table className="w-full text-sm">
          <thead>
            <tr data-table-head className="text-left">
              {headers.map((h, i) => (
                <th
                  key={h}
                  className={cn(
                    'px-3 py-2 text-xs uppercase tracking-wide text-muted-foreground',
                    numeric && i > 0 && 'text-right'
                  )}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-t hover:bg-muted/30">
                {row.map((cell, j) => (
                  <td
                    key={j}
                    className={cn(
                      'px-3 py-2',
                      j === 0 ? 'font-medium' : 'tabular-nums',
                      numeric && j > 0 && 'text-right'
                    )}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Phone cards — first cell is the heading, the rest are label:value pairs. */}
      <div className="space-y-3 md:hidden no-print">
        {rows.map((row, i) => (
          <div key={i} className="rounded-lg border bg-card p-3">
            <p className="font-medium">{row[0]}</p>
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
              {row.slice(1).map((cell, j) => (
                <div key={j} className="flex items-baseline justify-between gap-2">
                  <dt className="shrink-0 text-muted-foreground">{headers[j + 1]}</dt>
                  <dd className="min-w-0 text-right font-medium tabular-nums">{cell}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
    </div>
  );
}
