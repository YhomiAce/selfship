import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import type { Deployment, DeploymentStatus, GithubInstallation } from '@selfship/db';
import { EnvelopeCipher } from '@selfship/crypto';
import type { GithubAppClient } from '@selfship/github';
import {
  AppDeployer,
  DeployCancelledError,
  DeployError,
  type GitSource,
  HostKeyMismatchError,
  type ImageSource,
  type SshConnection,
} from '@selfship/remote';
import {
  type DeploymentEvent,
  DeploymentQueueJob,
  deploymentStreamKey,
  explainFailure,
  QueueName,
  type TeardownJobData,
} from '@selfship/shared';
import { AppConfigService } from '../config/app-config.service';
import { GITHUB_CLIENT } from '../github/github.module';
import { LiveLog } from '../logs/live-log';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS_CLIENT } from '../redis/redis.module';
import { ServerConnector } from '../servers/server-connector';
import { DomainRoutingService } from '../domains/domain-routing.service';
import { appId, envVarContext, resolveIpv4, splitEnv } from './deployment-plan';
import { StageClock } from './stage-clock';

/** Result of {@link DeploymentRunner.run}. */
export type RunResult = 'done' | 'wait';

/** Stages a deployment is "running" in (not queued, not finished). */
const RUNNING: DeploymentStatus[] = [
  'cloning',
  'building',
  'starting',
  'health_check',
  'switching',
];
/** Deployments still running after this long were interrupted (builds time out at 30 min). */
const STALE_DEPLOYMENT_MS = 60 * 60 * 1000;
/** How often the saved log is written and cancel requests are checked. */
const TICK_MS = 2_000;
/** Saved log size limit per deployment. */
const MAX_SAVED_LOG_CHARS = 5 * 1024 * 1024;

type DeploymentLog = LiveLog<DeploymentEvent>;

/** A deployment failed before the pipeline started (setup problem). */
class PrecheckError extends Error {}

/**
 * Runs one deployment: loads the project, decrypts its env vars, gets a
 * clone token, connects to the server, and drives {@link AppDeployer} while
 * recording stages, the (masked) log and the outcome.
 */
@Injectable()
export class DeploymentRunner implements OnModuleInit {
  private readonly logger = new Logger(DeploymentRunner.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: EnvelopeCipher,
    private readonly config: AppConfigService,
    private readonly connector: ServerConnector,
    private readonly domains: DomainRoutingService,
    @Inject(GITHUB_CLIENT) private readonly github: GithubAppClient | null,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @InjectQueue(QueueName.DEPLOYMENTS) private readonly queue: Queue<TeardownJobData>,
  ) {}

  /** Fails deployments left running by a crashed worker, so projects don't look busy forever. */
  async onModuleInit(): Promise<void> {
    const { count } = await this.prisma.deployment.updateMany({
      where: {
        status: { in: RUNNING },
        startedAt: { lt: new Date(Date.now() - STALE_DEPLOYMENT_MS) },
      },
      data: {
        status: 'failed',
        errorSummary: 'Interrupted (the worker restarted). Deploy again.',
        finishedAt: new Date(),
      },
    });
    if (count) this.logger.warn(`Marked ${count} interrupted deployment(s) as failed`);
  }

  /**
   * Runs a deployment, unless its server or project is busy.
   *
   * @param deploymentId - Deployment ID
   * @returns `wait` if it should be retried shortly (server/project busy), otherwise `done`
   */
  async run(deploymentId: string): Promise<RunResult> {
    const deployment = await this.prisma.deployment.findUnique({ where: { id: deploymentId } });
    if (!deployment || deployment.status !== 'queued') return 'done'; // gone or handled already

    if (deployment.cancelRequestedAt) {
      await this.prisma.deployment.update({
        where: { id: deployment.id },
        data: { status: 'cancelled', finishedAt: new Date() },
      });
      await new LiveLog<DeploymentEvent>(this.redis, deploymentStreamKey(deployment.id)).end({
        type: 'end',
        status: 'cancelled',
        error: null,
      });
      return 'done';
    }
    const claim = await this.claim(deployment);
    if (claim !== 'claimed') return claim;

    await this.execute(deployment);
    return 'done';
  }

