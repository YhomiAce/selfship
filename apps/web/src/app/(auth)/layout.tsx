import Link from 'next/link';

/** Centered layout shared by sign-in, sign-up and recovery pages. */
export default function AuthLayout({ children }: LayoutProps<'/'>): React.ReactNode {
  return (
    <main className="bg-muted/40 flex flex-1 flex-col items-center justify-center gap-6 px-4 py-12">
      <Link href="/" className="text-lg font-semibold tracking-tight">
        Platform
      </Link>
      <div className="w-full max-w-sm">{children}</div>
    </main>
  );
}
