import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';

/** Public landing page (placeholder until the real marketing page). */
export default function HomePage(): React.ReactNode {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-6 text-center">
      <h1 className="max-w-2xl text-4xl font-semibold tracking-tight sm:text-5xl">
        Deploy any app from GitHub to your own server.
      </h1>
      <p className="text-muted-foreground max-w-xl text-lg">
        Connect a repo, add your VPS, click deploy. We handle the build, the proxy and SSL.
      </p>
      <div className="flex gap-3">
        <Link href="/signup" className={buttonVariants({ size: 'lg' })}>
          Get started
        </Link>
        <Link href="/login" className={buttonVariants({ variant: 'outline', size: 'lg' })}>
          Log in
        </Link>
      </div>
    </main>
  );
}
