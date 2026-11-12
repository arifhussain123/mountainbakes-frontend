import { cn } from '@/lib/utils';

/** The white card every section of the production dashboard sits in. Kept out
 *  of ProductionCharts so the dashboard can use it without pulling in recharts. */
export function Panel({
  title, subtitle, action, className, children,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    // Phone (light): the redesign's white card (mb-card) with an H3-sized title.
    <section className={cn('mb-card flex h-full min-w-0 flex-col gap-3.5 rounded-[14px] border bg-card px-5 py-[18px] text-card-foreground', className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[15px] font-bold max-md:text-[17px] max-md:leading-[22px] max-md:font-semibold max-md:tracking-[-0.2px]">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
