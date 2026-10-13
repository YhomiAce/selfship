'use client';

import { FolderGit2, Loader2, Server, Settings } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useAuth } from '@/lib/auth/auth-context';
import { cn } from '@/lib/utils';
import { UserMenu } from './user-menu';
import { VerifyEmailBanner } from './verify-email-banner';

/** Sidebar navigation entries. */
const NAV_ITEMS = [
  { href: '/dashboard', label: 'Projects', icon: FolderGit2 },
  { href: '/dashboard/servers', label: 'Servers', icon: Server },
  { href: '/dashboard/settings', label: 'Settings', icon: Settings },
] as const;

/**
 * Dashboard frame: sidebar, header and content area.
 * Redirects to the login page if the session turns out to be invalid.
 *
 * @param props.children - The current dashboard page
 */
export function DashboardShell({ children }: { children: React.ReactNode }): React.ReactNode {
  const { user, isLoading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !user) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [isLoading, user, pathname, router]);

  if (!user) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="text-muted-foreground size-6 animate-spin" aria-label="Loading" />
      </div>
    );
  }

  return (
    <div className="flex flex-1">
      <aside className="bg-muted/30 hidden w-60 shrink-0 border-r md:flex md:flex-col">
        <Link href="/dashboard" className="px-6 py-5 text-lg font-semibold tracking-tight">
          Platform
        </Link>
        <nav className="flex flex-col gap-1 px-3" aria-label="Main">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const active = href === '/dashboard' ? pathname === href : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  active
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:bg-background/60 hover:text-foreground',
                )}
              >
                <Icon className="size-4" />
                {label}
              </Link>
            );
          })}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b px-6">
          <Link href="/dashboard" className="font-semibold md:hidden">
            Platform
          </Link>
          <div className="ml-auto">
            <UserMenu user={user} />
          </div>
        </header>
        <VerifyEmailBanner />
        <main className="flex-1 px-6 py-8">{children}</main>
      </div>
    </div>
  );
}
