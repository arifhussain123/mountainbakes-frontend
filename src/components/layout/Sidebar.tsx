'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { useSettings } from '@/hooks/useSettings';
import { useAppStore } from '@/stores/useAppStore';
import { cn } from '@/lib/utils';
import { ChevronLeft, LogOut } from '@/utils/icons';
import { getNavItems, isNavItemActive } from '@/utils/sidebar';
import { COMPANY_NAME } from '@/utils/constants';
import { IMAGES } from '@/utils/images';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';

/**
 * Role navigation.
 *
 * Rendered twice from one definition: as a static `<aside>` at md+, and inside a
 * left Sheet below md. The mobile drawer used to be hand-rolled here — a fixed
 * overlay plus a translate-x transition — which meant no focus trap, no Esc, no
 * scroll lock, and an `aria-hidden`-less panel that screen readers walked into
 * while it was off-screen. The Sheet primitive (already in the codebase, just
 * unused) provides all of that.
 */
export function Sidebar() {
  const { sidebarOpen, setSidebarOpen } = useAppStore();

  return (
    <>
      {/* Desktop / tablet: always visible, part of the flex row. */}
      <aside className="hidden md:flex w-64 flex-shrink-0 flex-col bg-sidebar text-sidebar-foreground">
        <SidebarBody />
      </aside>

      {/* Mobile: drawer. */}
      <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <SheetContent
          side="left"
          showCloseButton={false}
          className="md:hidden w-64 max-w-[85vw] gap-0 bg-sidebar p-0 text-sidebar-foreground sm:max-w-[85vw]"
        >
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SidebarBody onNavigate={() => setSidebarOpen(false)} />
        </SheetContent>
      </Sheet>
    </>
  );
}

/**
 * The sidebar's contents, independent of how it is presented.
 *
 * `onNavigate` fires after a link tap and is how the mobile drawer closes itself.
 * The desktop aside passes nothing, so the previous `window.innerWidth < 768`
 * check inside the click handler is gone — presentation decides the behaviour
 * rather than each link re-measuring the viewport.
 */
function SidebarBody({ onNavigate }: { onNavigate?: () => void }) {
  const { user, logout } = useAuth();
  const { settings } = useSettings();
  const pathname = usePathname();
  const router = useRouter();

  if (!user) return null;
  const navItems = getNavItems(user.role);

  async function handleLogout() {
    await logout();
    toast.success('Signed out');
    router.push('/login');
  }

  return (
    <>
      {/* Brand */}
      <div className="flex items-center gap-3 border-b border-sidebar-border px-6 py-7">
        {settings?.logoUrl ? (
          <Image
            src={settings.logoUrl}
            alt={settings.companyName || 'Logo'}
            width={64}
            height={64}
            className="h-16 w-16 flex-shrink-0 rounded-full object-cover"
            priority
            unoptimized
          />
        ) : (
          <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary">
            <Image
              src={IMAGES.logo}
              alt={settings?.companyName || COMPANY_NAME}
              width={64}
              height={64}
              className="h-full w-full object-cover"
              priority
              unoptimized
            />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold leading-tight text-sidebar-foreground">
            {settings?.companyName || COMPANY_NAME}
          </p>
          <p className="text-xs capitalize opacity-60">{user.role.replace('_', ' ')}</p>
        </div>

        {/* Drawer-only: collapse the sheet. Sheet also closes on backdrop tap and
            Esc, but a visible affordance is what people reach for on a phone. */}
        {onNavigate && (
          <Button
            variant="ghost"
            size="icon"
            aria-label="Close navigation"
            className="h-7 w-7 flex-shrink-0 text-sidebar-foreground hover:bg-sidebar-accent"
            onClick={onNavigate}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Branch name for branch managers */}
      {user.branchName && (
        <div className="bg-sidebar-accent/50 px-6 py-3">
          <p className="truncate text-xs font-semibold text-primary">{user.branchName}</p>
        </div>
      )}

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <div className="space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = isNavItemActive(pathname, item.href);
            return (
              <Link key={item.href} href={item.href} onClick={onNavigate}>
                <div
                  className={cn(
                    'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-primary text-white'
                      : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                  )}
                >
                  <Icon className="h-4 w-4 flex-shrink-0" />
                  {item.label}
                </div>
              </Link>
            );
          })}
        </div>
      </nav>

      {/* Footer */}
      <div className="border-t border-sidebar-border p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="mb-2 px-3 py-2">
          <p className="truncate text-xs font-medium text-sidebar-foreground">{user.displayName}</p>
          <p className="truncate text-xs opacity-50">{user.email}</p>
        </div>
        <button
          onClick={handleLogout}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent"
        >
          <LogOut className="h-4 w-4" />
          Sign Out
        </button>
      </div>
    </>
  );
}
