'use client';

import { ChevronRight, Loader2, Undo2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { DEPLOYMENT_TRIGGER_LABELS, type DeploymentDto } from '@selfship/shared';
import { Button } from '@/components/ui/button';
import { ApiRequestError } from '@/lib/api-client';
import { deploymentsApi } from '@/lib/deployments-api';
import { DeploymentStatusBadge } from './deployment-status-badge';
import { duration } from './stage-timeline';

/**
 * Recent deployments of a project, linking to their logs, with a rollback
 * button on those whose image is still on the server.
 *
 * @param props.projectId - Project ID
 * @param props.deployments - Deployments, newest first
 * @param props.canDeploy - False while a deployment runs (rollback disabled)
 */
export function DeploymentsList({
  projectId,
  deployments,
  canDeploy = true,
}: {
  projectId: string;
  deployments: DeploymentDto[];
  canDeploy?: boolean;
}): React.ReactNode {
  const router = useRouter();
  const [rollingBack, setRollingBack] = useState<string | null>(null);

  const rollback = async (deployment: DeploymentDto): Promise<void> => {
    setRollingBack(deployment.id);
    try {
      const started = await deploymentsApi.rollback(projectId, deployment.id);
      router.push(`/dashboard/projects/${projectId}/deployments/${started.id}`);
    } catch (error) {
      toast.error(error instanceof ApiRequestError ? error.message : 'Could not roll back.');
      setRollingBack(null);
    }
  };

  if (deployments.length === 0) {
    return <p className="text-muted-foreground text-sm">No deployments yet.</p>;
  }
  return (
    <ul className="divide-y rounded-lg border">
      {deployments.map((deployment) => (
        <li key={deployment.id} className="hover:bg-muted/40 flex items-center gap-2 pr-2">
          <Link
            href={`/dashboard/projects/${projectId}/deployments/${deployment.id}`}
            className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2 text-sm"
          >
            <DeploymentStatusBadge status={deployment.status} />
            <span className="font-mono text-xs">{deployment.commit.sha.slice(0, 7)}</span>
            <span className="min-w-0 flex-1 truncate">{deployment.commit.message}</span>
            {deployment.trigger !== 'manual' ? (
              <span className="text-muted-foreground hidden text-xs lg:inline">
                {DEPLOYMENT_TRIGGER_LABELS[deployment.trigger]}
              </span>
            ) : null}
            <span className="text-muted-foreground hidden text-xs tabular-nums sm:inline">
              {deployment.startedAt ? duration(deployment.startedAt, deployment.finishedAt) : null}
            </span>
            <span className="text-muted-foreground hidden text-xs md:inline">
              {new Date(deployment.createdAt).toLocaleString()}
            </span>
          </Link>
          {deployment.rollbackAvailable ? (
            <Button
              size="sm"
              variant="outline"
              disabled={!canDeploy || rollingBack !== null}
              title="Put this version live again, without rebuilding"
              onClick={() => void rollback(deployment)}
            >
              {rollingBack === deployment.id ? <Loader2 className="animate-spin" /> : <Undo2 />}
              Roll back
            </Button>
          ) : (
            <ChevronRight className="text-muted-foreground size-4" />
          )}
        </li>
      ))}
    </ul>
  );
}
