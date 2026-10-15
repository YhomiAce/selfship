import type { Metadata } from 'next';
// Fonts are bundled with the `geist` package, so builds never download from
// Google Fonts (a flaky network step in CI and on offline/self-hosted builds).
import { GeistMono } from 'geist/font/mono';
import { GeistSans } from 'geist/font/sans';
import { Toaster } from '@/components/ui/sonner';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Selfship', template: '%s · Selfship' },
  description: 'Deploy any app from GitHub to your own server.',
};

/** Root layout: fonts, global styles and the toast container. */
export default function RootLayout({ children }: LayoutProps<'/'>): React.ReactNode {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        {children}
        <Toaster richColors position="top-right" />
      </body>
    </html>
  );
}
