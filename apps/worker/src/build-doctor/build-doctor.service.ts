import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { Queue } from 'bullmq';
import type { Prisma } from '@selfship/db';
import { getAdapter } from '@selfship/adapters';
import type { GithubAppClient } from '@selfship/github';
import { ensureSwap, pruneDocker } from '@selfship/remote';
import {
  AUTO_REMEDIATION_ACTIONS,
  BuildDoctorJob,
  type DiagnoseJobData,
  type Diagnosis,
  type PackageManager,
  QueueName,
} from '@selfship/shared';
import { AppConfigService } from '../config/app-config.service';
import { DeploymentLauncher } from '../domains/deployment-launcher.service';
import { GITHUB_CLIENT } from '../github/github.module';
import { PrismaService } from '../prisma/prisma.service';
import { ServerConnector } from '../servers/server-connector';
import { type DiagnosisModel, NoDiagnosisError } from './claude';
import { failureFingerprint } from './fingerprint';
import { buildUserMessage, type DiagnosisContext } from './prompt';
import { redactSecrets } from './redact';

/** Injection token for the diagnosis model (`null` when no API key is configured). */
export const DIAGNOSIS_MODEL = Symbol('DIAGNOSIS_MODEL');

/** Log lines sent to the model (the end of the log, where the error is). */
const LOG_TAIL_LINES = 300;
/** A reused diagnosis must be this recent. */
const CACHE_DAYS = 30;
/** Folders not worth listing in the file tree. */
const SKIPPED_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  'dist',
  'build',
  '.turbo',
  'coverage',
  'vendor',
]);

/** Settings columns of a project. */
type ProjectSettingsRow = {
  adapter: Parameters<typeof getAdapter>[0];
  installCommand: string | null;
  buildCommand: string | null;
  startCommand: string | null;
  outputDirectory: string | null;
  port: number;
  nodeVersion: number | null;
};

/**
 * Build Doctor: AI diagnosis of failed deployments.
 *
 * Runs after a failure that the rule-based hints couldn't explain (users can
 * also ask for it). Sends Claude a redacted description of the failure, never
 * secret values, and stores the structured answer. Server-side problems with
 * a safe, pre-written fix (add swap, prune Docker, retry) are fixed
 * automatically, once per deployment; settings changes wait for the user.
 */
@Injectable()
export class BuildDoctorService {
  private readonly logger = new Logger(BuildDoctorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly connector: ServerConnector,
    private readonly launcher: DeploymentLauncher,
    @Inject(DIAGNOSIS_MODEL) private readonly model: DiagnosisModel | null,
    @Inject(GITHUB_CLIENT) private readonly github: GithubAppClient | null,
    @InjectQueue(QueueName.BUILD_DOCTOR) private readonly queue: Queue<DiagnoseJobData>,
  ) {}

  /** Whether Build Doctor is set up on this worker (an API key is configured). */
  get available(): boolean {
    return this.model !== null;
  }

  /**
   * Queues a diagnosis of a failed deployment, if Build Doctor is set up and
   * enabled for the project. Called by the deployment runner.
   *
   * @param deploymentId - Failed deployment
   */
  async requestFor(deploymentId: string): Promise<void> {
    if (!this.model) return;
    const deployment = await this.prisma.deployment.findUnique({
      where: { id: deploymentId },
      include: { project: { select: { userId: true, buildDoctor: true } } },
    });
    if (!deployment?.project.buildDoctor || deployment.status !== 'failed') return;
    const diagnosis = await this.prisma.buildDiagnosis.upsert({
      where: { deploymentId },
      create: { deploymentId, projectId: deployment.projectId, userId: deployment.project.userId },
      update: {},
    });
    if (diagnosis.status !== 'pending') return;
    await this.queue.add(
      BuildDoctorJob.DIAGNOSE,
      { diagnosisId: diagnosis.id },
      { jobId: diagnosis.id, attempts: 2, backoff: { type: 'exponential', delay: 10_000 } },
    );
  }

