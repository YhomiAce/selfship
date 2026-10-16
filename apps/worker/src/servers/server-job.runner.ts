import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { Redis } from 'ioredis';
import type { Server, ServerJob } from '@selfship/db';
import { DecryptionError, EnvelopeCipher } from '@selfship/crypto';
import {
  assertPublicHost,
  bootstrapServer,
  ForbiddenHostError,
  HostKeyMismatchError,
  preflight,
  type PreflightReport,
  RemoteCommandError,
  SshConnection,
} from '@selfship/remote';
import { AppConfigService } from '../config/app-config.service';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS_CLIENT } from '../redis/redis.module';
import { JobLog } from './job-log';

/** Jobs still "running" after this long were interrupted (bootstrap times out at 20 min). */
const STALE_JOB_MS = 30 * 60 * 1000;

/** Outcome used to update the server after a failure. */
interface Failure {
  status: 'unreachable' | 'setup_failed' | 'needs_attention';
  message: string;
}

/**
 * Must match the API's `sshKeyContext` (apps/api/src/servers/servers.service.ts).
 *
 * @param serverId - Server ID
 * @returns Encryption context of the server's private key
 */
export function sshKeyContext(serverId: string): string {
  return `server:${serverId}:ssh-key`;
}

/**
 * Turns connection/setup errors into a status and a message users can act on.
 *
 * @param error - Whatever was thrown
 * @param server - The server (for user/host in messages)
 * @param phase - Where it failed
 * @returns Status and message
 */
export function classifyFailure(
  error: unknown,
  server: Pick<Server, 'host' | 'port' | 'sshUser'>,
  phase: 'connect' | 'setup',
): Failure {
  if (error instanceof HostKeyMismatchError) {
    return {
      status: 'unreachable',
      message: `${error.message} If you reinstalled the server, remove it from Selfship and add it again.`,
    };
  }
  if (error instanceof ForbiddenHostError) return { status: 'unreachable', message: error.message };
  if (error instanceof DecryptionError) {
    return {
      status: 'unreachable',
      message:
        "Selfship couldn't read this server's stored key (the encryption key changed?). Remove and re-add the server.",
    };
  }
  const text = error instanceof Error ? error.message : String(error);
  const level = (error as { level?: unknown } | null)?.level;
  if (level === 'client-authentication' || /authentication methods failed/i.test(text)) {
    return {
      status: 'unreachable',
      message: `Couldn't log in as ${server.sshUser}. Make sure Selfship's public key is in ~${server.sshUser === 'root' ? '' : server.sshUser}/.ssh/authorized_keys for that user.`,
    };
  }
  if (/ECONNREFUSED/.test(text)) {
    return {
      status: 'unreachable',
      message: `${server.host} refused the connection on port ${server.port}. Is SSH running on that port?`,
    };
  }
  if (
    /ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|Timed out while waiting for handshake|ENOTFOUND|EAI_AGAIN/.test(
      text,
    )
  ) {
    return {
      status: 'unreachable',
      message: `Couldn't reach ${server.host}:${server.port}. Check the address, and that the server's firewall (and your provider's) allows SSH.`,
    };
  }
  if (phase === 'setup' && error instanceof RemoteCommandError) {
    return {
      status: 'setup_failed',
      message: `Setup failed (exit code ${error.code}). See the log for the step that failed.`,
    };
  }
  return {
    status: phase === 'setup' ? 'setup_failed' : 'unreachable',
    message: text.slice(0, 300),
  };
}

/**
 * Runs one server job end to end: connect (pinning the host key on first
 * contact), pre-flight, and for `setup` jobs the bootstrap. Updates the
 * server's status and facts, streams every log line live, and saves the log.
 */
