import Link from 'next/link';
import { Ship } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** Public pages' top bar: brand, docs link, sign-in and sign-up. */
export function SiteHeader({ className }: { className?: string }): React.ReactNode {
  return (
    <header
      className={cn(
        'bg-background/80 supports-[backdrop-filter]:bg-background/70 sticky top-0 z-40 border-b backdrop-blur',
        className,
      )}
    >
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <Ship className="size-5" aria-hidden />
          Selfship
        </Link>
        <nav aria-label="Main" className="text-muted-foreground flex items-center gap-5 text-sm">
          <Link href="/#how-it-works" className="hover:text-foreground hidden sm:inline">
            How it works
          </Link>
          <Link href="/#features" className="hover:text-foreground hidden sm:inline">
            Features
          </Link>
          <Link href="/docs" className="hover:text-foreground">
            Docs
          </Link>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <Link href="/login" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
            Log in
          </Link>
          <Link href="/signup" className={buttonVariants({ size: 'sm' })}>
            Get started
          </Link>
        </div>
      </div>
    </header>
  );
}
