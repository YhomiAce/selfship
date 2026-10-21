import { z } from 'zod';

/**
 * Queue contracts between the API (producer) and the worker (consumer).
 *
 * Every queue name and job payload lives here so both sides stay in sync and
 * payloads are fully typed at compile time.
 */

/** Names of all BullMQ queues. */
export const QueueName = {
  /** Internal housekeeping and diagnostics jobs. */
  SYSTEM: 'system',
  /** Transactional emails. */
  EMAIL: 'email',
  /** Server checks and setup (SSH). */
  SERVERS: 'servers',
  /** Deployments: clone, build and run apps on servers. */
  DEPLOYMENTS: 'deployments',
  /** Domain checks: DNS verification, routing and certificates. */
  DOMAINS: 'domains',
  /** AI diagnosis of failed deployments. */
  BUILD_DOCTOR: 'build-doctor',
} as const;

export type QueueName = (typeof QueueName)[keyof typeof QueueName];

/** Job names on the `system` queue. */
export const SystemJob = {
  PING: 'ping',
} as const;

/** Payload of `system:ping`, used to verify the API → worker path end to end. */
export interface PingJobData {
  /** ISO timestamp set by the producer. */
  sentAt: string;
}

/** Job names on the `email` queue. */
export const EmailJob = {
  SEND: 'send',
} as const;

/**
 * Payload of `email:send`: a discriminated union on `template`, so each
 * template's data is type-checked where the job is created.
 *
 * It's also a zod schema because job payloads cross a process boundary
 * (Redis). The worker re-validates them, so a malformed or outdated job
 * (e.g. API and worker deployed at different versions) fails cleanly
 * instead of crashing halfway through rendering.
 */
export const EmailJobDataSchema = z.discriminatedUnion('template', [
  z.object({
    template: z.literal('verify-email'),
    to: z.email(),
    data: z.object({ name: z.string(), verifyUrl: z.url() }),
  }),
  z.object({
    template: z.literal('reset-password'),
    to: z.email(),
    data: z.object({ name: z.string(), resetUrl: z.url() }),
  }),
  z.object({
    template: z.literal('password-changed'),
    to: z.email(),
    data: z.object({ name: z.string() }),
  }),
]);

export type EmailJobData = z.infer<typeof EmailJobDataSchema>;

/** Name of an email template. */
export type EmailTemplate = EmailJobData['template'];

/** Job names on the `servers` queue. */
export const ServerQueueJob = {
  RUN: 'run',
} as const;

/**
 * Payload of `servers:run`. Only the job ID: the worker loads the server and
 * decrypts its key from the database, so no credentials ever sit in Redis.
 */
export const ServerJobDataSchema = z.object({ serverJobId: z.uuid() });
export type ServerJobData = z.infer<typeof ServerJobDataSchema>;

/**
 * Redis Stream holding a server job's live log lines. The worker appends,
 * the API's SSE endpoint reads from the start (history) and then blocks for
 * new entries, so no line is lost or duplicated, and reconnects resume.
 *
 * @param serverJobId - Job ID
 * @returns Stream key
 */
export function serverJobStreamKey(serverJobId: string): string {
  return `selfship:server-job:${serverJobId}:log`;
}

/** Job names on the `deployments` queue. */
export const DeploymentQueueJob = {
  RUN: 'run',
  /** Remove a project's app from a server (project deleted or moved). */
  TEARDOWN: 'teardown',
} as const;

/**
 * Payload of `deployments:run`. Only the ID: the worker loads everything
 * else (including encrypted env vars) from the database.
 */
export const DeploymentJobDataSchema = z.object({ deploymentId: z.uuid() });
export type DeploymentJobData = z.infer<typeof DeploymentJobDataSchema>;

/**
 * Payload of `deployments:teardown`: stop and remove a project's containers,
 * images and files on one server. The project may already be deleted.
 */
export const TeardownJobDataSchema = z.object({ projectId: z.uuid(), serverId: z.uuid() });
export type TeardownJobData = z.infer<typeof TeardownJobDataSchema>;

/**
 * Redis Stream holding a deployment's live log.
 *
 * @param deploymentId - Deployment ID
 * @returns Stream key
 */
export function deploymentStreamKey(deploymentId: string): string {
  return `selfship:deployment:${deploymentId}:log`;
}

/** Job names on the `domains` queue. */
export const DomainQueueJob = {
  /** Repeating: verify DNS of pending domains, route verified ones, confirm certificates. */
  CHECK: 'check',
} as const;

/** Job names on the `build-doctor` queue. */
export const BuildDoctorJob = {
  DIAGNOSE: 'diagnose',
} as const;

/** Payload of `build-doctor:diagnose`: only the ID (context is built from the database). */
export const DiagnoseJobDataSchema = z.object({ diagnosisId: z.uuid() });
export type DiagnoseJobData = z.infer<typeof DiagnoseJobDataSchema>;
