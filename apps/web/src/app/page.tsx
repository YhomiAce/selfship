import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ArrowRight,
  Boxes,
  Check,
  GitBranch,
  KeyRound,
  Lock,
  ScrollText,
  ServerCog,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  Timer,
  Undo2,
} from 'lucide-react';
import { SiteFooter } from '@/components/site/site-footer';
import { SiteHeader } from '@/components/site/site-header';
import { buttonVariants } from '@/components/ui/button';
import { DeployPreview } from './deploy-preview';

export const metadata: Metadata = {
  title: { absolute: 'Selfship: deploy any app from GitHub to your own server' },
  description:
    'Connect a GitHub repo, add your VPS, click deploy. Selfship builds your app on your server, puts it behind HTTPS and keeps the last good version running.',
};

const STEPS = [
  {
    icon: ServerCog,
    title: 'Add your server',
    body: 'Any Ubuntu or Debian VPS you can SSH into: Hetzner, DigitalOcean, AWS, Hostinger… Selfship checks it, then installs Docker and an HTTPS proxy for you.',
  },
  {
    icon: GitBranch,
    title: 'Connect GitHub',
    body: 'Install the Selfship GitHub App on the repositories you choose. Pick a repo and a branch.',
  },
  {
    icon: Sparkles,
    title: 'Deploy',
    body: 'Selfship detects your framework, builds the app on your server, checks it is healthy and gives it an HTTPS address. Every push can redeploy it.',
  },
];

const FEATURES = [
  {
    icon: Boxes,
    title: 'Framework detection',
    body: 'Next.js, Node servers (Express, NestJS, Fastify…), single-page apps (React, Vue, Angular, Svelte), static sites, or your own Dockerfile. npm, pnpm, Yarn and Bun.',
  },
  {
    icon: Lock,
    title: 'HTTPS by default',
    body: 'Every app gets a working HTTPS address on the first deploy. Add your own domain and the certificate is issued and renewed automatically.',
  },
  {
    icon: Undo2,
    title: 'Safe deploys',
    body: 'The new version must start and pass a health check before it gets traffic. If it fails, what was live keeps running untouched.',
  },
  {
    icon: ScrollText,
    title: 'Live build logs',
    body: 'Follow every step of a build in real time, with secrets masked. Every deployment keeps its log for later.',
  },
  {
    icon: GitBranch,
    title: 'Deploy on push',
    body: 'Pushing to your branch starts a deployment. Add [skip deploy] to a commit message when you don’t want one.',
  },
  {
    icon: KeyRound,
    title: 'Encrypted environment variables',
    body: 'Secrets are encrypted at rest. Choose whether each variable is available while building, at runtime, or both. Paste a whole .env file at once.',
  },
  {
    icon: Stethoscope,
    title: 'Build Doctor',
    body: 'When a build fails, get a plain-language explanation of the cause and the steps to fix it, instead of a wall of logs.',
  },
  {
    icon: Timer,
    title: 'Free sandbox',
    body: 'No server yet? Run a static site, single-page app or small Node app on our sandbox for 7 days, then move it to your own server in one step.',
  },
  {
    icon: ShieldCheck,
    title: 'Account security',
    body: 'Two-factor authentication with recovery codes, and an activity log of sign-ins, deployments and settings changes.',
  },
];

const FRAMEWORKS = [
  'Next.js',
  'React',
  'Vue',
  'Angular',
  'Svelte',
  'Nuxt',
  'Astro',
  'NestJS',
  'Express',
  'Fastify',
  'Hono',
  'Static HTML',
  'Dockerfile',
];

const OWNERSHIP = [
  'Your apps run as ordinary Docker containers on your server, and keep running even if Selfship is unreachable.',
  'Your code is built on your server, and your app’s traffic goes straight to it, never through us.',
  'Your hosting bill is your VPS provider’s, at their price: a small server costs a few dollars a month.',
  'No lock-in: there’s nothing proprietary on the server. Selfship is open source (AGPL-3.0) and can be self-hosted.',
];

const FAQ = [
  {
    q: 'What kind of server do I need?',
    a: 'A VPS with Ubuntu 22.04 or 24.04, or Debian 12 or 13, a public IP, at least 5 GB of free disk, and ports 80 and 443 free. Selfship connects over SSH as root or as a user with passwordless sudo. With 2 GB of memory or more you can build anything, including Next.js; under 1 GB is best for static sites and single-page apps.',
  },
  {
    q: 'Does Selfship need my server’s password?',
    a: 'No. The recommended way is to let Selfship generate an SSH key and add its public key to your server with one command. You can also paste a private key, or enter a password once so Selfship installs its own key (the password is never stored). Keys are encrypted at rest.',
  },
  {
    q: 'What happens if a deployment fails?',
    a: 'Nothing changes on the server: the version that was live keeps serving traffic. The deployment shows the failed step and its log, and Build Doctor explains what went wrong.',
  },
  {
    q: 'Can I use my own domain?',
    a: 'Yes. Add the domain to a project, create the DNS record Selfship shows you, and the HTTPS certificate is issued automatically.',
  },
  {
    q: 'Do I need Docker or Kubernetes knowledge?',
    a: 'No. Selfship writes the Dockerfile for common frameworks. If your repo already has a Dockerfile, it’s used as is.',
  },
  {
    q: 'Can I host Selfship myself?',
    a: 'Yes. Selfship is open source and ships with a Docker Compose setup. See “Self-hosting Selfship” in the docs.',
  },
];