  /**
   * Takes the deployment, unless its server already runs as many builds as
   * allowed or its project has one running. Check and claim happen under a
   * per-server Postgres advisory lock, so two workers (or two jobs picked up
   * at the same moment) can't both pass the check.
   *
   * @returns `claimed`, `wait` (busy, retry soon) or `done` (someone else took it)
   */
  private async claim(deployment: Deployment): Promise<'claimed' | RunResult> {
    return this.prisma.$transaction(async (tx) => {
      const lockKey = `selfship:deploy:${deployment.serverId ?? deployment.projectId}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
      // Claimed = started and not finished, whatever its status says yet.
      const others = {
        id: { not: deployment.id },
        startedAt: { not: null },
        finishedAt: null,
        status: { in: ['queued', ...RUNNING] as DeploymentStatus[] },
      };
      const [onServer, inProject] = await Promise.all([
        deployment.serverId
          ? tx.deployment.count({ where: { ...others, serverId: deployment.serverId } })
          : 0,
        tx.deployment.count({ where: { ...others, projectId: deployment.projectId } }),
      ]);
      if (inProject > 0 || onServer >= this.config.get('SERVER_BUILD_CONCURRENCY')) return 'wait';

      const { count } = await tx.deployment.updateMany({
        where: { id: deployment.id, status: 'queued', startedAt: null },
        data: { startedAt: new Date() },
      });
      return count === 1 ? 'claimed' : 'done';
    });
  }

  /** The pipeline, with all bookkeeping. Never throws for deployment failures. */
  private async execute(deployment: Deployment): Promise<void> {
    const clock = new StageClock();
    let log: DeploymentLog = new LiveLog(this.redis, deploymentStreamKey(deployment.id), {
      maxEntries: 20_000,
      maxSavedChars: MAX_SAVED_LOG_CHARS,
    });
    let ssh: SshConnection | null = null;
    let deployer: AppDeployer | null = null;
    let seq = 0;
    let saving: Promise<unknown> = Promise.resolve();

    /** Appends new log text to the saved log (chained, so chunks keep their order). */
    const save = (): Promise<unknown> => {
      const chunk = log.takeUnsaved();
      if (chunk) {
        const index = seq++;
        saving = saving
          .then(() =>
            this.prisma.deploymentLogChunk.create({
              data: { deploymentId: deployment.id, seq: index, content: chunk },
            }),
          )
          .catch((error: unknown) => {
            this.logger.warn(`Saving log chunk failed: ${String(error)}`);
          });
      }
      return saving;
    };
    const ticker = setInterval(() => {
      void save();
      void this.checkCancel(deployment.id, deployer);
    }, TICK_MS);

    try {
      const project = await this.prisma.project.findUniqueOrThrow({
        where: { id: deployment.projectId },
        include: { githubInstallation: true, envVars: true },
      });
      const server = deployment.serverId
        ? await this.prisma.server.findUnique({ where: { id: deployment.serverId } })
        : null;
      if (!server) throw new PrecheckError('The server for this deployment was removed.');
      if (server.status !== 'ready') {
        throw new PrecheckError(
          `${server.name} isn't ready (status: ${server.status}). Open the server and run setup.`,
        );
      }
      const vars = project.envVars.map((v) => ({
        key: v.key,
        scope: v.scope,
        value: this.cipher.decrypt(v.encryptedValue, envVarContext(project.id, v.key)),
      }));
      const source = await this.resolveSource(deployment, project);
      // From here on every secret is masked in the log and in error messages.
      log = new LiveLog(this.redis, deploymentStreamKey(deployment.id), {
        maxEntries: 20_000,
        maxSavedChars: MAX_SAVED_LOG_CHARS,
        secrets: [...(source.kind === 'git' ? [source.token] : []), ...vars.map((v) => v.value)],
      });

      const serverIpv4 = await resolveIpv4(server.host);
      const { routing, url } = await this.domains.prepare(project, serverIpv4, (line) => {
        log.line(line);
      });
      await this.prisma.deployment.update({ where: { id: deployment.id }, data: { url } });

      log.line(
        `→ ${source.kind === 'image' ? (deployment.trigger === 'rollback' ? 'Rolling back to' : 'Re-running') : 'Deploying'} ${project.repoFullName}@${deployment.branch} (${deployment.commitSha.slice(0, 7)}: ${deployment.commitMessage}) on ${server.name}`,
      );
      log.line(`→ Connecting to ${server.sshUser}@${server.host}:${server.port}`);
      try {
        ssh = (await this.connector.connect(server)).ssh;
      } catch (error) {
        // Show it on the server too, so "Check again" is the obvious next step.
        await this.prisma.server.update({
          where: { id: server.id },
          data: { status: 'unreachable', statusMessage: this.describe(error) },
        });
        throw error;
      }
      log.line('✓ Connected');

      deployer = new AppDeployer(
        ssh,
        {
          app: appId(project.id),
          deploymentId: deployment.id,
          source,
          settings: {
            adapter: project.adapter,
            installCommand: project.installCommand,
            buildCommand: project.buildCommand,
            startCommand: project.startCommand,
            outputDirectory: project.outputDirectory,
            port: project.port,
            nodeVersion: project.nodeVersion,
          },
          routing,
          healthCheckPath: project.healthCheckPath,
          env: splitEnv(vars),
        },
        {
          log: (line) => {
            log.line(line);
          },
          stage: async (stage) => {
            clock.enter(stage);
            await this.prisma.deployment.update({
              where: { id: deployment.id },
              data: { status: stage, stages: clock.toJSON() },
            });
            log.event({ type: 'stage', stage });
          },
        },
      );

      const outcome = await deployer.run();
      const now = new Date();
      clock.stop(now);
      log.line(`✓ Live at ${url}`);
      await this.domains.afterLive(project.id, serverIpv4);
      // If the project moved here from another server, remove it there.
      const elsewhere = await this.prisma.deployment.findMany({
        where: { projectId: project.id, status: 'live', serverId: { not: server.id } },
        distinct: ['serverId'],
        select: { serverId: true },
      });
      await this.prisma.$transaction([
        this.prisma.deployment.updateMany({
          where: { projectId: project.id, status: 'live', id: { not: deployment.id } },
          data: { status: 'replaced' },
        }),
        this.prisma.deployment.update({
          where: { id: deployment.id },
          data: {
            status: 'live',
            stages: clock.toJSON(),
            imageTag: outcome.imageTag,
            containerName: outcome.containerName,
            finishedAt: now,
          },
        }),
      ]);
      for (const { serverId } of elsewhere) {
        if (!serverId) continue;
        log.line('→ Removing the previous version from the old server');
        await this.queue.add(
          DeploymentQueueJob.TEARDOWN,
          { projectId: project.id, serverId },
          { jobId: `teardown-${project.id}-${serverId}-${deployment.id}` },
        );
      }
      await this.finish(log, save, { type: 'end', status: 'live', error: null });
    } catch (error) {
      clock.stop();
      const cancelled = error instanceof DeployCancelledError;
      const summary = cancelled ? null : log.mask(this.describe(error));
      const hint = cancelled
        ? null
        : explainFailure({ stage: clock.current, log: log.contents, error: summary });
      if (hint) log.line(`💡 ${hint.title}. ${hint.advice}`);
      if (cancelled) log.line('✗ Cancelled. The previous version is still live.');
      else log.line(`✗ ${summary ?? ''}`);
      if (!cancelled && !(error instanceof DeployError) && !(error instanceof PrecheckError)) {
        this.logger.warn(`Deployment ${deployment.id} failed: ${log.mask(String(error))}`);
      }
      await this.prisma.deployment.update({
        where: { id: deployment.id },
        data: {
          status: cancelled ? 'cancelled' : 'failed',
          failedStage: cancelled ? null : clock.current,
          errorSummary: summary,
          hintTitle: hint?.title ?? null,
          hintAdvice: hint?.advice ?? null,
          stages: clock.toJSON(),
          finishedAt: new Date(),
        },
      });
      await this.finish(log, save, {
        type: 'end',
        status: cancelled ? 'cancelled' : 'failed',
        error: summary,
      });
    } finally {
      clearInterval(ticker);
      ssh?.close();
    }
  }

  /**
   * What to deploy: a fresh build of the commit (needs GitHub access), or
   * for rollbacks and config redeploys the image an earlier deployment built.
   *
   * @throws {PrecheckError} If GitHub access or the earlier image is missing
   */
  private async resolveSource(
    deployment: Deployment,
    project: {
      id: string;
      repoFullName: string;
      rootDirectory: string;
      githubInstallation: GithubInstallation;
    },
  ): Promise<GitSource | ImageSource> {
    if (deployment.trigger === 'rollback' || deployment.trigger === 'config') {
      const earlier = deployment.sourceDeploymentId
        ? await this.prisma.deployment.findFirst({
            where: { id: deployment.sourceDeploymentId, projectId: project.id },
          })
        : null;
      if (!earlier?.imageTag) {
        throw new PrecheckError('The deployment to reuse no longer exists. Deploy again instead.');
      }
      return { kind: 'image', imageTag: earlier.imageTag };
    }

    if (!this.github) throw new PrecheckError('GitHub isn’t configured on this Selfship worker.');
    const installation = project.githubInstallation;
    if (installation.deletedAt || installation.suspendedAt) {
      throw new PrecheckError(
        `The Selfship GitHub app no longer has access to ${installation.accountLogin}. Reconnect GitHub.`,
      );
    }
    return {
      kind: 'git',
      cloneUrl: this.github.cloneUrl(project.repoFullName),
      sha: deployment.commitSha,
      rootDirectory: project.rootDirectory,
      token: await this.github.getInstallationToken(Number(installation.githubInstallationId)),
    };
  }

  /** Saves the rest of the log and closes the live stream. */
  private async finish(
    log: DeploymentLog,
    save: () => Promise<unknown>,
    end: DeploymentEvent,
  ): Promise<void> {
    await save();
    await log.end(end);
  }

  /** Stops the deployer when the user asked to cancel. */
  private async checkCancel(deploymentId: string, deployer: AppDeployer | null): Promise<void> {
    if (!deployer) return;
    try {
      const row = await this.prisma.deployment.findUnique({
        where: { id: deploymentId },
        select: { cancelRequestedAt: true },
      });
      if (row?.cancelRequestedAt) await deployer.cancel();
    } catch (error) {
      this.logger.warn(`Cancel check failed: ${String(error)}`);
    }
  }

  /** A message users can act on. */
  private describe(error: unknown): string {
    if (error instanceof DeployError || error instanceof PrecheckError) return error.message;
    if (error instanceof HostKeyMismatchError) {
      return `${error.message} Open the server in Selfship to resolve it.`;
    }
    const text = error instanceof Error ? error.message : String(error);
    if (/authentication methods failed/i.test(text)) {
      return "Couldn't log in to the server: Selfship's key was removed from it. Open the server and reconnect.";
    }
    if (/ETIMEDOUT|EHOSTUNREACH|ECONNREFUSED|Timed out while waiting for handshake/.test(text)) {
      return "Couldn't reach the server over SSH. Is it running, and does its firewall allow SSH?";
    }
    return `Deployment failed: ${text.slice(0, 300)}`;
  }
}
