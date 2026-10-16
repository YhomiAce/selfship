import { Loader2 } from 'lucide-react';
import {
  ACTIVE_DEPLOYMENT_STATUSES,
  DEPLOYMENT_STATUS_LABELS,
  type DeploymentStatus,
} from '@selfship/shared';
import { cn } from '@/lib/utils';

const STYLES: Record<DeploymentStatus, string> = {
  queued: 'bg-muted text-muted-foreground',
  cloning: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300',
  building: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300',
  starting: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300',
  health_check: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300',
  switching: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300',
  live: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  failed: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
  cancelled: 'bg-muted text-muted-foreground',
  replaced: 'bg-muted text-muted-foreground',
};

/**
 * Colour-coded deployment status, with a spinner while in progress.
 *
 * @param props.status - Deployment status
 */
export function DeploymentStatusBadge({ status }: { status: DeploymentStatus }): React.ReactNode {
  const busy = ACTIVE_DEPLOYMENT_STATUSES.includes(status);
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium whitespace-nowrap',
        STYLES[status],
      )}
    >
      {busy ? <Loader2 className="size-3 animate-spin" /> : null}
      {DEPLOYMENT_STATUS_LABELS[status]}
    </span>
  );
}
