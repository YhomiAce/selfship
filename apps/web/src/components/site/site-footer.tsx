import Link from 'next/link';
import { Ship } from 'lucide-react';

const COLUMNS: { title: string; links: { label: string; href: string }[] }[] = [
  {
    title: 'Product',
    links: [
      { label: 'How it works', href: '/#how-it-works' },
      { label: 'Features', href: '/#features' },
      { label: 'Frameworks', href: '/#frameworks' },
      { label: 'FAQ', href: '/#faq' },
    ],
  },
  {
    title: 'Docs',
    links: [
      { label: 'Quickstart', href: '/docs/quickstart' },
      { label: 'Servers', href: '/docs/servers' },
      { label: 'Deployments', href: '/docs/deployments' },
      { label: 'Troubleshooting', href: '/docs/troubleshooting' },
    ],
  },
  {
    title: 'Account',
    links: [
      { label: 'Get started', href: '/signup' },
      { label: 'Log in', href: '/login' },
      { label: 'Source code', href: 'https://github.com/YhomiAce/selfship' },
    ],
  },
];

/** Public pages' footer. */
export function SiteFooter(): React.ReactNode {
  return (
    <footer className="border-t">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:grid-cols-4 sm:px-6">
        <div className="space-y-2">
          <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <Ship className="size-5" aria-hidden />
            Selfship
          </Link>
          <p className="text-muted-foreground text-sm">Ship your app to your own server.</p>
        </div>
        {COLUMNS.map((column) => (
          <nav key={column.title} aria-label={column.title} className="space-y-3 text-sm">
            <h2 className="font-medium">{column.title}</h2>
            <ul className="text-muted-foreground space-y-2">
              {column.links.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="hover:text-foreground">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="text-muted-foreground mx-auto max-w-6xl px-4 pb-8 text-xs sm:px-6">
        © Selfship · Open source
      </div>
    </footer>
  );
}
