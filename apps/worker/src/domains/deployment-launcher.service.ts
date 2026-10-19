import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import {
  ACTIVE_DEPLOYMENT_STATUSES,
  type DeploymentJobData,
  DeploymentQueueJob,
  QueueName,
} from '@selfship/shared';
import type { DeploymentStatus } from '@selfship/db';
import { PrismaService } from '../prisma/prisma.service';

/** Starts deployments from inside the worker (settings changes). */
@Injectable()
export class DeploymentLauncher {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QueueName.DEPLOYMENTS) private readonly queue: Queue<DeploymentJobData>,
  ) {}

  /**
   * Re-runs the live image with today's settings (e.g. new domains), without
   * rebuilding. Skipped when a deployment is already queued or running: it
   * will pick up the new settings itself, or the next check retries.
   *
   * @param projectId - Project ID
   * @returns True if a redeploy was queued
   */
  async queueConfigRedeploy(projectId: string): Promise<boolean> {
    const created = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT 1 FROM projects WHERE id = ${projectId}::uuid FOR UPDATE`;
      const active = await tx.deployment.count({
        where: { projectId, status: { in: [...ACTIVE_DEPLOYMENT_STATUSES] as DeploymentStatus[] } },
      });
      if (active > 0) return null;
      const live = await tx.deployment.findFirst({ where: { projectId, status: 'live' } });
      if (!live?.imageTag) return null;
      return tx.deployment.create({
        data: {
          projectId,
          serverId: live.serverId,
          trigger: 'config',
          sourceDeploymentId: live.id,
          branch: live.branch,
          commitSha: live.commitSha,
          commitMessage: live.commitMessage,
          commitAuthor: live.commitAuthor,
        },
      });
    });
    if (!created) return false;
    await this.queue.add(
      DeploymentQueueJob.RUN,
      { deploymentId: created.id },
      { jobId: created.id, attempts: 1 },
    );
    return true;
  }
}
