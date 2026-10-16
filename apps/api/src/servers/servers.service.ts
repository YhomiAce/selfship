import { randomUUID } from 'node:crypto';
import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Queue } from 'bullmq';
import { type Server, type ServerJob, type ServerJobType } from '@selfship/db';
import { EnvelopeCipher } from '@selfship/crypto';
import {
  assertPublicHost,
  ForbiddenHostError,
  generateKeyPair,
  installKeyWithPassword,
  inspectPrivateKey,
  InvalidPrivateKeyError,
  revokeKeyCommand,
} from '@selfship/remote';
import {
  type CreateServerInput,
  type DeleteServerResponse,
  ErrorCode,
  QueueName,
  type ServerDto,
  ServerErrorCode,
  type ServerJobData,
  type ServerJobDetailDto,
  type ServerJobDto,
  ServerQueueJob,
} from '@selfship/shared';
import { isUniqueViolation } from '../common/prisma-errors';
import { AppConfigService } from '../config/app-config.service';
import { PrismaService } from '../prisma/prisma.service';
import { toServerDto, toServerJobDetailDto, toServerJobDto } from './server.mapper';

/** 404 for servers that don't exist or belong to someone else. */
const SERVER_NOT_FOUND = { code: ErrorCode.NOT_FOUND, message: 'Server not found.' };

/**
 * Encryption context for a server's private key. Binds the ciphertext to this
 * row and purpose, so it can't be swapped into another server.
 *
 * @param serverId - Server ID
 * @returns Context string
 */
export function sshKeyContext(serverId: string): string {
  return `server:${serverId}:ssh-key`;
}

/**
 * Servers: adding them (three ways to get SSH access), starting check/setup
 * jobs, and removing them. All SSH work happens in the worker, except the
 * one-off password login, which must not leave this request (see `create`).
 */
@Injectable()
export class ServersService {
  private readonly logger = new Logger(ServersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: EnvelopeCipher,
    private readonly config: AppConfigService,
    @InjectQueue(QueueName.SERVERS) private readonly queue: Queue<ServerJobData>,
  ) {}

