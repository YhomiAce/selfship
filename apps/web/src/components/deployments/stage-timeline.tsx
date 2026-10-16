import { Check, Circle, Loader2, X } from 'lucide-react';
import {
  DEPLOYMENT_STAGE_LABELS,
  DEPLOYMENT_STAGES,
  type DeploymentDto,
  type DeploymentStage,
} from '@selfship/shared';
import { cn } from '@/lib/utils';

/** Seconds between two ISO timestamps, e.g. "12s" or "1m 05s". */
export function duration(from: string, to: string | null, now = Date.now()): string {
  const ms = Math.max(0, (to ? Date.parse(to) : now) - Date.parse(from));
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
}

type StageState = 'done' | 'running' | 'failed' | 'pending';

/** Where each stage stands, from the deployment's status and timings. */
function stageState(deployment: DeploymentDto, stage: DeploymentStage): StageState {
  const timing = deployment.stages[stage];
  if (deployment.failedStage === stage) return 'failed';
  if (!timing) return 'pending';
  if (timing.finishedAt) return 'done';
  return deployment.status === stage ? 'running' : 'done';
}

const ICONS: Record<StageState, React.ReactNode> = {
  done: <Check className="size-3.5 text-emerald-600 dark:text-emerald-400" />,
  running: <Loader2 className="size-3.5 animate-spin text-sky-600 dark:text-sky-400" />,
  failed: <X className="size-3.5 text-red-600 dark:text-red-400" />,
  pending: <Circle className="text-muted-foreground size-3" />,
};

/**
 * The pipeline as steps (clone → build → start → health check → switch),
 * with the time each took.
 *
 * @param props.deployment - Deployment
 */
export function StageTimeline({ deployment }: { deployment: DeploymentDto }): React.ReactNode {
  return (
    <ol className="grid grid-cols-2 gap-2 sm:grid-cols-5">
      {DEPLOYMENT_STAGES.map((stage) => {
        const state = stageState(deployment, stage);
        const timing = deployment.stages[stage];
        return (
          <li
            key={stage}
            className={cn(
              'flex flex-col gap-0.5 rounded-lg border px-3 py-2 text-sm',
              state === 'running' && 'border-sky-500/60',
              state === 'failed' && 'border-red-500/60',
              state === 'pending' && 'opacity-60',
            )}
          >
            <span className="flex items-center gap-1.5 font-medium">
              {ICONS[state]}
              {DEPLOYMENT_STAGE_LABELS[stage]}
            </span>
            <span className="text-muted-foreground text-xs tabular-nums">
              {timing ? duration(timing.startedAt, timing.finishedAt) : '—'}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
