import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import type { PushEvent } from '@selfship/github';
import {
  type DeploymentEvent,
  DeploymentQueueJob,
  deploymentStreamKey,
  QueueName,
} from '@selfship/shared';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS_CLIENT } from '../redis/redis.constants';

/** What a push led to (returned to GitHub's delivery log via the webhook ack). */
export interface AutoDeployResult {
  /** Deployments queued. */
  queued: number;
  /** Why nothing was deployed, when nothing was. */
  skipped?: 'not_a_branch' | 'branch_deleted' | 'skip_marker' | 'no_matching_project';
}

/** Commit messages containing one of these don't trigger a deployment. */
const SKIP_MARKER = /\[(skip deploy|deploy skip|skip ci|ci skip)\]/i;

/**
 * Deploys projects automatically when their branch receives a push.
 *
 * The newest push wins: a deployment of the project that is still waiting is
 * cancelled (it would be replaced right away anyway), while one that is
 * already running finishes first and the new one waits for it.
 */
@Injectable()
export class AutoDeployService {
  private readonly logger = new Logger(AutoDeployService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QueueName.DEPLOYMENTS) private readonly queue: Queue,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /**
   * Handles a verified `push` webhook.
   *
   * @param event - Parsed push event
   * @returns How many deployments were queued (or why none)
   */
  async handlePush(event: PushEvent): Promise<AutoDeployResult> {
    if (!event.ref.startsWith('refs/heads/')) return { queued: 0, skipped: 'not_a_branch' };
    if (event.deleted || /^0+$/.test(event.after) || !event.head_commit) {
      return { queued: 0, skipped: 'branch_deleted' };
    }
    const commit = event.head_commit;
    if (SKIP_MARKER.test(commit.message)) return { queued: 0, skipped: 'skip_marker' };
    if (!event.installation) return { queued: 0, skipped: 'no_matching_project' };

    const branch = event.ref.slice('refs/heads/'.length);
    // Only projects created through the installation that sent the push.
    const projects = await this.prisma.project.findMany({
      where: {
        repoId: BigInt(event.repository.id),
        branch,
        autoDeploy: true,
        server: { status: 'ready' },
        githubInstallation: {
          githubInstallationId: BigInt(event.installation.id),
          deletedAt: null,
          suspendedAt: null,
        },
      },
      select: { id: true, serverId: true, name: true },
    });

    let queued = 0;
    for (const project of projects) {
      if (!project.serverId) continue;
      if (await this.deploy(project.id, project.serverId, branch, commit)) queued++;
    }
    if (queued > 0) {
      this.logger.log(
        `Push to ${event.repository.full_name}@${branch} (${commit.id.slice(0, 7)}): ${queued} deployment(s) queued`,
      );
    }
    return queued > 0 ? { queued } : { queued: 0, skipped: 'no_matching_project' };
  }

  /**
   * Queues one project's deployment of the pushed commit.
   *
   * @returns False if this commit was already queued or deployed (GitHub redelivery)
   */
  private async deploy(
    projectId: string,
    serverId: string,
    branch: string,
    commit: NonNullable<PushEvent['head_commit']>,
  ): Promise<boolean> {
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT 1 FROM projects WHERE id = ${projectId}::uuid FOR UPDATE`;
      const duplicate = await tx.deployment.count({
        where: { projectId, commitSha: commit.id, trigger: 'push' },
      });
      if (duplicate > 0) return null;

      const now = new Date();
      const waiting = await tx.deployment.findMany({
        where: { projectId, status: 'queued', startedAt: null },
        select: { id: true },
      });
      await tx.deployment.updateMany({
        where: { id: { in: waiting.map((d) => d.id) } },
        data: { status: 'cancelled', cancelRequestedAt: now, finishedAt: now },
      });
      const created = await tx.deployment.create({
        data: {
          projectId,
          serverId,
          trigger: 'push',
          branch,
          commitSha: commit.id,
          commitMessage: (commit.message.split('\n')[0] ?? '').slice(0, 300),
          commitAuthor: commit.author?.username ?? commit.author?.name ?? null,
        },
      });
      return { created, superseded: waiting.map((d) => d.id) };
    });
    if (!result) return false;

    for (const id of result.superseded) {
      await this.queue.remove(id).catch(() => undefined);
      const end: DeploymentEvent = { type: 'end', status: 'cancelled', error: null };
      await this.redis
        .xadd(deploymentStreamKey(id), '*', 'data', JSON.stringify(end))
        .catch(() => undefined);
    }
    await this.queue.add(
      DeploymentQueueJob.RUN,
      { deploymentId: result.created.id },
      { jobId: result.created.id, attempts: 1 },
    );
    return true;
  }
}
