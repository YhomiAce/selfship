'use client';

import { Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Suspense, useEffect } from 'react';
import { useAuth } from '@/lib/auth/auth-context';
import { SidebarNav, SidebarNavFallback } from './sidebar-nav';
import { UserMenu } from './user-menu';
import { VerifyEmailBanner } from './verify-email-banner';

/**
 * Dashboard frame: sidebar, header and content area.
 * Redirects to the login page if the session turns out to be invalid.
 *
 * @param props.children - The current dashboard page
 */
export function DashboardShell({ children }: { children: React.ReactNode }): React.ReactNode {
  const { user, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !user) {
      // Read the path at redirect time (not via usePathname) so the shell has
      // no URL dependency and can stay in the prerendered App Shell.
      router.replace(`/login?next=${encodeURIComponent(window.location.pathname)}`);
    }
  }, [isLoading, user, router]);

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
          Selfship
        </Link>
        <Suspense fallback={<SidebarNavFallback />}>
          <SidebarNav />
        </Suspense>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b px-6">
          <Link href="/dashboard" className="font-semibold md:hidden">
            Selfship
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
