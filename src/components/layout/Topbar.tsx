'use client';

import { Menu, Bell, Moon, Sun, Search, Palette, Check } from '@/utils/icons';
import { useAppStore } from '@/stores/useAppStore';
import { useAuth } from '@/hooks/useAuth';
import { useNotifications } from '@/hooks/useNotifications';
import { useTheme, ACCENTS } from '@/providers/ThemeProvider';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { GlobalSearch } from '@/components/shared/GlobalSearch';
import { RefreshButton } from '@/components/layout/RefreshButton';
import { useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { useRouter, usePathname } from 'next/navigation';
import { toast } from 'sonner';
import { getPageTitle } from '@/utils/pageTitles';

/**
 * `title` is optional and normally omitted: the Topbar is mounted once in the
 * dashboard layout and resolves its own heading from the route via PAGE_TITLES.
 * The prop remains for the rare screen that needs a heading the URL cannot
 * express, and overrides the map when passed.
 */
export function Topbar({ title }: { title?: string }) {
  const { toggleSidebar } = useAppStore();
  const { user, logout } = useAuth();
  const { notifications, unreadCount, markAsRead, markAllAsRead } = useNotifications();
  const { theme, setTheme, accent, setAccent, mounted } = useTheme();
  const [searchOpen, setSearchOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const heading = title ?? getPageTitle(pathname);

  async function handleLogout() {
    await logout();
    toast.success('Signed out');
    router.push('/login');
  }

  return (
    <>
      {/* Phone: tighter padding and gaps, and the bar pads itself by the safe-area
          insets so nothing sits under a notch or a rounded corner. */}
      <header className="no-print sticky top-0 z-30 flex h-14 items-center gap-1 border-b bg-card/80 pr-[max(0.5rem,env(safe-area-inset-right))] pl-[max(0.5rem,env(safe-area-inset-left))] backdrop-blur-sm md:gap-3 md:px-4">
        {/* Three sections rather than the old "content, spacer, content": both
            outer sections are `flex-1` from a zero basis, so they grow equally
            and leave the Refresh button in the true centre of the bar. The left
            one carries `min-w-0` so a long page title truncates instead of
            shoving the centre off.

            That centring is for md and up only. On a phone equal halves left
            the title about 60px — "Branch…" at 390px wide, nothing at all at
            320px — so there the right-hand group takes just what it needs
            (`max-md:flex-none`) and the title gets the rest. */}
        <div className="flex min-w-0 flex-1 items-center gap-1 md:gap-3">
          {/* Mobile menu toggle */}
          <Button variant="ghost" size="icon" className="md:hidden" onClick={toggleSidebar}>
            <Menu className="h-5 w-5" />
          </Button>

          {/* Page title. Shown on mobile too — with the sidebar closed by default
              and the bottom nav only labelling five destinations, this heading is
              the only thing telling a phone user which screen they are on. */}
          {heading && (
            <h1 className="truncate text-base font-semibold text-foreground">{heading}</h1>
          )}
        </div>

        {/* Centre: refresh / apply-update */}
        <RefreshButton />

        <div className="flex flex-1 items-center justify-end gap-1 max-md:flex-none">
        {/* Search trigger */}
        <Button
          variant="outline"
          size="sm"
          className="hidden sm:flex items-center gap-2 text-muted-foreground h-9 px-3 text-sm"
          onClick={() => setSearchOpen(true)}
        >
          <Search className="h-3.5 w-3.5" />
          <span>Search…</span>
          <kbd className="ml-1 text-[10px] bg-muted px-1.5 py-0.5 rounded border font-mono">⌘K</kbd>
        </Button>

        {/* Mobile search */}
        <Button variant="ghost" size="icon" className="sm:hidden" onClick={() => setSearchOpen(true)}>
          <Search className="h-4 w-4" />
        </Button>

        {/* Accent color picker */}
        <DropdownMenu>
          <DropdownMenuTrigger
            className="hidden h-9 w-9 items-center justify-center rounded-md hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:inline-flex"
            title="Accent color"
          >
            <Palette className="h-4 w-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">Accent color</div>
            {ACCENTS.map((a) => (
              <DropdownMenuItem key={a.value} onClick={() => setAccent(a.value)} className="gap-2">
                <span className="h-4 w-4 rounded-full border" style={{ backgroundColor: a.swatch }} />
                <span className="flex-1">{a.label}</span>
                {accent === a.value && <Check className="h-3.5 w-3.5 text-primary" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Theme toggle */}
        <Button variant="ghost" size="icon" className="hidden sm:inline-flex" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
          {/* Render the icon only after mount so the resolved theme is known —
              avoids both a hydration mismatch and a wrong-icon flash. */}
          {mounted ? (
            theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />
          ) : (
            <span className="h-4 w-4" />
          )}
        </Button>

        {/* Notifications */}
        <DropdownMenu>
          <DropdownMenuTrigger className="relative inline-flex h-9 w-9 items-center justify-center rounded-md max-md:h-10 max-md:w-10 hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Bell className="h-4 w-4" />
            {unreadCount > 0 && (
              <Badge className="absolute -top-1 -right-1 h-4 w-4 p-0 flex items-center justify-center text-[10px] bg-primary">
                {unreadCount > 9 ? '9+' : unreadCount}
              </Badge>
            )}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-80 max-w-[calc(100vw-1rem)]">
            <div className="flex items-center justify-between px-3 py-2 border-b">
              <span className="font-semibold text-sm">Notifications</span>
              {unreadCount > 0 && (
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={markAllAsRead}>
                  Mark all read
                </Button>
              )}
            </div>
            <div className="max-h-72 overflow-y-auto">
              {notifications.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">No notifications</p>
              ) : (
                notifications.slice(0, 10).map((n) => (
                  <div
                    key={n.id}
                    className={`px-3 py-2.5 border-b last:border-0 cursor-pointer hover:bg-accent transition-colors ${!n.isRead ? 'bg-primary/5' : ''}`}
                    onClick={() => markAsRead(n.id)}
                  >
                    <p className={`text-sm ${!n.isRead ? 'font-medium' : ''}`}>{n.title}</p>
                    {/* The body, not just the heading. A Finance Help Desk
                        notification puts the Query ID, subject, priority and
                        raiser here (§13) — a title alone says a query arrived
                        and not which one, so the admin has to open the desk to
                        find out. `whitespace-pre-line` because those notifications
                        are written as one field per line. */}
                    {n.message && (
                      <p className="mt-0.5 line-clamp-4 whitespace-pre-line text-xs text-muted-foreground">
                        {n.message}
                      </p>
                    )}
                    <p className="text-[10px] text-muted-foreground mt-1">
                      {n.createdAt ? formatDistanceToNow(new Date(n.createdAt), { addSuffix: true }) : ''}
                    </p>
                  </div>
                ))
              )}
            </div>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* User avatar menu */}
        <DropdownMenu>
          <DropdownMenuTrigger className="inline-flex h-8 w-8 items-center justify-center rounded-full max-md:h-10 max-md:w-10 hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Avatar className="h-8 w-8">
              <AvatarFallback className="bg-primary text-white text-xs font-bold">
                {user?.displayName?.slice(0, 2).toUpperCase() || 'MB'}
              </AvatarFallback>
            </Avatar>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <div className="px-3 py-2">
              <p className="text-sm font-medium truncate">{user?.displayName}</p>
              <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
              <p className="text-xs text-primary capitalize mt-0.5">{user?.role.replace('_', ' ')}</p>
            </div>
            {/* Phone only. The theme toggle and the accent picker used to sit in
                the bar itself, where between them they took the room the page
                title needs; below `sm` they are offered here instead. */}
            <div className="sm:hidden">
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                className="min-h-10 gap-2"
              >
                {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                {theme === 'dark' ? 'Light mode' : 'Dark mode'}
              </DropdownMenuItem>
              <div className="flex items-center gap-2 px-1.5 py-1.5">
                <Palette className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                {ACCENTS.map((a) => (
                  <button
                    key={a.value}
                    type="button"
                    aria-label={`${a.label} accent`}
                    aria-pressed={accent === a.value}
                    onClick={() => setAccent(a.value)}
                    className="flex size-8 items-center justify-center rounded-full border focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    style={{ backgroundColor: a.swatch }}
                  >
                    {accent === a.value && <Check className="h-4 w-4 text-white" />}
                  </button>
                ))}
              </div>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleLogout} className="min-h-10 text-destructive md:min-h-0">
              Sign Out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        </div>
      </header>

      <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} />
    </>
  );
}
