import { CheckCircle2, Globe } from 'lucide-react';

/** One line of the sample build log. */
interface LogLine {
  text: string;
  tone?: 'muted' | 'ok';
}

const LOG: LogLine[] = [
  { text: '→ Cloning acme/storefront@main (4f2c9e1)', tone: 'muted' },
  { text: '→ Detected Next.js (pnpm, Node 22)' },
  { text: '→ Building image on your server…', tone: 'muted' },
  { text: '  ✓ Compiled successfully in 41s' },
  { text: '→ Starting the new version' },
  { text: '→ Health check passed (200 OK)', tone: 'ok' },
  { text: '✓ Live at https://storefront.example.com', tone: 'ok' },
];

/** Hero illustration: a finished deployment, as the dashboard shows it. */
export function DeployPreview(): React.ReactNode {
  return (
    <div aria-hidden className="bg-card rounded-xl border shadow-sm">
      <div className="flex items-center justify-between gap-4 border-b px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">storefront</p>
          <p className="text-muted-foreground flex items-center gap-1.5 truncate text-xs">
            <Globe className="size-3" /> storefront.example.com
          </p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
          <CheckCircle2 className="size-3.5" /> Live
        </span>
      </div>
      <pre className="overflow-x-auto rounded-b-xl bg-neutral-950 px-4 py-4 font-mono text-xs leading-6 text-neutral-200">
        {LOG.map((line) => (
          <div
            key={line.text}
            className={
              line.tone === 'ok'
                ? 'text-emerald-400'
                : line.tone === 'muted'
                  ? 'text-neutral-400'
                  : undefined
            }
          >
            {line.text}
          </div>
        ))}
      </pre>
    </div>
  );
}
