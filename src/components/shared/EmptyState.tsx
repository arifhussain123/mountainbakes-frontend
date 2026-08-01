import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * The "there is nothing here" panel.
 *
 * Sized to read the same whether it fills a desktop table body or a phone-width
 * card list, so both branches of a responsive table can share one instance.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  /** Optional call to action — usually the same button as the page toolbar's. */
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-lg border border-dashed px-6 py-12 text-center',
        className
      )}
    >
      {Icon && <Icon className="mb-3 h-8 w-8 text-muted-foreground/60" aria-hidden />}
      <p className="font-medium">{title}</p>
      {description && (
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