  /**
   * Produces a diagnosis. Expected failures are recorded on the diagnosis;
   * only unexpected API/network errors throw (so BullMQ retries once).
   *
   * @param diagnosisId - Diagnosis to produce
   */
  async run(diagnosisId: string): Promise<void> {
    const record = await this.prisma.buildDiagnosis.findUnique({
      where: { id: diagnosisId },
      include: {
        deployment: {
          include: {
            server: true,
            project: {
              include: {
                githubInstallation: true,
                envVars: { select: { key: true, scope: true } },
              },
            },
          },
        },
      },
    });
    if (!record || record.status !== 'pending') return;
    if (!this.model) {
      await this.finish(diagnosisId, {
        status: 'skipped',
        error: 'Build Doctor is not set up on this Selfship.',
      });
      return;
    }

    const used = await this.prisma.buildDiagnosis.count({
      where: {
        userId: record.userId,
        status: 'ready',
        cached: false,
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
    });
    if (used >= this.config.get('BUILD_DOCTOR_DAILY_LIMIT')) {
      await this.finish(diagnosisId, {
        status: 'skipped',
        error: "You've reached today's Build Doctor limit. It resets within 24 hours.",
      });
      return;
    }

    const { deployment } = record;
    const { project } = deployment;
    const files = await this.repositoryFiles(project, deployment.commitSha);
    const logTail = redactSecrets(await this.logTail(deployment.id));
    const context: DiagnosisContext = {
      stage: deployment.failedStage,
      errorSummary: deployment.errorSummary ? redactSecrets(deployment.errorSummary) : null,
      adapter: project.adapter,
      settings: {
        installCommand: project.installCommand,
        buildCommand: project.buildCommand,
        startCommand: project.startCommand,
        outputDirectory: project.outputDirectory,
        port: project.port,
        nodeVersion: project.nodeVersion,
        rootDirectory: project.rootDirectory || '(repository root)',
        healthCheckPath: project.healthCheckPath,
      },
      packageManager: files.packageManager,
      server: {
        os: deployment.server?.os ?? null,
        arch: deployment.server?.arch ?? null,
        ramMb: deployment.server?.ramMb ?? null,
        swapMb: deployment.server?.swapMb ?? null,
        diskFreeGb: deployment.server?.diskFreeGb ?? null,
      },
      envKeys: project.envVars.map((v) => ({ key: v.key, scope: v.scope })),
      ruleHint: deployment.hintTitle
        ? `${deployment.hintTitle}. ${deployment.hintAdvice ?? ''}`
        : null,
      packageJson: files.packageJson ? redactSecrets(files.packageJson) : null,
      fileTree: files.tree,
      dockerfile: this.dockerfile(project, files),
      logTail,
    };

    const fingerprint = failureFingerprint({
      adapter: project.adapter,
      stage: deployment.failedStage,
      log: logTail,
      packageJson: files.packageJson,
    });
    const reused = await this.prisma.buildDiagnosis.findFirst({
      where: {
        projectId: project.id,
        fingerprint,
        status: 'ready',
        id: { not: diagnosisId },
        createdAt: { gte: new Date(Date.now() - CACHE_DAYS * 24 * 60 * 60 * 1000) },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (reused?.result) {
      await this.finish(diagnosisId, {
        status: 'ready',
        fingerprint,
        result: reused.result,
        cached: true,
        model: reused.model,
      });
      return;
    }

    let answer;
    try {
      answer = await this.model.diagnose(buildUserMessage(context));
    } catch (error) {
      if (error instanceof NoDiagnosisError) {
        await this.finish(diagnosisId, { status: 'failed', fingerprint, error: error.message });
        return;
      }
      if (
        error instanceof Anthropic.APIError &&
        error.status !== undefined &&
        error.status < 500 &&
        error.status !== 429
      ) {
        // Not worth retrying (bad key, invalid request): record it.
        this.logger.warn(`Build Doctor request rejected (${error.status}): ${error.message}`);
        await this.finish(diagnosisId, {
          status: 'failed',
          fingerprint,
          error:
            "Build Doctor couldn't reach the AI service. Selfship's operator has been notified in the logs.",
        });
        return;
      }
      throw error;
    }

    const autoRemediation = await this.autoRemediate(answer.diagnosis, deployment);
    await this.finish(diagnosisId, {
      status: 'ready',
      fingerprint,
      result: answer.diagnosis,
      model: answer.model,
      inputTokens: answer.usage.inputTokens,
      outputTokens: answer.usage.outputTokens,
      cacheReadTokens: answer.usage.cacheReadTokens,
      autoRemediation,
    });
    this.logger.log(
      `Diagnosed ${deployment.id} (${answer.diagnosis.category}, ${answer.diagnosis.confidence}) with ${answer.model}: ` +
        `${answer.usage.inputTokens} in / ${answer.usage.outputTokens} out / ${answer.usage.cacheReadTokens} cached`,
    );
  }

  /**
   * Runs a safe server fix (once per deployment chain) and retries the
   * deployment. Settings changes are never applied here.
   *
   * @returns What was done, or null
   */
  private async autoRemediate(
    diagnosis: Diagnosis,
    deployment: {
      id: string;
      autoRetry: boolean;
      server: Parameters<ServerConnector['connect']>[0] | null;
    },
  ): Promise<string | null> {
    const action = diagnosis.remediation?.action;
    if (
      !action ||
      !AUTO_REMEDIATION_ACTIONS.includes(action) ||
      !['server_resources', 'platform', 'network'].includes(diagnosis.category) ||
      diagnosis.confidence === 'low' ||
      deployment.autoRetry ||
      !deployment.server
    ) {
      return null;
    }
    try {
      let done = '';
      if (action !== 'retry') {
        const { ssh } = await this.connector.connect(deployment.server);
        try {
          done = action === 'add_swap' ? await ensureSwap(ssh) : await pruneDocker(ssh);
        } finally {
          ssh.close();
        }
      }
      const retryId = await this.launcher.queueAutoRetry(deployment.id);
      return (
        [done, retryId ? 'Started the deployment again.' : ''].filter(Boolean).join(' ') || null
      );
    } catch (error) {
      this.logger.warn(`Automatic fix ${action} for ${deployment.id} failed: ${String(error)}`);
      return null;
    }
  }

  /** The last lines of the saved log. */
  private async logTail(deploymentId: string): Promise<string> {
    const chunks = await this.prisma.deploymentLogChunk.findMany({
      where: { deploymentId },
      orderBy: { seq: 'asc' },
      select: { content: true },
    });
    return chunks
      .map((c) => c.content)
      .join('')
      .split('\n')
      .slice(-LOG_TAIL_LINES)
      .join('\n');
  }

  /**
   * package.json, the repository's Dockerfile and a depth-2 file tree, read
   * through GitHub at the failed commit (the clone is already deleted).
   * Missing pieces are fine: the model is told they're not available.
   */
  private async repositoryFiles(
    project: {
      repoFullName: string;
      rootDirectory: string;
      githubInstallation: { githubInstallationId: bigint };
    },
    sha: string,
  ): Promise<{
    packageJson: string | null;
    dockerfile: string | null;
    tree: string[];
    packageManager: PackageManager | null;
  }> {
    const empty = { packageJson: null, dockerfile: null, tree: [], packageManager: null };
    if (!this.github) return empty;
    const installation = Number(project.githubInstallation.githubInstallationId);
    const root = project.rootDirectory;
    const join = (name: string): string => (root ? `${root}/${name}` : name);
    try {
      const top =
        (await this.github.listDirectory(installation, project.repoFullName, root, sha)) ?? [];
      const tree: string[] = [];
      for (const entry of top.slice(0, 60)) {
        tree.push(entry.type === 'dir' ? `${entry.name}/` : entry.name);
        if (entry.type !== 'dir' || SKIPPED_DIRS.has(entry.name) || tree.length > 150) continue;
        const children =
          (await this.github.listDirectory(
            installation,
            project.repoFullName,
            join(entry.name),
            sha,
          )) ?? [];
        for (const child of children.slice(0, 25)) {
          tree.push(`  ${entry.name}/${child.name}${child.type === 'dir' ? '/' : ''}`);
        }
      }
      const names = new Set(top.map((e) => e.name));
      const [packageJson, dockerfile] = await Promise.all([
        names.has('package.json')
          ? this.github.readFile(installation, project.repoFullName, join('package.json'), sha)
          : null,
        names.has('Dockerfile')
          ? this.github.readFile(installation, project.repoFullName, join('Dockerfile'), sha)
          : null,
      ]);
      const packageManager: PackageManager | null = names.has('pnpm-lock.yaml')
        ? 'pnpm'
        : names.has('yarn.lock')
          ? names.has('.yarnrc.yml')
            ? 'yarn-berry'
            : 'yarn'
          : names.has('bun.lockb') || names.has('bun.lock')
            ? 'bun'
            : packageJson
              ? 'npm'
              : null;
      return { packageJson, dockerfile, tree, packageManager };
    } catch (error) {
      this.logger.warn(`Reading repository files for Build Doctor failed: ${String(error)}`);
      return empty;
    }
  }

  /** The Dockerfile that was built: generated from the settings, or the repository's own. */
  private dockerfile(
    project: ProjectSettingsRow,
    files: { dockerfile: string | null; packageManager: PackageManager | null },
  ): string | null {
    if (project.adapter === 'dockerfile')
      return files.dockerfile ? redactSecrets(files.dockerfile) : null;
    try {
      return (
        getAdapter(project.adapter).buildFiles({
          settings: {
            adapter: project.adapter,
            installCommand: project.installCommand,
            buildCommand: project.buildCommand,
            startCommand: project.startCommand,
            outputDirectory: project.outputDirectory,
            port: project.port,
            nodeVersion: project.nodeVersion,
          },
          packageManager: files.packageManager,
          buildArgNames: [],
        })?.Dockerfile ?? null
      );
    } catch {
      return null;
    }
  }

  private async finish(
    id: string,
    data: Omit<Prisma.BuildDiagnosisUpdateInput, 'deployment' | 'project'>,
  ): Promise<void> {
    await this.prisma.buildDiagnosis.update({
      where: { id },
      data: { ...data, finishedAt: new Date() },
    });
  }
}