/** Public home page. */
export default function HomePage(): React.ReactNode {
  return (
    <>
      <SiteHeader />
      <main className="flex-1">
        {/* Hero */}
        <section className="border-b">
          <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-16 sm:px-6 lg:grid-cols-2 lg:py-24">
            <div className="space-y-6">
              <p className="text-muted-foreground inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs">
                <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden /> Open source ·
                in early beta
              </p>
              <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
                Deploy any app from GitHub to your own server.
              </h1>
              <p className="text-muted-foreground max-w-xl text-lg text-pretty">
                Connect a repo, add your VPS, click deploy. Selfship builds your app on your server,
                puts it behind HTTPS and keeps the last good version running if something breaks.
              </p>
              <div className="flex flex-wrap gap-3">
                <Link href="/signup" className={buttonVariants({ size: 'lg' })}>
                  Get started <ArrowRight aria-hidden />
                </Link>
                <Link
                  href="/docs/quickstart"
                  className={buttonVariants({ variant: 'outline', size: 'lg' })}
                >
                  Read the quickstart
                </Link>
              </div>
            </div>
            <DeployPreview />
          </div>
        </section>

        {/* How it works */}
        <section id="how-it-works" className="scroll-mt-16 border-b">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-20">
            <h2 className="text-3xl font-semibold tracking-tight">How it works</h2>
            <p className="text-muted-foreground mt-2 max-w-2xl">
              From an empty server to a live HTTPS app in three steps. No Dockerfiles, proxies or
              certificates to set up.
            </p>
            <ol className="mt-10 grid gap-6 md:grid-cols-3">
              {STEPS.map((step, index) => (
                <li key={step.title} className="bg-card rounded-xl border p-6">
                  <div className="flex items-center gap-3">
                    <span className="bg-foreground text-background flex size-7 items-center justify-center rounded-full text-sm font-medium">
                      {index + 1}
                    </span>
                    <step.icon className="text-muted-foreground size-5" aria-hidden />
                  </div>
                  <h3 className="mt-4 font-medium">{step.title}</h3>
                  <p className="text-muted-foreground mt-2 text-sm">{step.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Features */}
        <section id="features" className="bg-muted/30 scroll-mt-16 border-b">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-20">
            <h2 className="text-3xl font-semibold tracking-tight">Everything a deploy needs</h2>
            <p className="text-muted-foreground mt-2 max-w-2xl">
              The parts of a hosting platform you’d otherwise wire up by hand, running on your own
              machine.
            </p>
            <div className="mt-10 grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((feature) => (
                <div key={feature.title}>
                  <feature.icon className="size-5" aria-hidden />
                  <h3 className="mt-3 font-medium">{feature.title}</h3>
                  <p className="text-muted-foreground mt-1.5 text-sm">{feature.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Frameworks */}
        <section id="frameworks" className="scroll-mt-16 border-b">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
            <h2 className="text-3xl font-semibold tracking-tight">
              Works with what you already use
            </h2>
            <p className="text-muted-foreground mt-2 max-w-2xl">
              Selfship reads your repository and picks the right build. You can always adjust the
              commands.{' '}
              <Link href="/docs/projects" className="text-foreground underline underline-offset-2">
                Supported frameworks
              </Link>
            </p>
            <ul className="mt-8 flex flex-wrap gap-2">
              {FRAMEWORKS.map((name) => (
                <li key={name} className="rounded-full border px-3 py-1 text-sm">
                  {name}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Ownership */}
        <section className="border-b">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-2 lg:py-20">
            <div>
              <h2 className="text-3xl font-semibold tracking-tight">
                Your server. Your app. Your bill.
              </h2>
              <p className="text-muted-foreground mt-3">
                Selfship gives you the convenience of a hosting platform without moving your app
                onto someone else’s infrastructure.
              </p>
            </div>
            <ul className="space-y-4">
              {OWNERSHIP.map((point) => (
                <li key={point} className="flex gap-3">
                  <Check className="mt-0.5 size-5 shrink-0 text-emerald-600" aria-hidden />
                  <span>{point}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="bg-muted/30 scroll-mt-16 border-b">
          <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:py-20">
            <h2 className="text-3xl font-semibold tracking-tight">Questions</h2>
            <div className="mt-8 divide-y rounded-xl border bg-background">
              {FAQ.map((item) => (
                <details key={item.q} className="group px-5 py-4">
                  <summary className="cursor-pointer list-none font-medium marker:hidden">
                    <span className="flex items-center justify-between gap-4">
                      {item.q}
                      <span
                        className="text-muted-foreground transition group-open:rotate-45"
                        aria-hidden
                      >
                        +
                      </span>
                    </span>
                  </summary>
                  <p className="text-muted-foreground mt-3 text-sm">{item.a}</p>
                </details>
              ))}
            </div>
            <p className="text-muted-foreground mt-6 text-sm">
              More in the{' '}
              <Link href="/docs" className="text-foreground underline underline-offset-2">
                documentation
              </Link>
              .
            </p>
          </div>
        </section>

        {/* Call to action */}
        <section>
          <div className="mx-auto flex max-w-6xl flex-col items-center gap-6 px-4 py-20 text-center sm:px-6">
            <h2 className="text-3xl font-semibold tracking-tight text-balance">
              Ship your next app to your own server.
            </h2>
            <p className="text-muted-foreground max-w-xl">
              Sign up, add a server and deploy your first repository in about ten minutes.
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              <Link href="/signup" className={buttonVariants({ size: 'lg' })}>
                Get started <ArrowRight aria-hidden />
              </Link>
              <Link href="/docs" className={buttonVariants({ variant: 'outline', size: 'lg' })}>
                Read the docs
              </Link>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
