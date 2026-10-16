import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import type { DeploymentStatus } from '@selfship/db';
import {
  ACTIVE_DEPLOYMENT_STATUSES,
  type DeploymentDto,
  DeploymentErrorCode,
  type DeploymentEvent,
  DeploymentQueueJob,
  deploymentStreamKey,
  ErrorCode,
  GithubErrorCode,
  QueueName,
} from '@selfship/shared';
import { GithubAppService } from '../github/github-app.service';
import { toGithubId } from '../github/github.constants';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS_CLIENT } from '../redis/redis.constants';
import {
  DEPLOYMENT_INCLUDE,
  type DeploymentWithServer,
  toDeploymentDto,
} from './deployment.mapper';

const PROJECT_NOT_FOUND = { code: ErrorCode.NOT_FOUND, message: 'Project not found.' };
const DEPLOYMENT_NOT_FOUND = { code: ErrorCode.NOT_FOUND, message: 'Deployment not found.' };
const ACTIVE = [...ACTIVE_DEPLOYMENT_STATUSES] as DeploymentStatus[];

/**
 * Deployments of a project: starting one (the worker does the work),
 * listing, cancelling, and reading their logs.
 */
@Injectable()
export class DeploymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly github: GithubAppService,
    @InjectQueue(QueueName.DEPLOYMENTS) private readonly queue: Queue,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /**
   * Deploys the head of the project's branch to its server.
   *
   * @param userId - Signed-in user
   * @param projectId - Project ID
   * @returns The queued deployment
   * @throws {NotFoundException} If the project isn't the user's
   * @throws {BadRequestException} `NO_SERVER` / `SERVER_NOT_READY`
   * @throws {ConflictException} `DEPLOYMENT_IN_PROGRESS`, or GitHub access removed
   */
  async create(userId: string, projectId: string): Promise<DeploymentDto> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, userId },
      include: { githubInstallation: true, server: true },
    });
    if (!project) throw new NotFoundException(PROJECT_NOT_FOUND);
    const { server, githubInstallation: installation } = project;
    if (!server) {
      throw new BadRequestException({
        code: DeploymentErrorCode.NO_SERVER,
        message: 'Choose a server for this project first.',
      });
    }
    if (server.status !== 'ready') {
      throw new BadRequestException({
        code: DeploymentErrorCode.SERVER_NOT_READY,
        message: `${server.name} isn't ready yet. Open the server and finish its setup.`,
      });
    }
    if (installation.deletedAt || installation.suspendedAt) {
      throw new ConflictException({
        code: GithubErrorCode.INSTALLATION_SUSPENDED,
        message: `Reconnect GitHub for ${installation.accountLogin} before deploying.`,
      });
    }
    await this.assertNoneActive(this.prisma, projectId);

    let commit;
    try {
      commit = await this.github.client.getCommit(
        toGithubId(installation.githubInstallationId),
        project.repoFullName,
        project.branch,
      );
    } catch (error) {
      throw this.github.toHttpError(error, {
        code: 'BRANCH_NOT_FOUND',
        message: `Branch "${project.branch}" wasn't found in ${project.repoFullName}.`,
      });
    }

    const deployment = await this.prisma.$transaction(async (tx) => {
      // Lock the project row so two clicks can't both start a deployment.
      await tx.$executeRaw`SELECT 1 FROM projects WHERE id = ${projectId}::uuid FOR UPDATE`;
      await this.assertNoneActive(tx, projectId);
      return tx.deployment.create({
        data: {
          projectId,
          serverId: server.id,
          triggeredById: userId,
          trigger: 'manual',
          branch: project.branch,
          commitSha: commit.sha,
          commitMessage: commit.message,
          commitAuthor: commit.author,
        },
        include: DEPLOYMENT_INCLUDE,
      });
    });
    // No automatic retries: a failed deployment is shown, and the user redeploys.
    await this.queue.add(
      DeploymentQueueJob.RUN,
      { deploymentId: deployment.id },
      { jobId: deployment.id, attempts: 1 },
    );
    return toDeploymentDto(deployment);
  }

  /**
   * Recent deployments of a project.
   *
   * @param userId - Signed-in user
   * @param projectId - Project ID
   * @returns Up to 30, newest first
   */
  async list(userId: string, projectId: string): Promise<DeploymentDto[]> {
    await this.assertProject(userId, projectId);
    const deployments = await this.prisma.deployment.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      take: 30,
      include: DEPLOYMENT_INCLUDE,
    });
    return deployments.map(toDeploymentDto);
  }

  /**
   * One deployment.
   *
   * @param userId - Signed-in user
   * @param projectId - Project ID
   * @param deploymentId - Deployment ID
   * @returns The deployment
   */
  async get(userId: string, projectId: string, deploymentId: string): Promise<DeploymentDto> {
    return toDeploymentDto(await this.findOwned(userId, projectId, deploymentId));
  }

  /**
   * Cancels a deployment. Queued ones stop immediately; running ones stop at
   * the worker's next check (within a few seconds). Once traffic is
   * switching it's too late.
   *
   * @param userId - Signed-in user
   * @param projectId - Project ID
   * @param deploymentId - Deployment ID
   * @returns The deployment
   * @throws {ConflictException} `NOT_CANCELLABLE`
   */
  async cancel(userId: string, projectId: string, deploymentId: string): Promise<DeploymentDto> {
    const deployment = await this.findOwned(userId, projectId, deploymentId);
    if (!ACTIVE.includes(deployment.status) || deployment.status === 'switching') {
      throw new ConflictException({
        code: DeploymentErrorCode.NOT_CANCELLABLE,
        message:
          deployment.status === 'switching'
            ? 'Traffic is already moving to the new version; it can no longer be cancelled.'
            : 'This deployment has already finished.',
      });
    }

    const now = new Date();
    if (deployment.status === 'queued') {
      // Only if the worker hasn't picked it up in the meantime.
      const { count } = await this.prisma.deployment.updateMany({
        where: { id: deployment.id, status: 'queued', startedAt: null },
        data: { status: 'cancelled', cancelRequestedAt: now, finishedAt: now },
      });
      if (count === 1) {
        await this.queue.remove(deployment.id).catch(() => undefined);
        const end: DeploymentEvent = { type: 'end', status: 'cancelled', error: null };
        await this.redis
          .xadd(deploymentStreamKey(deployment.id), '*', 'data', JSON.stringify(end))
          .catch(() => undefined);
        return this.get(userId, projectId, deploymentId);
      }
    }
    await this.prisma.deployment.update({
      where: { id: deployment.id },
      data: { cancelRequestedAt: now },
    });
    return this.get(userId, projectId, deploymentId);
  }

  /**
   * The saved log as events, for replaying after the live stream expired.
   *
   * @param deployment - Deployment
   * @returns JSON events: lines, then the end event
   */
  async savedEvents(deployment: DeploymentWithServer): Promise<string[]> {
    const chunks = await this.prisma.deploymentLogChunk.findMany({
      where: { deploymentId: deployment.id },
      orderBy: { seq: 'asc' },
      select: { content: true },
    });
    const events: DeploymentEvent[] = chunks
      .flatMap((chunk) => chunk.content.split('\n'))
      .filter(Boolean)
      .map((line) => ({ type: 'line', line }));
    events.push({ type: 'end', status: deployment.status, error: deployment.errorSummary });
    return events.map((event) => JSON.stringify(event));
  }

  /**
   * Loads a deployment of a project owned by the user.
   *
   * @throws {NotFoundException} If missing or not the user's
   */
  async findOwned(
    userId: string,
    projectId: string,
    deploymentId: string,
  ): Promise<DeploymentWithServer> {
    await this.assertProject(userId, projectId);
    const deployment = await this.prisma.deployment.findFirst({
      where: { id: deploymentId, projectId },
      include: DEPLOYMENT_INCLUDE,
    });
    if (!deployment) throw new NotFoundException(DEPLOYMENT_NOT_FOUND);
    return deployment;
  }

  /** One deployment at a time per project (the next one would replace it anyway). */
  private async assertNoneActive(
    db: Pick<PrismaService, 'deployment'>,
    projectId: string,
  ): Promise<void> {
    const active = await db.deployment.count({
      where: { projectId, status: { in: ACTIVE } },
    });
    if (active > 0) {
      throw new ConflictException({
        code: DeploymentErrorCode.DEPLOYMENT_IN_PROGRESS,
        message: 'A deployment is already in progress. Wait for it to finish, or cancel it.',
      });
    }
  }

  private async assertProject(userId: string, projectId: string): Promise<void> {
    const count = await this.prisma.project.count({ where: { id: projectId, userId } });
    if (count === 0) throw new NotFoundException(PROJECT_NOT_FOUND);
  }
}
