'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { DOCS_NAV } from './docs-nav';

/** Docs navigation, highlighting the current page. */
export function DocsSidebar({ onNavigate }: { onNavigate?: () => void }): React.ReactNode {
  const pathname = usePathname();
  return (
    <nav aria-label="Documentation" className="space-y-6 text-sm">
      {DOCS_NAV.map((section) => (
        <div key={section.title} className="space-y-2">
          <h2 className="text-foreground font-medium">{section.title}</h2>
          <ul className="space-y-1 border-l">
            {section.pages.map((page) => {
              const active = pathname === page.href;
              return (
                <li key={page.href}>
                  <Link
                    href={page.href}
                    onClick={onNavigate}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      '-ml-px block border-l py-1 pl-3',
                      active
                        ? 'border-foreground text-foreground font-medium'
                        : 'text-muted-foreground hover:text-foreground border-transparent hover:border-current',
                    )}
                  >
                    {page.title}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
