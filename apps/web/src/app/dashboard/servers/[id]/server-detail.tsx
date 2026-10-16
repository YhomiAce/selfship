'use client';

import { AlertTriangle, ArrowLeft, Plug, RefreshCw, Trash2, Wrench } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { ServerDto, ServerJobDto, ServerJobType } from '@selfship/shared';
import { FormAlert } from '@/components/auth/form-alert';
import { CommandBox } from '@/components/servers/copy-button';
import { JobHistory } from '@/components/servers/job-history';
import { JobLog } from '@/components/servers/job-log';
import { ServerSpecs } from '@/components/servers/server-specs';
import { ServerStatusBadge } from '@/components/servers/server-status-badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiRequestError } from '@/lib/api-client';
import { serversApi } from '@/lib/servers-api';

/** Display names of job types. */
const JOB_LABELS: Record<ServerJobType, string> = { check: 'Check', setup: 'Setup' };

/** Whether a job is still queued or running. */
function isActive(job: ServerJobDto | null): boolean {
  return job?.status === 'queued' || job?.status === 'running';
}

/**
 * Server page: the connect step for generated keys, the live log of the
 * current job, what the check found, actions, history and removal.
 */
export function ServerDetail(): React.ReactNode {
  const params = useParams<{ id: string }>();
  const serverId = typeof params.id === 'string' ? params.id : '';
  const router = useRouter();
  const [server, setServer] = useState<ServerDto | null>(null);
  const [jobs, setJobs] = useState<ServerJobDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState<ServerJobType | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  /** Reloads the server and its job history. */
  const refresh = useCallback(
    (): Promise<void> =>
      Promise.all([serversApi.get(serverId), serversApi.jobs(serverId)]).then(
        ([loaded, history]) => {
          setServer(loaded);
          setJobs(history);
        },
        (caught: unknown) => {
          setError(
            caught instanceof ApiRequestError && caught.status === 404
              ? "This server doesn't exist or you don't have access to it."
              : 'Could not load the server.',
          );
        },
      ),
    [serverId],
  );

  useEffect(() => {
    if (serverId) void refresh();
  }, [serverId, refresh]);

  /** Starts a check or setup, then shows its live log. */
  const start = async (type: ServerJobType): Promise<void> => {
    setStarting(type);
    try {
      await (type === 'check' ? serversApi.check(serverId) : serversApi.setup(serverId));
      await refresh();
    } catch (caught) {
      toast.error(caught instanceof ApiRequestError ? caught.message : 'Could not start the job.');
    } finally {
      setStarting(null);
    }
  };

  const remove = async (): Promise<void> => {
    setIsDeleting(true);
    try {
      await serversApi.remove(serverId);
      toast.success('Server removed from Selfship');
      router.replace('/dashboard/servers');
    } catch (caught) {
      toast.error(
        caught instanceof ApiRequestError ? caught.message : 'Could not remove the server.',
      );
      setIsDeleting(false);
    }
  };

  if (error) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <FormAlert message={error} />
        <Link href="/dashboard/servers" className="text-sm font-medium hover:underline">
          Back to servers
        </Link>
      </div>
    );
  }
  if (!server) return <Skeleton className="mx-auto h-96 w-full max-w-3xl" />;

  const latest = server.latestJob;
  const busy = isActive(latest) || starting !== null;
  const checkedOnce = server.lastCheckedAt !== null;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <Link
          href="/dashboard/servers"
          className="text-muted-foreground mb-2 inline-flex items-center gap-1 text-sm hover:underline"
        >
          <ArrowLeft className="size-3.5" />
          Servers
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
              <span className="truncate">{server.name}</span>
              <ServerStatusBadge status={server.status} />
            </h1>
            <p className="text-muted-foreground font-mono text-sm">
              {server.sshUser}@{server.host}
              {server.port !== 22 ? `:${server.port}` : ''}
            </p>
          </div>
          {server.status !== 'awaiting_key' ? (
            <div className="flex gap-2">
              <Button variant="outline" disabled={busy} onClick={() => void start('check')}>
                <RefreshCw className={starting === 'check' ? 'animate-spin' : undefined} />
                Check again
              </Button>
              <Button disabled={busy} onClick={() => void start('setup')}>
                <Wrench />
                {server.readyAt ? 'Re-run setup' : 'Run setup'}
              </Button>
            </div>
          ) : null}
        </div>
      </div>

      {server.statusMessage && !isActive(latest) ? (
        <Alert variant={server.status === 'awaiting_key' ? 'default' : 'destructive'}>
          <AlertTriangle />
          <AlertTitle>
            {server.status === 'awaiting_key'
              ? "Couldn't connect yet"
              : 'Something needs attention'}
          </AlertTitle>
          <AlertDescription>{server.statusMessage}</AlertDescription>
        </Alert>
      ) : null}

      {server.status === 'awaiting_key' ? (
        <Card>
          <CardHeader>
            <CardTitle>Give Selfship access</CardTitle>
            <CardDescription>
              Log in to your server as <span className="font-mono">{server.sshUser}</span> (with the
              provider&apos;s web console or your own SSH) and run this command. It adds our public
              key to <span className="font-mono">~/.ssh/authorized_keys</span>.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <CommandBox command={server.authorizeCommand} />
            <Button className="self-start" disabled={busy} onClick={() => void start('setup')}>
              <Plug />
              {starting ? 'Connecting…' : "I've added it, connect"}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {latest ? (
        <Card>
          <CardHeader>
            <CardTitle>
              {isActive(latest)
                ? `${JOB_LABELS[latest.type]} in progress`
                : `Last ${JOB_LABELS[latest.type].toLowerCase()}`}
            </CardTitle>
            <CardDescription>{new Date(latest.createdAt).toLocaleString()}</CardDescription>
          </CardHeader>
          <CardContent>
            <JobLog
              key={latest.id}
              serverId={server.id}
              jobId={latest.id}
              onEnd={() => void refresh()}
            />
          </CardContent>
        </Card>
      ) : null}

      {server.problems.length > 0 || server.warnings.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Findings</CardTitle>
            <CardDescription>
              {server.problems.length > 0
                ? 'Fix these on the server, then click “Check again”.'
                : 'Nothing blocking, but worth knowing.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-2 text-sm">
              {server.problems.map((problem) => (
                <li key={problem} className="text-destructive">
                  ✗ {problem}
                </li>
              ))}
              {server.warnings.map((warning) => (
                <li key={warning} className="text-amber-700 dark:text-amber-400">
                  ⚠ {warning}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {checkedOnce ? (
        <Card>
          <CardHeader>
            <CardTitle>Server</CardTitle>
            <CardDescription>
              Last checked {new Date(server.lastCheckedAt ?? server.createdAt).toLocaleString()}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ServerSpecs server={server} />
          </CardContent>
        </Card>
      ) : null}

      {jobs.length > 1 ? (
        <Card>
          <CardHeader>
            <CardTitle>History</CardTitle>
          </CardHeader>
          <CardContent>
            <JobHistory serverId={server.id} jobs={jobs.slice(1)} />
          </CardContent>
        </Card>
      ) : null}

      <Card className="ring-destructive/30">
        <CardHeader>
          <CardTitle>Remove server</CardTitle>
          <CardDescription>
            Removes the server from Selfship. Nothing on the server is changed.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AlertDialog>
            <AlertDialogTrigger
              render={<Button variant="destructive" disabled={latest?.status === 'running'} />}
            >
              <Trash2 />
              Remove server
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remove {server.name}?</AlertDialogTitle>
                <AlertDialogDescription>
                  Selfship forgets this server and its key. Apps and Docker on the server keep
                  running. To also revoke our access, run this on the server:
                </AlertDialogDescription>
              </AlertDialogHeader>
              <CommandBox command={server.revokeCommand} />
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  disabled={isDeleting}
                  onClick={() => void remove()}
                >
                  {isDeleting ? 'Removing…' : 'Remove'}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>
    </div>
  );
}
