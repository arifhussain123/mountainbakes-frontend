'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ElementType } from 'react';
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
 * Phone redesign 2026 (v6 navigation): a full-width white bar with rounded top
 * corners and a soft upward shadow. Idle tabs are an outline icon over a label in
 * warm taupe; the active tab is a 68px orange-gradient circle with a white ring,
 * standing ~30px above the bar, its label bold in the accent colour below. The
 * circle and label follow `--primary`, so a non-orange accent recolours them; in
 * dark mode the bar is the dark card and the ring matches it.
 *
 * Every tab is at least 64px tall, well above the 44px touch floor, and the bar
 * pads itself by env(safe-area-inset-bottom) so the tabs sit above the iOS home
 * indicator instead of under it.
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
      className="no-print md:hidden fixed bottom-0 inset-x-0 z-40 rounded-t-[30px] bg-card px-1.5 pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-[0_-6px_24px_rgba(60,40,30,0.08)] dark:border-t dark:shadow-[0_-6px_24px_rgba(0,0,0,0.35)]"
      aria-label="Primary"
    >
      <div className="flex items-stretch">
        {primary.map((item) => (
          <NavTab
            key={item.href}
            icon={item.icon}
            label={item.label}
            active={isNavItemActive(pathname, item.href)}
            href={item.href}
          />
        ))}

        <NavTab
          icon={MoreHorizontal}
          label="More"
          active={moreActive}
          onClick={() => setSidebarOpen(true)}
          ariaLabel="More navigation"
          ariaExpanded={sidebarOpen}
        />
      </div>
    </nav>
  );
}

/** One tab — a link, or the More button. Same look either way. */
function NavTab({
  icon: Icon,
  label,
  active,
  href,
  onClick,
  ariaLabel,
  ariaExpanded,
}: {
  icon: ElementType;
  label: string;
  active: boolean;
  href?: string;
  onClick?: () => void;
  ariaLabel?: string;
  ariaExpanded?: boolean;
}) {
  const className = cn(
    'flex min-w-0 flex-1 basis-0 flex-col items-center justify-start px-0.5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset rounded-2xl',
    active
      ? 'gap-2 text-[13.5px] font-bold text-primary'
      : 'gap-[7px] pt-3.5 text-[13px] font-medium text-[#7A685C] dark:text-muted-foreground'
  );
  const body = (
    <>
      <span
        className={cn(
          'flex flex-shrink-0 items-center justify-center',
          active
            ? '-mt-[30px] size-[68px] rounded-full border-[5px] border-card bg-primary bg-[image:var(--mb-primary-grad)] text-primary-foreground shadow-[0_10px_20px_color-mix(in_oklab,var(--primary)_35%,transparent)]'
            : 'size-[26px]'
        )}
      >
        <Icon className={active ? 'size-7' : 'size-[23px]'} strokeWidth={1.9} />
      </span>
      <span className="max-w-full truncate leading-none">{label}</span>
    </>
  );

  if (href) {
    return (
      <Link href={href} aria-current={active ? 'page' : undefined} className={className}>
        {body}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} aria-label={ariaLabel} aria-expanded={ariaExpanded} className={className}>
      {body}
    </button>
  );
}
