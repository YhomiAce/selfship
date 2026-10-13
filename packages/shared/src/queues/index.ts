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
 * Payload of `email:send`. A discriminated union on `template`, so each
 * template's data is type-checked where the job is created.
 */
export type EmailJobData =
  | { template: 'verify-email'; to: string; data: { name: string; verifyUrl: string } }
  | { template: 'reset-password'; to: string; data: { name: string; resetUrl: string } }
  | { template: 'password-changed'; to: string; data: { name: string } };

/** Name of an email template. */
export type EmailTemplate = EmailJobData['template'];
