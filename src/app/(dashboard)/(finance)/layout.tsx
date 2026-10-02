/**
 * Every Finance screen wears the Finance Dashboard's look. `fin-page` scopes the
 * table dress in globals.css to this route group; the header band and the stat
 * cards come from the shared pieces in components/finance/finance-ui.
 */
export default function FinanceLayout({ children }: { children: React.ReactNode }) {
  return <div className="fin-page">{children}</div>;
}
