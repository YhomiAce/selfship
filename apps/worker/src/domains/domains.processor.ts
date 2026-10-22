import { InjectQueue, Processor } from '@nestjs/bullmq';
import { Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { type Job, Queue, UnrecoverableError } from 'bullmq';
import { DomainQueueJob, QueueName } from '@selfship/shared';
import { DomainChecker } from './domain-checker.service';
import { ReportingWorkerHost } from '../common/reporting-worker-host';

/** How often domains are checked. */
const CHECK_EVERY_MS = 60_000;

/** Runs the domain checker on a schedule (one at a time). */
@Processor(QueueName.DOMAINS, { concurrency: 1 })
export class DomainsProcessor extends ReportingWorkerHost implements OnApplicationBootstrap {
  private readonly logger = new Logger(DomainsProcessor.name);

  constructor(
    private readonly checker: DomainChecker,
    @InjectQueue(QueueName.DOMAINS) private readonly queue: Queue,
  ) {
    super();
  }

  /** Registers the repeating check (idempotent: one schedule however many workers start). */
  async onApplicationBootstrap(): Promise<void> {
    await this.queue.upsertJobScheduler(
      'domain-check',
      { every: CHECK_EVERY_MS },
      { name: DomainQueueJob.CHECK, opts: { removeOnComplete: 100, removeOnFail: 100 } },
    );
    this.logger.log(`Domain checks every ${CHECK_EVERY_MS / 1000}s`);
  }

  /**
   * Runs one check.
   *
   * @param job - BullMQ job
   * @throws {UnrecoverableError} For unknown job names
   */
  async process(job: Job): Promise<void> {
    if (job.name !== DomainQueueJob.CHECK)
      throw new UnrecoverableError(`Unknown domains job: ${job.name}`);
    await this.checker.check();
  }
}
