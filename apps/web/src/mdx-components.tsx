import Link from 'next/link';
import type { MDXComponents } from 'mdx/types';
import { Callout } from '@/components/site/callout';

/**
 * Components available in every MDX page (required by @next/mdx). Internal
 * links use Next's <Link> for client-side navigation; <Callout> boxes are
 * available without an import.
 */
const components: MDXComponents = {
  a: ({ href = '', children, ...props }) =>
    href.startsWith('/') || href.startsWith('#') ? (
      <Link href={href} {...props}>
        {children}
      </Link>
    ) : (
      <a href={href} target="_blank" rel="noreferrer" {...props}>
        {children}
      </a>
    ),
  // Wide tables scroll sideways on small screens instead of overflowing.
  table: (props) => (
    <div className="not-prose my-6 overflow-x-auto rounded-lg border">
      <table
        className="w-full text-sm [&_td]:border-t [&_td]:px-3 [&_td]:py-2 [&_td]:align-top [&_th]:bg-muted/60 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-medium [&_code]:bg-muted [&_code]:rounded [&_code]:px-1 [&_code]:text-[0.85em]"
        {...props}
      />
    </div>
  ),
  Callout,
};

/** @returns The MDX components for every docs page. */
export function useMDXComponents(): MDXComponents {
  return components;
}