@Injectable()
export class ServerJobRunner implements OnModuleInit {
  private readonly logger = new Logger(ServerJobRunner.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: EnvelopeCipher,
    private readonly config: AppConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /** Fails jobs left "running" by a crashed worker, so servers don't look busy forever. */
  async onModuleInit(): Promise<void> {
    const cutoff = new Date(Date.now() - STALE_JOB_MS);
    const stale = await this.prisma.serverJob.findMany({
      where: { status: 'running', startedAt: { lt: cutoff } },
    });
    for (const job of stale) {
      await this.prisma.serverJob.update({
        where: { id: job.id },
        data: {
          status: 'failed',
          error: 'Interrupted (the worker restarted). Run it again.',
          finishedAt: new Date(),
        },
      });
      await this.prisma.server.update({
        where: { id: job.serverId },
        data: {
          status: job.type === 'setup' ? 'setup_failed' : 'unreachable',
          statusMessage: 'The last job was interrupted. Run it again.',
        },
      });
    }
    if (stale.length)
      this.logger.warn(`Marked ${stale.length} interrupted server job(s) as failed`);
  }

  /**
   * Runs a job. Never throws for expected failures: they are recorded on the
   * job and server instead (BullMQ retries are off for these jobs).
   *
   * @param jobId - Server job ID
   */
  async run(jobId: string): Promise<void> {
    const job = await this.prisma.serverJob.findUnique({
      where: { id: jobId },
      include: { server: true },
    });
    if (!job) {
      this.logger.warn(`Server job ${jobId} no longer exists (server removed?)`);
      return;
    }
    if (job.status !== 'queued') return; // already handled (duplicate delivery)

    await this.prisma.serverJob.update({
      where: { id: job.id },
      data: { status: 'running', startedAt: new Date() },
    });
    const log = new JobLog(this.redis, job.id);
    const { server } = job;
    let ssh: SshConnection | null = null;
    let phase: 'connect' | 'setup' = 'connect';

    try {
      log.line(`→ Connecting to ${server.sshUser}@${server.host}:${server.port}`);
      await assertPublicHost(server.host, {
        allowPrivate: this.config.get('ALLOW_PRIVATE_SERVER_HOSTS'),
      });
      ssh = await SshConnection.connect({
        host: server.host,
        port: server.port,
        username: server.sshUser,
        privateKey: this.cipher.decrypt(server.encryptedPrivateKey, sshKeyContext(server.id)),
        expectedFingerprint: server.hostKeyFingerprint,
      });
      if (!server.hostKeyFingerprint) {
        await this.prisma.server.update({
          where: { id: server.id },
          data: { hostKeyFingerprint: ssh.fingerprint },
        });
        log.line(`✓ Connected. Server identity pinned: ${ssh.fingerprint}`);
      } else {
        log.line(`✓ Connected. Server identity verified: ${ssh.fingerprint}`);
      }

      log.line('→ Checking the server');
      const report = await preflight(ssh);
      this.logReport(log, report);
      await this.saveFacts(server.id, report);

      if (report.problems.length > 0) {
        await this.finish(
          job,
          log,
          'failed',
          `Found ${report.problems.length} problem(s) to fix first.`,
          {
            status: 'needs_attention',
            statusMessage: report.problems[0] ?? null,
          },
        );
        return;
      }

      if (job.type === 'check') {
        await this.finish(job, log, 'succeeded', null, {
          status: server.readyAt ? 'ready' : 'checked',
          statusMessage: null,
        });
        return;
      }

      phase = 'setup';
      await this.prisma.server.update({
        where: { id: server.id },
        data: { status: 'setting_up', statusMessage: null },
      });
      log.line('→ Setting up the server (Docker, firewall, swap, security updates, Traefik)');
      const acmeEmail = this.config.get('ACME_EMAIL');
      await bootstrapServer(ssh, {
        sshPort: server.port,
        ...(acmeEmail ? { acmeEmail } : {}),
        acmeStaging: this.config.get('ACME_STAGING'),
        onLine: (line) => {
          log.line(line);
        },
      });

      // Refresh facts (Docker version, swap) now that setup changed them.
      await this.saveFacts(server.id, await preflight(ssh));
      log.line('✓ Server is ready for deployments');
      await this.finish(job, log, 'succeeded', null, {
        status: 'ready',
        statusMessage: null,
        readyAt: new Date(),
      });
    } catch (error) {
      const failure = classifyFailure(error, server, phase);
      log.line(`✗ ${failure.message}`);
      if (!(error instanceof HostKeyMismatchError) && failure.status === 'setup_failed') {
        this.logger.warn(
          `Setup failed on server ${server.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      await this.finish(job, log, 'failed', failure.message, {
        status: failure.status,
        statusMessage: failure.message,
      });
    } finally {
      ssh?.close();
    }
  }

  /** Writes a readable summary of the pre-flight to the log. */
  private logReport(log: JobLog, report: PreflightReport): void {
    log.line(
      `  ${report.os} · ${report.arch} · ${report.cpus} CPU · ${report.ramMb} MB RAM · ${report.swapMb} MB swap · ${report.diskFreeGb} GB free · Docker ${report.dockerVersion ?? 'not installed'}`,
    );
    for (const warning of report.warnings) log.line(`  ⚠ ${warning}`);
    for (const problem of report.problems) log.line(`  ✗ ${problem}`);
    if (report.problems.length === 0) log.line('✓ Server meets the requirements');
  }

  /** Stores pre-flight facts on the server. */
  private async saveFacts(serverId: string, report: PreflightReport): Promise<void> {
    await this.prisma.server.update({
      where: { id: serverId },
      data: {
        os: report.os,
        osVersion: report.osVersion,
        arch: report.arch,
        cpus: report.cpus,
        ramMb: report.ramMb,
        swapMb: report.swapMb,
        diskFreeGb: report.diskFreeGb,
        dockerVersion: report.dockerVersion,
        tier: report.tier,
        problems: report.problems,
        warnings: report.warnings,
        lastCheckedAt: new Date(),
      },
    });
  }

  /** Saves the log and final status, updates the server, and closes the live stream. */
  private async finish(
    job: ServerJob,
    log: JobLog,
    status: 'succeeded' | 'failed',
    error: string | null,
    server: { status: Server['status']; statusMessage: string | null; readyAt?: Date },
  ): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.serverJob.update({
        where: { id: job.id },
        data: { status, error, log: log.contents, finishedAt: new Date() },
      }),
      this.prisma.server.updateMany({ where: { id: job.serverId }, data: server }),
    ]);
    await log.end(status, error);
  }
}
