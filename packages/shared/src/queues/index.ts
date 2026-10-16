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
