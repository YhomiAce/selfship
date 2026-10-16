/**
 * Lifecycle of a deployment. The in-progress states are also the pipeline's
 * stages, in order, so the UI can show where it is and where it failed.
 */
export const DEPLOYMENT_STAGES = [
  'cloning',
  'building',
  'starting',
  'health_check',
  'switching',
] as const;
export type DeploymentStage = (typeof DEPLOYMENT_STAGES)[number];

export const DEPLOYMENT_STATUSES = [
  'queued',
  ...DEPLOYMENT_STAGES,
  'live',
  'failed',
  'cancelled',
  /** Was live, then a newer deployment took over. */
  'replaced',
] as const;
export type DeploymentStatus = (typeof DEPLOYMENT_STATUSES)[number];

/** Statuses of a deployment that hasn't finished yet. */
export const ACTIVE_DEPLOYMENT_STATUSES: readonly DeploymentStatus[] = [
  'queued',
  ...DEPLOYMENT_STAGES,
];

/** Labels for the UI. */
export const DEPLOYMENT_STATUS_LABELS: Record<DeploymentStatus, string> = {
  queued: 'Queued',
  cloning: 'Cloning',
  building: 'Building',
  starting: 'Starting',
  health_check: 'Health check',
  switching: 'Switching traffic',
  live: 'Live',
  failed: 'Failed',
  cancelled: 'Cancelled',
  replaced: 'Replaced',
};

/** Stage names for the timeline. */
export const DEPLOYMENT_STAGE_LABELS: Record<DeploymentStage, string> = {
  cloning: 'Clone',
  building: 'Build',
  starting: 'Start',
  health_check: 'Health check',
  switching: 'Switch traffic',
};

/** What started a deployment (`push` and `rollback` arrive in M5). */
export type DeploymentTrigger = 'manual' | 'push' | 'rollback';

/** Start/end times of one stage (ISO strings). */
export interface StageTiming {
  startedAt: string;
  finishedAt: string | null;
}

/** Public representation of a deployment. */
export interface DeploymentDto {
  id: string;
  projectId: string;
  server: { id: string; name: string } | null;
  status: DeploymentStatus;
  trigger: DeploymentTrigger;
  branch: string;
  commit: { sha: string; message: string; author: string | null };
  /** Where the app is reachable once live. */
  url: string | null;
  stages: Partial<Record<DeploymentStage, StageTiming>>;
  /** Stage that failed, if any. */
  failedStage: DeploymentStage | null;
  errorSummary: string | null;
  cancelRequested: boolean;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

/** Response of `GET /projects/:id/deployments`. */
export interface DeploymentListResponse {
  items: DeploymentDto[];
}

/** Events on `GET /projects/:id/deployments/:deploymentId/stream` (Server-Sent Events). */
export type DeploymentEvent =
  | { type: 'line'; line: string }
  | { type: 'stage'; stage: DeploymentStage }
  | { type: 'end'; status: DeploymentStatus; error: string | null };

/** Error codes specific to deployments. */
export const DeploymentErrorCode = {
  NO_SERVER: 'NO_SERVER',
  SERVER_NOT_READY: 'SERVER_NOT_READY',
  DEPLOYMENT_IN_PROGRESS: 'DEPLOYMENT_IN_PROGRESS',
  NOT_CANCELLABLE: 'NOT_CANCELLABLE',
} as const;