  /**
   * Adds a server.
   *
   * - `generated`: we create a key pair; the user adds our public key, then clicks Connect.
   * - `pasted`: the user's own key, validated and encrypted immediately; setup starts.
   * - `password`: we create a key pair and log in **once** with the password to
   *   install it. The password is used inside this request only: it is never
   *   stored, logged, or put in the job queue (which lives in Redis).
   *
   * @param userId - Signed-in user
   * @param input - Validated form
   * @returns The new server
   * @throws {BadRequestException} Invalid/forbidden host, bad key, or failed password login
   * @throws {ConflictException} `SERVER_NAME_TAKEN`
   */
  async create(userId: string, input: CreateServerInput): Promise<ServerDto> {
    await this.assertAllowedHost(input.host);

    const id = randomUUID();
    const keyComment = `selfship-${id.slice(0, 8)}`;
    let keys: { privateKey: string; publicKey: string };
    let hostKeyFingerprint: string | null = null;

    if (input.method === 'pasted') {
      try {
        keys = inspectPrivateKey(input.privateKey, keyComment);
      } catch (error) {
        if (error instanceof InvalidPrivateKeyError) {
          throw new BadRequestException({
            code: ServerErrorCode.INVALID_PRIVATE_KEY,
            message: error.message,
            fieldErrors: { privateKey: [error.message] },
          });
        }
        throw error;
      }
    } else {
      keys = generateKeyPair(keyComment);
    }

    if (input.method === 'password') {
      hostKeyFingerprint = await this.installWithPassword(input, keys.publicKey);
    }

    try {
      await this.prisma.server.create({
        data: {
          id,
          userId,
          name: input.name,
          host: input.host,
          port: input.port,
          sshUser: input.sshUser,
          keySource: input.method,
          encryptedPrivateKey: this.cipher.encrypt(keys.privateKey, sshKeyContext(id)),
          publicKey: keys.publicKey,
          keyComment,
          hostKeyFingerprint,
          status: input.method === 'generated' ? 'awaiting_key' : 'checking',
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException({
          code: ServerErrorCode.SERVER_NAME_TAKEN,
          message: `You already have a server called "${input.name}".`,
          fieldErrors: { name: ['You already have a server with this name.'] },
        });
      }
      throw error;
    }

    // With a pasted key or an installed key we can connect right away.
    if (input.method !== 'generated') await this.startJob(userId, id, 'setup');
    return this.get(userId, id);
  }

  /**
   * Lists the user's servers, newest first, each with its latest job.
   *
   * @param userId - Signed-in user
   * @returns Servers
   */
  async list(userId: string): Promise<ServerDto[]> {
    const servers = await this.prisma.server.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: { jobs: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    return servers.map((server) => toServerDto(server, server.jobs[0] ?? null));
  }

  /**
   * Fetches one server.
   *
   * @param userId - Signed-in user
   * @param serverId - Server ID
   * @returns The server
   * @throws {NotFoundException} If missing or owned by someone else
   */
  async get(userId: string, serverId: string): Promise<ServerDto> {
    const server = await this.findOwned(userId, serverId);
    const latest = await this.prisma.serverJob.findFirst({
      where: { serverId },
      orderBy: { createdAt: 'desc' },
    });
    return toServerDto(server, latest);
  }

  /**
   * Queues a check (inspect only) or setup (inspect + bootstrap) job. Only one
   * job per server may be queued or running at a time.
   *
   * @param userId - Signed-in user
   * @param serverId - Server ID
   * @param type - `check` or `setup`
   * @returns The queued job
   * @throws {NotFoundException} If missing or owned by someone else
   * @throws {ConflictException} `JOB_IN_PROGRESS`
   */
  async startJob(userId: string, serverId: string, type: ServerJobType): Promise<ServerJobDto> {
    await this.findOwned(userId, serverId);

    const job = await this.prisma.$transaction(async (tx) => {
      const active = await tx.serverJob.findFirst({
        where: { serverId, status: { in: ['queued', 'running'] } },
      });
      if (active) {
        throw new ConflictException({
          code: ServerErrorCode.JOB_IN_PROGRESS,
          message: 'A check or setup is already running on this server. Wait for it to finish.',
        });
      }
      const created = await tx.serverJob.create({ data: { serverId, type } });
      await tx.server.update({
        where: { id: serverId },
        data: { status: 'checking', statusMessage: null },
      });
      return created;
    });

    // No retries: a failed setup is shown to the user, who decides to re-run it.
    await this.queue.add(
      ServerQueueJob.RUN,
      { serverJobId: job.id },
      { jobId: job.id, attempts: 1 },
    );
    return toServerJobDto(job);
  }

  /**
   * Lists recent jobs of a server.
   *
   * @param userId - Signed-in user
   * @param serverId - Server ID
   * @returns Up to 20 jobs, newest first
   */
  async listJobs(userId: string, serverId: string): Promise<ServerJobDto[]> {
    await this.findOwned(userId, serverId);
    const jobs = await this.prisma.serverJob.findMany({
      where: { serverId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return jobs.map(toServerJobDto);
  }

  /**
   * Fetches one job with its saved log.
   *
   * @param userId - Signed-in user
   * @param serverId - Server ID
   * @param jobId - Job ID
   * @returns The job
   * @throws {NotFoundException} If missing or not this user's
   */
  async getJob(userId: string, serverId: string, jobId: string): Promise<ServerJobDetailDto> {
    return toServerJobDetailDto(await this.findOwnedJob(userId, serverId, jobId));
  }

  /**
   * Loads a job after checking the server belongs to the user (used by the log stream).
   *
   * @param userId - Signed-in user
   * @param serverId - Server ID
   * @param jobId - Job ID
   * @returns The job record
   * @throws {NotFoundException} If missing or not this user's
   */
  async findOwnedJob(userId: string, serverId: string, jobId: string): Promise<ServerJob> {
    await this.findOwned(userId, serverId);
    const job = await this.prisma.serverJob.findFirst({ where: { id: jobId, serverId } });
    if (!job) throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: 'Job not found.' });
    return job;
  }

  /**
   * Removes a server from Selfship. Nothing on the server is changed; the
   * response explains how to revoke our key there.
   *
   * @param userId - Signed-in user
   * @param serverId - Server ID
   * @returns The command that removes our key from the server
   * @throws {NotFoundException} If missing or owned by someone else
   * @throws {ConflictException} `JOB_IN_PROGRESS` while a job is running
   */
  async remove(userId: string, serverId: string): Promise<DeleteServerResponse> {
    const server = await this.findOwned(userId, serverId);
    const running = await this.prisma.serverJob.count({ where: { serverId, status: 'running' } });
    if (running > 0) {
      throw new ConflictException({
        code: ServerErrorCode.JOB_IN_PROGRESS,
        message: 'Wait for the running check or setup to finish before removing this server.',
      });
    }
    await this.prisma.server.delete({ where: { id: server.id } });
    return { revokeCommand: revokeKeyCommand(server.keyComment) };
  }

  /** Loads a server owned by the user, or 404 (never 403, to avoid leaking IDs). */
  private async findOwned(userId: string, serverId: string): Promise<Server> {
    const server = await this.prisma.server.findFirst({ where: { id: serverId, userId } });
    if (!server) throw new NotFoundException(SERVER_NOT_FOUND);
    return server;
  }

  /** Refuses private/internal hosts (SSRF), unless allowed for local development. */
  private async assertAllowedHost(host: string): Promise<void> {
    try {
      await assertPublicHost(host, { allowPrivate: this.config.get('ALLOW_PRIVATE_SERVER_HOSTS') });
    } catch (error) {
      if (error instanceof ForbiddenHostError) {
        throw new BadRequestException({
          code: ServerErrorCode.FORBIDDEN_HOST,
          message: error.message,
          fieldErrors: { host: [error.message] },
        });
      }
      throw error;
    }
  }

  /**
   * Logs in once with the password to add our public key. Error messages say
   * what went wrong without echoing anything sensitive.
   *
   * @returns The server's host key fingerprint (pinned from now on)
   */
  private async installWithPassword(
    input: Extract<CreateServerInput, { method: 'password' }>,
    publicKey: string,
  ): Promise<string> {
    try {
      return await installKeyWithPassword({
        host: input.host,
        port: input.port,
        username: input.sshUser,
        password: input.password,
        publicKey,
      });
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Password key install failed for ${input.host}:${input.port}: ${text}`);
      const message = /authentication/i.test(text)
        ? `Couldn't log in as ${input.sshUser} with that password. Check it, or make sure password login is enabled for this user.`
        : /timed out|ECONNREFUSED|EHOSTUNREACH|ENOTFOUND|ETIMEDOUT/i.test(text)
          ? `Couldn't connect to ${input.host}:${input.port}. Check the address and port, and that the server's firewall allows SSH.`
          : 'Logging in with the password failed. Try again, or use a generated key instead.';
      throw new BadRequestException({
        code: ServerErrorCode.PASSWORD_LOGIN_FAILED,
        message,
        fieldErrors: { password: [message] },
      });
    }
  }
}
