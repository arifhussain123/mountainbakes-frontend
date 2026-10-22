'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { MoreHorizontal } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useAppStore } from '@/stores/useAppStore';
import { cn } from '@/lib/utils';
import { getPrimaryNavItems, isNavItemActive } from '@/utils/sidebar';

/**
 * Mobile bottom navigation — four primary tabs plus More.
 *
 * More opens the Sidebar's mobile drawer (the same one the Topbar's menu button
 * opens) rather than a sheet of its own, so every screen is reached from one list.
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
  const { sidebarOpen, setSidebarOpen } = useAppStore();

  if (!user) return null;

  const primary = getPrimaryNavItems(user.role);

  // Any screen not on the bar counts as "inside More", so the More tab stays lit
  // rather than leaving no tab active at all.
  const moreActive = !primary.some((item) => isNavItemActive(pathname, item.href));

  return (
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
          onClick={() => setSidebarOpen(true)}
          aria-label="More navigation"
          aria-expanded={sidebarOpen}
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
  );
}
