import type { Server, ServerJob } from '@selfship/db';
import { authorizeKeyCommand, revokeKeyCommand } from '@selfship/remote';
import type { ServerDto, ServerJobDetailDto, ServerJobDto } from '@selfship/shared';

/**
 * Converts a job record to the public DTO (without the log).
 *
 * @param job - Database record
 * @returns DTO
 */
export function toServerJobDto(job: ServerJob): ServerJobDto {
  return {
    id: job.id,
    type: job.type,
    status: job.status,
    error: job.error,
    createdAt: job.createdAt.toISOString(),
    startedAt: job.startedAt?.toISOString() ?? null,
    finishedAt: job.finishedAt?.toISOString() ?? null,
  };
}

/**
 * Converts a job record to the DTO including its saved log.
 *
 * @param job - Database record
 * @returns DTO with log
 */
export function toServerJobDetailDto(job: ServerJob): ServerJobDetailDto {
  return { ...toServerJobDto(job), log: job.log };
}

/**
 * Converts a server record to the public DTO. The encrypted private key is
 * never included.
 *
 * @param server - Database record
 * @param latestJob - Most recent job, if any
 * @returns DTO
 */
export function toServerDto(server: Server, latestJob: ServerJob | null): ServerDto {
  return {
    id: server.id,
    name: server.name,
    host: server.host,
    port: server.port,
    sshUser: server.sshUser,
    keySource: server.keySource,
    status: server.status,
    statusMessage: server.statusMessage,
    hostKeyFingerprint: server.hostKeyFingerprint,
    publicKey: server.publicKey,
    authorizeCommand: authorizeKeyCommand(server.publicKey),
    revokeCommand: revokeKeyCommand(server.keyComment),
    specs: {
      os: server.os,
      osVersion: server.osVersion,
      arch: server.arch,
      cpus: server.cpus,
      ramMb: server.ramMb,
      swapMb: server.swapMb,
      diskFreeGb: server.diskFreeGb,
      dockerVersion: server.dockerVersion,
    },
    tier: server.tier,
    problems: server.problems,
    warnings: server.warnings,
    lastCheckedAt: server.lastCheckedAt?.toISOString() ?? null,
    readyAt: server.readyAt?.toISOString() ?? null,
    latestJob: latestJob ? toServerJobDto(latestJob) : null,
    createdAt: server.createdAt.toISOString(),
  };
}
