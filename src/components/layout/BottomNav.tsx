'use client';

import Link from 'next/link';
import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { MoreHorizontal } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';
import { getNavItems, getPrimaryNavItems, isNavItemActive } from '@/utils/sidebar';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';

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
        <SheetContent side="bottom" className="max-h-[80vh] pb-[env(safe-area-inset-bottom)]">
          <SheetHeader>
            <SheetTitle>All screens</SheetTitle>
          </SheetHeader>
          <div className="overflow-y-auto px-2 pb-4">
            <div className="grid grid-cols-3 gap-2">
              {all.map((item) => {
                const Icon = item.icon;
                const active = isNavItemActive(pathname, item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMoreOpen(false)}
                    className={cn(
                      'flex flex-col items-center justify-center gap-1.5 rounded-lg p-3 min-h-20 text-center transition-colors',
                      active
                        ? 'bg-primary/10 text-primary'
                        : 'text-foreground hover:bg-accent active:bg-accent'
                    )}
                  >
                    <Icon className="h-5 w-5 flex-shrink-0" />
                    <span className="text-xs font-medium leading-tight">{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
