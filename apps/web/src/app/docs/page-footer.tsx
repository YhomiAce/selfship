'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { neighbours } from './docs-nav';

/** Previous/next page links under each article. */
export function DocsPageFooter(): React.ReactNode {
  const { previous, next } = neighbours(usePathname());
  return (
    <nav aria-label="Previous and next pages" className="mt-16 flex gap-4 border-t pt-6 text-sm">
      {previous ? (
        <Link href={previous.href} className="group flex flex-col gap-1">
          <span className="text-muted-foreground flex items-center gap-1">
            <ArrowLeft className="size-3.5" aria-hidden /> Previous
          </span>
          <span className="font-medium group-hover:underline">{previous.title}</span>
        </Link>
      ) : null}
      {next ? (
        <Link href={next.href} className="group ml-auto flex flex-col items-end gap-1 text-right">
          <span className="text-muted-foreground flex items-center gap-1">
            Next <ArrowRight className="size-3.5" aria-hidden />
          </span>
          <span className="font-medium group-hover:underline">{next.title}</span>
        </Link>
      ) : null}
    </nav>
  );
}
