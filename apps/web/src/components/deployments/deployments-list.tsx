import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import type { DeploymentDto } from '@selfship/shared';
import { DeploymentStatusBadge } from './deployment-status-badge';
import { duration } from './stage-timeline';

/**
 * Recent deployments of a project, linking to their logs.
 *
 * @param props.projectId - Project ID
 * @param props.deployments - Deployments, newest first
 */
export function DeploymentsList({
  projectId,
  deployments,
}: {
  projectId: string;
  deployments: DeploymentDto[];
}): React.ReactNode {
  if (deployments.length === 0) {
    return <p className="text-muted-foreground text-sm">No deployments yet.</p>;
  }
  return (
    <ul className="divide-y rounded-lg border">
      {deployments.map((deployment) => (
        <li key={deployment.id}>
          <Link
            href={`/dashboard/projects/${projectId}/deployments/${deployment.id}`}
            className="hover:bg-muted/40 flex items-center gap-3 px-3 py-2 text-sm"
          >
            <DeploymentStatusBadge status={deployment.status} />
            <span className="font-mono text-xs">{deployment.commit.sha.slice(0, 7)}</span>
            <span className="min-w-0 flex-1 truncate">{deployment.commit.message}</span>
            <span className="text-muted-foreground hidden text-xs tabular-nums sm:inline">
              {deployment.startedAt ? duration(deployment.startedAt, deployment.finishedAt) : null}
            </span>
            <span className="text-muted-foreground hidden text-xs md:inline">
              {new Date(deployment.createdAt).toLocaleString()}
            </span>
            <ChevronRight className="text-muted-foreground size-4" />
          </Link>
        </li>
      ))}
    </ul>
  );
}
