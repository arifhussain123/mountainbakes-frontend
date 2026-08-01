'use client';

import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Mobile floating action button for a screen's single dominant action.
 *
 * Mobile-only by design (`md:hidden`) — on desktop the same action stays in the
 * page toolbar, where there is room for a labelled button. Pair the two: give the
 * toolbar button `hidden md:inline-flex` so the action appears exactly once at
 * every width.
 *
 * Positioned above the bottom nav and inside the safe area, so it clears both the
 * tab bar and the iOS home indicator. Use at most one per screen — a second FAB
 * means the screen has no single primary action and both belong in the toolbar.
 */
export function Fab({
  onClick,
  icon: Icon,
  label,
  className,
}: {
  onClick: () => void;
  icon: LucideIcon;
  /** Accessible name. Not rendered — the FAB stays icon-only to remain thumb-sized. */
  label: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn(
        'md:hidden fixed right-4 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-40',
        'flex h-14 w-14 items-center justify-center rounded-full',
        'bg-primary text-white shadow-lg transition-transform',
        'active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        className
      )}
    >
      <Icon className="h-6 w-6" />
    </button>
  );
}
