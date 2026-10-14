import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { type Job, UnrecoverableError } from 'bullmq';
import { type PingJobData, QueueName, SystemJob } from '@selfship/shared';

/** Handles jobs on the `system` queue (diagnostics and housekeeping). */
@Processor(QueueName.SYSTEM)
export class SystemProcessor extends WorkerHost {
  private readonly logger = new Logger(SystemProcessor.name);

  /**
   * Dispatches a system job by name.
   *
   * @param job - The BullMQ job
   * @returns The job result stored by BullMQ
   * @throws {UnrecoverableError} For unknown job names (no point retrying)
   */
  async process(job: Job<PingJobData, string>): Promise<string> {
    switch (job.name) {
      case SystemJob.PING:
        return this.ping(job.data);
      default:
        throw new UnrecoverableError(`Unknown system job: ${job.name}`);
    }
  }

  /**
   * Replies to a ping so the API can measure the round trip.
   *
   * @param data - Ping payload
   * @returns `pong` plus how long the job waited in the queue
   */
  private ping(data: PingJobData): Promise<string> {
    const sentAt = new Date(data.sentAt).getTime();
    // A missing or malformed timestamp shouldn't fail a diagnostic ping.
    const queuedMs = Number.isNaN(sentAt) ? 0 : Date.now() - sentAt;
    this.logger.log(`Ping received after ${queuedMs}ms in queue`);
    return Promise.resolve(`pong (queued ${queuedMs}ms)`);
  }
}
