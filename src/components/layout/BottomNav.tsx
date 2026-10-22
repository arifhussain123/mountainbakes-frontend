'use client';

import Link from 'next/link';
import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { ChevronRight, MoreHorizontal } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';
import { getNavItems, getPrimaryNavItems, isNavItemActive } from '@/utils/sidebar';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';

/** The More sheet's grid width; the bar is md:hidden, so this only ever renders on phones. */
const SHEET_COLUMNS = 3;

/**
 * Mobile bottom navigation — four primary tabs plus More.
 *
 * Hidden at md+, where the sidebar takes over. The sibling `<main>` carries
 * matching bottom padding so this bar never covers the last row of content.
 *
 * Touch targets are min-h-14 (56px), comfortably above the 44px floor, and the
 * bar pads itself by env(safe-area-inset-bottom) so the tabs sit above the iOS
 * home indicator instead of under it.
 */
export function BottomNav() {
  const { user } = useAuth();
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);

  if (!user) return null;

  const primary = getPrimaryNavItems(user.role);
  const all = getNavItems(user.role);
  const rows = Array.from({ length: Math.ceil(all.length / SHEET_COLUMNS) }, (_, i) =>
    all.slice(i * SHEET_COLUMNS, (i + 1) * SHEET_COLUMNS)
  );

  // Any screen not on the bar counts as "inside More", so the More tab stays lit
  // rather than leaving no tab active at all.
  const moreActive = !primary.some((item) => isNavItemActive(pathname, item.href));

  return (
    <>
      <nav
        className="no-print md:hidden fixed bottom-0 inset-x-0 z-40 border-t bg-card/95 backdrop-blur-sm pb-[env(safe-area-inset-bottom)]"
        aria-label="Primary"
      >
        <div className="flex items-stretch">
          {primary.map((item) => {
            const Icon = item.icon;
            const active = isNavItemActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex-1 min-h-14 flex flex-col items-center justify-center gap-0.5 px-1 transition-colors',
                  active ? 'text-primary' : 'text-muted-foreground'
                )}
              >
                <Icon className="h-5 w-5 flex-shrink-0" />
                <span className="text-[10px] font-medium leading-none truncate max-w-full">
                  {item.label}
                </span>
              </Link>
            );
          })}

          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            aria-label="More navigation"
            aria-expanded={moreOpen}
            className={cn(
              'flex-1 min-h-14 flex flex-col items-center justify-center gap-0.5 px-1 transition-colors',
              moreActive ? 'text-primary' : 'text-muted-foreground'
            )}
          >
            <MoreHorizontal className="h-5 w-5 flex-shrink-0" />
            <span className="text-[10px] font-medium leading-none">More</span>
          </button>
        </div>
      </nav>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="bottom" className="max-h-[80dvh] pb-[env(safe-area-inset-bottom)]">
          <SheetHeader>
            <SheetTitle>All screens</SheetTitle>
          </SheetHeader>
          <div className="min-h-0 overflow-y-auto overscroll-contain px-3 pb-4">
            {/* Rows are chunked by hand rather than one CSS grid so each row can
                carry its own full-width divider; no lines between columns. */}
            <div className="divide-y divide-border">
              {rows.map((row) => (
                <div key={row[0].href} className="grid grid-cols-3 gap-1 py-1.5">
                  {row.map((item) => {
                    const Icon = item.icon;
                    const active = isNavItemActive(pathname, item.href);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={() => setMoreOpen(false)}
                        aria-current={active ? 'page' : undefined}
                        className={cn(
                          'flex min-h-20 min-w-0 items-center gap-0.5 rounded-lg py-2 pl-2 pr-1 transition-colors',
                          active
                            ? 'bg-primary/10 text-primary'
                            : 'text-foreground hover:bg-accent active:bg-accent'
                        )}
                      >
                        <span className="flex min-w-0 flex-1 flex-col items-center gap-1.5 text-center">
                          <Icon className="h-5 w-5 flex-shrink-0" />
                          <span className="text-xs font-medium leading-tight [overflow-wrap:anywhere]">
                            {item.label}
                          </span>
                        </span>
                        <ChevronRight
                          aria-hidden
                          className={cn(
                            'pointer-events-none h-3.5 w-3.5 flex-shrink-0',
                            active ? 'text-primary' : 'text-muted-foreground'
                          )}
                        />
                      </Link>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
