'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

interface Heading {
  id: string;
  text: string;
  level: 2 | 3;
}

/**
 * "On this page": the article's h2/h3 headings (ids from rehype-slug), with
 * the one currently in view highlighted.
 */
export function OnThisPage(): React.ReactNode {
  const pathname = usePathname();
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    const elements = Array.from(
      document.querySelectorAll<HTMLHeadingElement>(
        '[data-docs-article] h2[id], [data-docs-article] h3[id]',
      ),
    );
    // Read the headings once the new page has rendered.
    const frame = requestAnimationFrame(() => {
      setHeadings(
        elements.map((element) => ({
          id: element.id,
          text: element.textContent ?? '',
          level: element.tagName === 'H2' ? 2 : 3,
        })),
      );
    });
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.find((entry) => entry.isIntersecting);
        if (visible) setActive(visible.target.id);
      },
      { rootMargin: '0px 0px -70% 0px' },
    );
    elements.forEach((element) => observer.observe(element));
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [pathname]);

  if (headings.length < 2) return null;
  return (
    <nav aria-label="On this page" className="space-y-2 text-sm">
      <h2 className="font-medium">On this page</h2>
      <ul className="space-y-1.5">
        {headings.map((heading) => (
          <li key={heading.id} className={heading.level === 3 ? 'pl-3' : undefined}>
            <a
              href={`#${heading.id}`}
              className={cn(
                'hover:text-foreground block',
                active === heading.id ? 'text-foreground font-medium' : 'text-muted-foreground',
              )}
            >
              {heading.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
