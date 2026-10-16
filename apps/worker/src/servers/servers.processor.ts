import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { OnApplicationBootstrap } from '@nestjs/common';
import { type Job, UnrecoverableError } from 'bullmq';
import { QueueName, ServerJobDataSchema, ServerQueueJob } from '@selfship/shared';
import { AppConfigService } from '../config/app-config.service';
import { ServerJobRunner } from './server-job.runner';

/** Consumes the `servers` queue (checks and setup over SSH). */
@Processor(QueueName.SERVERS)
export class ServersProcessor extends WorkerHost implements OnApplicationBootstrap {
  constructor(
    private readonly runner: ServerJobRunner,
    private readonly config: AppConfigService,
  ) {
    super();
  }

  /** Applies the configured concurrency (decorator options can't read validated config). */
  onApplicationBootstrap(): void {
    this.worker.concurrency = this.config.get('SERVER_JOB_CONCURRENCY');
  }

  /**
   * Validates the payload and runs the job.
   *
   * @param job - BullMQ job carrying `{ serverJobId }`
   * @throws {UnrecoverableError} For unknown names or malformed payloads (no retry)
   */
  async process(job: Job<unknown>): Promise<void> {
    if (job.name !== ServerQueueJob.RUN)
      throw new UnrecoverableError(`Unknown servers job: ${job.name}`);
    const parsed = ServerJobDataSchema.safeParse(job.data);
    if (!parsed.success) throw new UnrecoverableError('Invalid servers job payload');
    await this.runner.run(parsed.data.serverJobId);
  }
}
