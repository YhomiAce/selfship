import { z } from 'zod';
import type { Deployment, Server } from '@selfship/db';
import { DEPLOYMENT_STAGES, type DeploymentDto, type DeploymentStage } from '@selfship/shared';

/** A deployment with its server's name loaded. */
export type DeploymentWithServer = Deployment & { server: Pick<Server, 'id' | 'name'> | null };

/** Prisma include that loads what {@link toDeploymentDto} needs. */
export const DEPLOYMENT_INCLUDE = { server: { select: { id: true, name: true } } } as const;

/** `Deployment.stages` is JSON written by the worker: validate before trusting it. */
const StagesSchema = z
  .partialRecord(
    z.enum(DEPLOYMENT_STAGES),
    z.object({ startedAt: z.string(), finishedAt: z.string().nullable() }),
  )
  .catch({});

/** Stages a deployment can fail in (the column also allows other statuses). */
function asStage(value: string | null): DeploymentStage | null {
  return (DEPLOYMENT_STAGES as readonly string[]).includes(value ?? '')
    ? (value as DeploymentStage)
    : null;
}

/**
 * Converts a deployment record to the public DTO.
 *
 * @param deployment - Deployment with its server
 * @returns DTO for the API
 */
export function toDeploymentDto(deployment: DeploymentWithServer): DeploymentDto {
  return {
    id: deployment.id,
    projectId: deployment.projectId,
    server: deployment.server ? { id: deployment.server.id, name: deployment.server.name } : null,
    status: deployment.status,
    trigger: deployment.trigger,
    branch: deployment.branch,
    commit: {
      sha: deployment.commitSha,
      message: deployment.commitMessage,
      author: deployment.commitAuthor,
    },
    url: deployment.url,
    stages: StagesSchema.parse(deployment.stages),
    failedStage: asStage(deployment.failedStage),
    errorSummary: deployment.errorSummary,
    cancelRequested: deployment.cancelRequestedAt !== null,
    createdAt: deployment.createdAt.toISOString(),
    startedAt: deployment.startedAt?.toISOString() ?? null,
    finishedAt: deployment.finishedAt?.toISOString() ?? null,
  };
}
