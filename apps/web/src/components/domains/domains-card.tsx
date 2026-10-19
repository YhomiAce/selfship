'use client';

import { ExternalLink, Loader2, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  DOMAIN_STATUS_LABELS,
  DomainHostnameSchema,
  type DomainDto,
  type DomainStatus,
} from '@selfship/shared';
import { CopyButton } from '@/components/servers/copy-button';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { ApiRequestError } from '@/lib/api-client';
import { domainsApi } from '@/lib/domains-api';
import { cn } from '@/lib/utils';

const STATUS_STYLES: Record<DomainStatus, string> = {
  pending_dns: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  issuing: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300',
  active: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  error: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
};

/** How often domains in progress are refreshed (the worker checks every minute). */
const REFRESH_MS = 15_000;

/** Shows an API error as a toast. */
function toastError(error: unknown, fallback: string): void {
  toast.error(error instanceof ApiRequestError ? error.message : fallback);
}

/**
 * Domains of a project: the free subdomain, custom domains with the DNS
 * record to create, and their progress (DNS → certificate → active).
 *
 * @param props.projectId - Project ID
 * @param props.hasServer - Whether the project has a server (needed for DNS instructions)
 */
export function DomainsCard({
  projectId,
  hasServer,
}: {
  projectId: string;
  hasServer: boolean;
}): React.ReactNode {
  const [domains, setDomains] = useState<DomainDto[] | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(
    (): Promise<void> =>
      domainsApi.list(projectId).then(setDomains, (error: unknown) => {
        toastError(error, 'Could not load domains.');
        setDomains([]);
      }),
    [projectId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // Follow progress while any domain is still being set up.
  const inProgress = domains?.some((d) => d.status !== 'active') ?? false;
  useEffect(() => {
    if (!inProgress) return;
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => {
      clearInterval(timer);
    };
  }, [inProgress, load]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Domains</CardTitle>
        <CardDescription>
          Every project gets a free subdomain with HTTPS. Add your own domain and Selfship sets up
          its certificate.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {domains === null ? (
          <Skeleton className="h-20" />
        ) : domains.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            The free subdomain is created with the first deployment.
          </p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {domains.map((domain) => (
              <DomainRow
                key={domain.id}
                projectId={projectId}
                domain={domain}
                onChanged={() => void load()}
              />
            ))}
          </ul>
        )}
        {adding ? (
          <AddDomainForm
            projectId={projectId}
            onDone={(updated) => {
              if (updated) setDomains(updated);
              setAdding(false);
            }}
          />
        ) : (
          <Button
            variant="outline"
            className="self-start"
            disabled={!hasServer}
            title={hasServer ? undefined : 'Choose a server first'}
            onClick={() => {
              setAdding(true);
            }}
          >
            <Plus />
            Add domain
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

/** One domain with its status, DNS instructions and actions. */
function DomainRow({
  projectId,
  domain,
  onChanged,
}: {
  projectId: string;
  domain: DomainDto;
  onChanged: () => void;
}): React.ReactNode {
  const [busy, setBusy] = useState<'check' | 'remove' | null>(null);

  const check = async (): Promise<void> => {
    setBusy('check');
    try {
      const updated = await domainsApi.check(projectId, domain.id);
      if (updated.status === 'active') toast.success(`${domain.hostname} is active`);
      onChanged();
    } catch (error) {
      toastError(error, 'Could not check the domain.');
    } finally {
      setBusy(null);
    }
  };

  const remove = async (): Promise<void> => {
    setBusy('remove');
    try {
      await domainsApi.remove(projectId, domain.id);
      toast.success(`Removed ${domain.hostname}`);
      onChanged();
    } catch (error) {
      toastError(error, 'Could not remove the domain.');
      setBusy(null);
    }
  };

  return (
    <li className="flex flex-col gap-2 px-3 py-3">
      <div className="flex flex-wrap items-center gap-2">
        {domain.status === 'active' && !domain.redirectTo ? (
          <a
            href={`https://${domain.hostname}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-w-0 items-center gap-1 font-medium hover:underline"
          >
            <span className="truncate">{domain.hostname}</span>
            <ExternalLink className="size-3.5 shrink-0" />
          </a>
        ) : (
          <span className="min-w-0 truncate font-medium">{domain.hostname}</span>
        )}
        {domain.kind === 'platform' ? (
          <span className="bg-muted text-muted-foreground rounded-md px-1.5 py-0.5 text-xs">
            Free
          </span>
        ) : null}
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium',
            STATUS_STYLES[domain.status],
          )}
        >
          {domain.status === 'issuing' ? <Loader2 className="size-3 animate-spin" /> : null}
          {DOMAIN_STATUS_LABELS[domain.status]}
        </span>
        <span className="ml-auto flex gap-1">
          {domain.status !== 'active' ? (
            <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => void check()}>
              {busy === 'check' ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              Check now
            </Button>
          ) : null}
          {domain.kind === 'custom' ? (
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={`Remove ${domain.hostname}`}
              disabled={busy !== null}
              onClick={() => void remove()}
            >
              <Trash2 />
            </Button>
          ) : null}
        </span>
      </div>
      {domain.redirectTo ? (
        <p className="text-muted-foreground text-sm">Redirects to {domain.redirectTo}</p>
      ) : null}
      {domain.statusMessage && domain.status !== 'active' ? (
        <p
          className={cn(
            'text-sm',
            domain.status === 'error' ? 'text-destructive' : 'text-muted-foreground',
          )}
        >
          {domain.statusMessage}
        </p>
      ) : null}
      {domain.status === 'pending_dns' && domain.dnsRecords.length > 0 ? (
        <div className="flex flex-col gap-2 rounded-lg border p-3 text-sm">
          <p>At your domain provider (registrar or DNS host), create this record:</p>
          {domain.dnsRecords.map((record) => (
            <div
              key={`${record.type}-${record.name}`}
              className="bg-muted grid grid-cols-[auto_1fr_auto] items-center gap-x-4 gap-y-1 rounded-md p-2 font-mono text-xs"
            >
              <span className="text-muted-foreground">Type</span>
              <span>{record.type}</span>
              <span />
              <span className="text-muted-foreground">Name</span>
              <span className="break-all">{record.name}</span>
              <CopyButton text={record.name} label="Copy" />
              <span className="text-muted-foreground">Value</span>
              <span>{record.value}</span>
              <CopyButton text={record.value} label="Copy" />
            </div>
          ))}
          <p className="text-muted-foreground text-xs">
            Some providers want only the part before your domain as the name (e.g. “www” or “@” for
            the domain itself). On Cloudflare, set the record to “DNS only” (grey cloud). Selfship
            checks every minute.
          </p>
        </div>
      ) : null}
    </li>
  );
}

/** Form to add a custom domain, optionally with its www/bare twin. */
function AddDomainForm({
  projectId,
  onDone,
}: {
  projectId: string;
  onDone: (domains: DomainDto[] | null) => void;
}): React.ReactNode {
  const [hostname, setHostname] = useState('');
  const [withWww, setWithWww] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const parsed = DomainHostnameSchema.safeParse(hostname);
  const twin = parsed.success
    ? parsed.data.startsWith('www.')
      ? parsed.data.slice(4)
      : `www.${parsed.data}`
    : null;

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Enter a domain.');
      return;
    }
    setError(null);
    setSaving(true);
    try {
      onDone(await domainsApi.add(projectId, { hostname: parsed.data, withWww }));
      toast.success(`Added ${parsed.data}`);
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught.message : 'Could not add the domain.');
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={(event) => void submit(event)}
      className="flex flex-col gap-3 rounded-lg border p-3"
    >
      <Input
        value={hostname}
        autoFocus
        placeholder="app.example.com"
        aria-label="Domain"
        aria-invalid={Boolean(error)}
        className="font-mono"
        onChange={(event) => {
          setHostname(event.target.value);
        }}
      />
      {twin ? (
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={withWww} onCheckedChange={setWithWww} aria-label={`Also add ${twin}`} />
          Also add {twin} (redirects to {parsed.success ? parsed.data : ''})
        </label>
      ) : null}
      {error ? <p className="text-destructive text-sm">{error}</p> : null}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={saving}>
          {saving ? <Loader2 className="animate-spin" /> : null}
          Add domain
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => {
            onDone(null);
          }}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
