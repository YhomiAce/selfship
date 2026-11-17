/** One page of the public docs. */
export interface DocsPage {
  title: string;
  href: string;
}

/** A sidebar group. */
export interface DocsSection {
  title: string;
  pages: DocsPage[];
}

/**
 * The docs' table of contents: drives the sidebar and the previous/next
 * links. Add a page here when you add a `page.mdx` under `src/app/docs/`.
 */
export const DOCS_NAV: DocsSection[] = [
  {
    title: 'Getting started',
    pages: [
      { title: 'Introduction', href: '/docs' },
      { title: 'Quickstart', href: '/docs/quickstart' },
    ],
  },
  {
    title: 'Guides',
    pages: [
      { title: 'Servers', href: '/docs/servers' },
      { title: 'Connecting GitHub', href: '/docs/github' },
      { title: 'Projects and frameworks', href: '/docs/projects' },
      { title: 'Environment variables', href: '/docs/environment-variables' },
      { title: 'Deployments', href: '/docs/deployments' },
      { title: 'Domains and HTTPS', href: '/docs/domains' },
    ],
  },
  {
    title: 'Features',
    pages: [
      { title: 'Build Doctor', href: '/docs/build-doctor' },
      { title: 'Free sandbox', href: '/docs/sandbox' },
      { title: 'Account security', href: '/docs/account-security' },
    ],
  },
  {
    title: 'Help',
    pages: [
      { title: 'Troubleshooting', href: '/docs/troubleshooting' },
      { title: 'Self-hosting Selfship', href: '/docs/self-hosting' },
    ],
  },
];

/** Every page in reading order. */
export const DOCS_PAGES: DocsPage[] = DOCS_NAV.flatMap((section) => section.pages);

/**
 * The pages before and after one, for the bottom of each page.
 *
 * @param href - Current page
 * @returns Neighbours (undefined at either end)
 */
export function neighbours(href: string): { previous?: DocsPage; next?: DocsPage } {
  const index = DOCS_PAGES.findIndex((page) => page.href === href);
  if (index === -1) return {};
  return { previous: DOCS_PAGES[index - 1], next: DOCS_PAGES[index + 1] };
}
