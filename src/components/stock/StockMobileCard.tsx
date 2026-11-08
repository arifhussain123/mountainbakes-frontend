import type { StockRow } from '@mb/shared';
import { cn } from '@/lib/utils';
import { stockBalanceTone, stockCardFigures, type StockFigureTone, type WaitingDemand } from '@/utils/stockCardFigures';

const TONE_CLASS: Record<StockFigureTone, string> = {
  positive: 'text-emerald-600 dark:text-emerald-400',
  negative: 'text-red-600 dark:text-red-400',
  neutral: 'text-foreground',
};

/**
 * One product on the Stock page below `md` — the phone layout only; the wide
 * table is unchanged.
 *
 * Name and stock ID on top, then the day's seven figures as columns with the
 * label above the value, then the Stock balance. No product imagery.
 *
 * The strip is a 7-column grid whose columns share the width equally but
 * never shrink below their own content (the longest label word, the widest
 * figure) — so nothing is clipped or broken mid-word. Only when the seven
 * cannot fit (four-digit figures on a narrow phone, large text) does the
 * strip scroll sideways, inside the card, so the page itself never does.
 */
export function StockMobileCard({ row, waiting }: { row: StockRow; waiting: WaitingDemand }) {
  const figures = stockCardFigures(row, waiting);
  const isZero = row.balance === 0;

  return (
    <div className={cn('rounded-xl border bg-card p-3', isZero && 'opacity-60')}>
      <div className="min-w-0">
        <p className="font-medium leading-snug break-words">
          {row.productName}
          {!row.isActive && (
            <span className="ml-2 rounded bg-muted px-1.5 py-0.5 align-middle text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Discontinued
            </span>
          )}
        </p>
        <p className="font-mono text-xs text-muted-foreground">{row.stockCode}</p>
      </div>

      <div className="mt-2.5 overflow-x-auto rounded-lg border">
        <dl className="grid grid-cols-[repeat(7,minmax(min-content,1fr))] divide-x">
          {figures.map((f) => (
            <div key={f.key} className="flex flex-col items-center justify-between gap-1 px-0.5 py-2 text-center">
              <dt className="text-[10px] font-medium leading-tight tracking-tight text-muted-foreground">{f.label}</dt>
              <dd className={cn('whitespace-nowrap text-sm leading-5 tracking-tight tabular-nums', f.value === '0' ? 'font-medium' : 'font-semibold', TONE_CLASS[f.tone])}>
                {f.value}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="mt-2.5 flex items-baseline justify-between">
        <span className="text-xs font-semibold text-muted-foreground">Stock</span>
        <span
          className={cn(
            'text-xl font-bold tabular-nums',
            isZero ? 'text-muted-foreground' : TONE_CLASS[stockBalanceTone(row.balance)],
          )}
        >
          {row.balance.toLocaleString()}
        </span>
      </div>
    </div>
  );
}
