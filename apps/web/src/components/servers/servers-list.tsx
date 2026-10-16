'use client';

import { Plus, Server } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { CAPABILITY_TIER_LABELS, type ServerDto } from '@selfship/shared';
import { FormAlert } from '@/components/auth/form-alert';
import { EmptyState } from '@/components/dashboard/empty-state';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiRequestError } from '@/lib/api-client';
import { serversApi } from '@/lib/servers-api';
import { ServerStatusBadge } from './server-status-badge';

/** The user's servers with their status. */
export function ServersList(): React.ReactNode {
  const [servers, setServers] = useState<ServerDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    serversApi
      .list()
      .then(setServers)
      .catch((caught: unknown) => {
        setError(caught instanceof ApiRequestError ? caught.message : 'Could not load servers.');
        setServers([]);
      });
  }, []);

  const addLink = (
    <Link href="/dashboard/servers/new" className={buttonVariants()}>
      <Plus />
      Add server
    </Link>
  );

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Servers</h1>
          <p className="text-muted-foreground text-sm">VPSes your apps are deployed to.</p>
        </div>
        {servers && servers.length > 0 ? addLink : null}
      </div>
      <FormAlert message={error} />
      {servers === null ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
      ) : servers.length === 0 ? (
        <EmptyState
          icon={Server}
          title="No servers yet"
          description="Add a VPS running Ubuntu or Debian with SSH access. Selfship sets it up for deployments."
          action={addLink}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {servers.map((server) => (
            <Link key={server.id} href={`/dashboard/servers/${server.id}`} className="group">
              <Card className="group-hover:ring-foreground/20 h-full transition-shadow">
                <CardHeader>
                  <CardTitle className="flex items-center justify-between gap-2">
                    <span className="truncate">{server.name}</span>
                    <ServerStatusBadge status={server.status} />
                  </CardTitle>
                  <CardDescription className="truncate font-mono text-xs">
                    {server.sshUser}@{server.host}
                    {server.port !== 22 ? `:${server.port}` : ''}
                  </CardDescription>
                </CardHeader>
                <CardContent className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-sm">
                  {server.specs.os ? <span>{server.specs.os}</span> : null}
                  {server.specs.ramMb ? (
                    <span>{(server.specs.ramMb / 1024).toFixed(1)} GB RAM</span>
                  ) : null}
                  {server.tier ? <span>{CAPABILITY_TIER_LABELS[server.tier].label}</span> : null}
                  {!server.specs.os ? <span>Not checked yet</span> : null}
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
