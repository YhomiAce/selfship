import { InjectQueue, Processor } from '@nestjs/bullmq';
import { Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { type Job, Queue, UnrecoverableError } from 'bullmq';
import { type PingJobData, QueueName, SystemJob, SystemSchedule } from '@selfship/shared';
import { SandboxExpiryService } from '../deployments/sandbox-expiry.service';
import { ReportingWorkerHost } from '../common/reporting-worker-host';

/** How often expired sandbox apps are removed. */
const SANDBOX_EXPIRY_EVERY_MS = 60 * 60 * 1000;

/** Handles jobs on the `system` queue (diagnostics and housekeeping). */
@Processor(QueueName.SYSTEM)
export class SystemProcessor extends ReportingWorkerHost implements OnApplicationBootstrap {
  private readonly logger = new Logger(SystemProcessor.name);

  constructor(
    private readonly sandbox: SandboxExpiryService,
    @InjectQueue(QueueName.SYSTEM) private readonly queue: Queue,
  ) {
    super();
  }

  /** Registers the repeating housekeeping jobs (one schedule however many workers start). */
  async onApplicationBootstrap(): Promise<void> {
    await this.queue.upsertJobScheduler(
      SystemSchedule.EXPIRE_SANDBOX,
      { every: SANDBOX_EXPIRY_EVERY_MS },
      { name: SystemSchedule.EXPIRE_SANDBOX, opts: { removeOnComplete: 50, removeOnFail: 50 } },
    );
  }

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
      case SystemSchedule.EXPIRE_SANDBOX:
        return `removed ${await this.sandbox.expire()} expired sandbox app(s)`;
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
