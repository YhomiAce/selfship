import type { Metadata } from 'next';
import { Menu } from 'lucide-react';
import { SiteFooter } from '@/components/site/site-footer';
import { SiteHeader } from '@/components/site/site-header';
import { DocsSidebar } from './docs-sidebar';
import { OnThisPage } from './on-this-page';
import { DocsPageFooter } from './page-footer';

export const metadata: Metadata = {
  title: { default: 'Documentation', template: '%s · Selfship docs' },
  description: 'How to deploy apps from GitHub to your own server with Selfship.',
};

/** Public docs: sidebar, article, "On this page". */
export default function DocsLayout({ children }: LayoutProps<'/docs'>): React.ReactNode {
  return (
    <>
      <SiteHeader />
      <div className="mx-auto flex w-full max-w-6xl flex-1 gap-10 px-4 sm:px-6">
        <aside className="hidden w-56 shrink-0 md:block">
          <div className="sticky top-14 max-h-[calc(100vh-3.5rem)] overflow-y-auto py-8 pr-2">
            <DocsSidebar />
          </div>
        </aside>

        <main className="min-w-0 flex-1 py-8">
          {/* Small screens: the sidebar folds into a menu above the article. */}
          <details className="mb-6 rounded-lg border md:hidden">
            <summary className="flex cursor-pointer items-center gap-2 px-4 py-2.5 text-sm font-medium">
              <Menu className="size-4" aria-hidden /> Browse docs
            </summary>
            <div className="border-t px-4 py-4">
              <DocsSidebar />
            </div>
          </details>

          <article
            data-docs-article
            className="prose prose-neutral prose-headings:scroll-mt-20 prose-a:underline-offset-2 prose-code:before:content-none prose-code:after:content-none prose-code:rounded prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:font-normal prose-pre:bg-neutral-950 prose-pre:text-neutral-100 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-inherit prose-table:text-sm max-w-none"
          >
            {children}
          </article>
          <DocsPageFooter />
        </main>

        <aside className="hidden w-52 shrink-0 xl:block">
          <div className="sticky top-14 py-8">
            <OnThisPage />
          </div>
        </aside>
      </div>
      <SiteFooter />
    </>
  );
}
