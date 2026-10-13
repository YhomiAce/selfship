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
