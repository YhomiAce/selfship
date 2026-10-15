'use client';

import { FolderGit2, Server, Settings } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

/** Sidebar navigation entries. */
const NAV_ITEMS = [
  {
    href: '/dashboard',
    label: 'Projects',
    icon: FolderGit2,
    match: (p: string) => p === '/dashboard' || p.startsWith('/dashboard/projects'),
  },
  {
    href: '/dashboard/servers',
    label: 'Servers',
    icon: Server,
    match: (p: string) => p.startsWith('/dashboard/servers'),
  },
  {
    href: '/dashboard/settings',
    label: 'Settings',
    icon: Settings,
    match: (p: string) => p.startsWith('/dashboard/settings'),
  },
] as const;

/**
 * Renders the navigation links, highlighting the active one.
 *
 * @param props.activePath - Current pathname, or null when unknown (no highlight)
 */
function NavLinks({ activePath }: { activePath: string | null }): React.ReactNode {
  return (
    <nav className="flex flex-col gap-1 px-3" aria-label="Main">
      {NAV_ITEMS.map(({ href, label, icon: Icon, match }) => {
        const active = activePath !== null && match(activePath);
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
  );
}

/**
 * Navigation with the active link highlighted. Reads the pathname, so it must
 * be rendered inside `<Suspense>` (see {@link SidebarNavFallback}).
 */
export function SidebarNav(): React.ReactNode {
  return <NavLinks activePath={usePathname()} />;
}

/** Same links without highlighting, used while the pathname isn't known yet. */
export function SidebarNavFallback(): React.ReactNode {
  return <NavLinks activePath={null} />;
}
