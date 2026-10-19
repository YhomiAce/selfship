'use client';

import {
  AlertTriangle,
  ArrowLeft,
  ExternalLink,
  GitCommit,
  Lightbulb,
  Loader2,
  RotateCw,
  Server,
  Square,
  Undo2,
} from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  ACTIVE_DEPLOYMENT_STATUSES,
  DEPLOYMENT_STAGE_LABELS,
  DEPLOYMENT_TRIGGER_LABELS,
  type DeploymentDto,
} from '@selfship/shared';
import { FormAlert } from '@/components/auth/form-alert';
import { DeploymentStatusBadge } from '@/components/deployments/deployment-status-badge';
import { LogViewer } from '@/components/deployments/log-viewer';
import { duration, StageTimeline } from '@/components/deployments/stage-timeline';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiRequestError } from '@/lib/api-client';
import { deploymentsApi } from '@/lib/deployments-api';

/** One deployment: stages, live log, outcome, cancel. */
export function DeploymentDetail(): React.ReactNode {
  const params = useParams<{ id: string; deploymentId: string }>();
  const projectId = typeof params.id === 'string' ? params.id : '';
  const deploymentId = typeof params.deploymentId === 'string' ? params.deploymentId : '';
  const [deployment, setDeployment] = useState<DeploymentDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [starting, setStarting] = useState<'redeploy' | 'rollback' | null>(null);
  const router = useRouter();
  const [, setTick] = useState(0);

  const refresh = useCallback(
    (): Promise<void> =>
      deploymentsApi.get(projectId, deploymentId).then(setDeployment, (caught: unknown) => {
        setError(
          caught instanceof ApiRequestError && caught.status === 404
            ? "This deployment doesn't exist or you don't have access to it."
            : 'Could not load the deployment.',
        );
      }),
    [projectId, deploymentId],
  );

  useEffect(() => {
    if (projectId && deploymentId) void refresh();
  }, [projectId, deploymentId, refresh]);

  const active = deployment ? ACTIVE_DEPLOYMENT_STATUSES.includes(deployment.status) : false;
  // Tick every second while running, so stage durations count up.
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      setTick((n) => n + 1);
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, [active]);

  const cancel = async (): Promise<void> => {
    setCancelling(true);
    try {
      setDeployment(await deploymentsApi.cancel(projectId, deploymentId));
      toast.success('Cancelling… the current version stays live');
    } catch (caught) {
      toast.error(caught instanceof ApiRequestError ? caught.message : 'Could not cancel.');
    } finally {
      setCancelling(false);
    }
  };

  /** Redeploys this commit (rebuild) or rolls back to this image. */
  const again = async (kind: 'redeploy' | 'rollback'): Promise<void> => {
    if (!deployment) return;
    setStarting(kind);
    try {
      const started =
        kind === 'rollback'
          ? await deploymentsApi.rollback(projectId, deployment.id)
          : await deploymentsApi.create(projectId, { commitSha: deployment.commit.sha });
      router.push(`/dashboard/projects/${projectId}/deployments/${started.id}`);
    } catch (caught) {
      toast.error(caught instanceof ApiRequestError ? caught.message : 'Could not start it.');
      setStarting(null);
    }
  };

  if (error) {
    return (
      <div className="mx-auto flex max-w-5xl flex-col gap-4">
        <FormAlert message={error} />
        <Link
          href={`/dashboard/projects/${projectId}`}
          className="text-sm font-medium hover:underline"
        >
          Back to the project
        </Link>
      </div>
    );
  }
  if (!deployment) return <Skeleton className="mx-auto h-96 w-full max-w-5xl" />;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div>
        <Link
          href={`/dashboard/projects/${projectId}`}
          className="text-muted-foreground mb-2 inline-flex items-center gap-1 text-sm hover:underline"
        >
          <ArrowLeft className="size-3.5" />
          Project
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
              <span className="truncate">{deployment.commit.message}</span>
              <DeploymentStatusBadge status={deployment.status} />
            </h1>
            <p className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <span className="inline-flex items-center gap-1">
                <GitCommit className="size-3.5" />
                <span className="font-mono">{deployment.commit.sha.slice(0, 7)}</span> on{' '}
                {deployment.branch}
                {deployment.commit.author ? ` by ${deployment.commit.author}` : ''}
                {deployment.trigger !== 'manual'
                  ? ` · ${DEPLOYMENT_TRIGGER_LABELS[deployment.trigger]}`
                  : ''}
              </span>
              <span className="inline-flex items-center gap-1">
                <Server className="size-3.5" />
                {deployment.server?.name ?? 'Removed server'}
              </span>
              <span>
                {new Date(deployment.createdAt).toLocaleString()}
                {deployment.startedAt
                  ? ` · ${duration(deployment.startedAt, deployment.finishedAt)}`
                  : ''}
              </span>
            </p>
          </div>
          <div className="flex gap-2">
            {deployment.status === 'live' && deployment.url ? (
              <a
                href={deployment.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-sm font-medium hover:bg-muted"
              >
                Visit
                <ExternalLink className="size-3.5" />
              </a>
            ) : null}
            {deployment.rollbackAvailable ? (
              <Button
                variant="outline"
                disabled={starting !== null}
                title="Put this version live again, without rebuilding"
                onClick={() => void again('rollback')}
              >
                {starting === 'rollback' ? <Loader2 className="animate-spin" /> : <Undo2 />}
                Roll back to this
              </Button>
            ) : null}
            {!active && deployment.status !== 'live' ? (
              <Button
                variant="outline"
                disabled={starting !== null}
                title="Build and deploy this commit again"
                onClick={() => void again('redeploy')}
              >
                {starting === 'redeploy' ? <Loader2 className="animate-spin" /> : <RotateCw />}
                Redeploy this commit
              </Button>
            ) : null}
            {active ? (
              <Button
                variant="outline"
                disabled={
                  cancelling || deployment.cancelRequested || deployment.status === 'switching'
                }
                onClick={() => void cancel()}
              >
                <Square />
                {deployment.cancelRequested ? 'Cancelling…' : 'Cancel'}
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      {deployment.hint ? (
        <Alert>
          <Lightbulb />
          <AlertTitle>{deployment.hint.title}</AlertTitle>
          <AlertDescription>{deployment.hint.advice}</AlertDescription>
        </Alert>
      ) : null}

      {deployment.status === 'failed' && deployment.errorSummary ? (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>
            Failed
            {deployment.failedStage
              ? ` at “${DEPLOYMENT_STAGE_LABELS[deployment.failedStage]}”`
              : ''}
            . The previous version is still live.
          </AlertTitle>
          <AlertDescription className="font-mono text-xs whitespace-pre-wrap">
            {deployment.errorSummary}
          </AlertDescription>
        </Alert>
      ) : null}

      <StageTimeline deployment={deployment} />

      <LogViewer
        key={deployment.id}
        projectId={projectId}
        deploymentId={deployment.id}
        onStage={() => void refresh()}
        onEnd={() => void refresh()}
      />
    </div>
  );
}
