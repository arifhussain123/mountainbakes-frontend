'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { useSettings } from '@/hooks/useSettings';
import { useAppStore } from '@/stores/useAppStore';
import { cn } from '@/lib/utils';
import { ChevronLeft, LogOut } from '@/utils/icons';
import { getNavItems } from '@/utils/sidebar';
import { COMPANY_NAME } from '@/utils/constants';
import { IMAGES } from '@/utils/images';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';

export function Sidebar() {
  const { user, logout } = useAuth();
  const { settings } = useSettings();
  const { sidebarOpen, toggleSidebar } = useAppStore();
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
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={toggleSidebar}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed left-0 top-0 h-full w-64 z-50 flex flex-col transition-transform duration-200',
          'bg-sidebar text-sidebar-foreground',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
          'md:relative md:translate-x-0'
        )}
      >
        {/* Brand */}
        <div className="flex items-center justify-between px-6 py-7 border-b border-sidebar-border">
          <div className="flex items-center gap-3">
            {settings?.logoUrl ? (
              <Image
                src={settings.logoUrl}
                alt={settings.companyName || 'Logo'}
                width={64}
                height={64}
                className="h-16 w-16 rounded-full object-cover flex-shrink-0"
                unoptimized
              />
            ) : (
              <div className="w-16 h-16 rounded-full bg-primary flex items-center justify-center flex-shrink-0 overflow-hidden">
                <Image
                  src={IMAGES.logo}
                  alt={settings?.companyName || COMPANY_NAME}
                  width={64}
                  height={64}
                  className="w-full h-full object-cover"
                  unoptimized
                />
              </div>
            )}
            <div>
              <p className="font-bold text-sm text-sidebar-foreground leading-tight">
                {settings?.companyName || COMPANY_NAME}
              </p>
              <p className="text-xs opacity-60 capitalize">{user.role.replace('_', ' ')}</p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden text-sidebar-foreground hover:bg-sidebar-accent h-7 w-7"
            onClick={toggleSidebar}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
        </div>

        {/* Branch name for branch managers */}
        {user.branchName && (
          <div className="px-6 py-3 bg-sidebar-accent/50">
            <p className="text-xs font-semibold text-primary truncate">{user.branchName}</p>
          </div>
        )}

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-4 px-3">
          <div className="space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.href || (item.href !== '/dashboard' && item.href !== '/branch-dashboard' && pathname.startsWith(item.href));
              return (
                <Link key={item.href} href={item.href} onClick={() => window.innerWidth < 768 && toggleSidebar()}>
                  <div
                    className={cn(
                      'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
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
        <div className="p-3 border-t border-sidebar-border">
          <div className="px-3 py-2 mb-2">
            <p className="text-xs font-medium text-sidebar-foreground truncate">{user.displayName}</p>
            <p className="text-xs opacity-50 truncate">{user.email}</p>
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 px-3 py-2.5 w-full rounded-lg text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
          >
            <LogOut className="h-4 w-4" />
            Sign Out
          </button>
        </div>
      </aside>
    </>
  );
}
