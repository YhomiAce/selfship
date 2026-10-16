import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { OnApplicationBootstrap } from '@nestjs/common';
import { DelayedError, type Job, UnrecoverableError } from 'bullmq';
import {
  DeploymentJobDataSchema,
  DeploymentQueueJob,
  QueueName,
  TeardownJobDataSchema,
} from '@selfship/shared';
import { AppConfigService } from '../config/app-config.service';
import { DeploymentRunner } from './deployment.runner';
import { TeardownService } from './teardown.service';

/** How long a deployment waits before trying again when its server or project is busy. */
const BUSY_RETRY_MS = 5_000;

/** Consumes the `deployments` queue. */
@Processor(QueueName.DEPLOYMENTS)
export class DeploymentsProcessor extends WorkerHost implements OnApplicationBootstrap {
  constructor(
    private readonly runner: DeploymentRunner,
    private readonly teardown: TeardownService,
    private readonly config: AppConfigService,
  ) {
    super();
  }

  /** Applies the configured concurrency (decorator options can't read validated config). */
  onApplicationBootstrap(): void {
    this.worker.concurrency = this.config.get('DEPLOYMENT_CONCURRENCY');
  }

  /**
   * Runs a deployment or a teardown. When a deployment's server already
   * has as many builds as it can take (or the project has one running), the
   * job is put back for a few seconds instead of blocking a worker slot.
   *
   * @param job - BullMQ job carrying `{ deploymentId }` or `{ projectId, serverId }`
   * @param token - Lock token (needed to delay the job)
   * @throws {UnrecoverableError} For unknown names or malformed payloads (no retry)
   * @throws {DelayedError} When the job was postponed
   */
  async process(job: Job<unknown>, token?: string): Promise<void> {
    if (job.name === DeploymentQueueJob.TEARDOWN) {
      const teardown = TeardownJobDataSchema.safeParse(job.data);
      if (!teardown.success) throw new UnrecoverableError('Invalid teardown job payload');
      await this.teardown.teardown(teardown.data.projectId, teardown.data.serverId);
      return;
    }
    if (job.name !== DeploymentQueueJob.RUN)
      throw new UnrecoverableError(`Unknown deployments job: ${job.name}`);
    const parsed = DeploymentJobDataSchema.safeParse(job.data);
    if (!parsed.success) throw new UnrecoverableError('Invalid deployments job payload');

    if ((await this.runner.run(parsed.data.deploymentId)) === 'wait') {
      await job.moveToDelayed(Date.now() + BUSY_RETRY_MS, token);
      throw new DelayedError();
    }
  }
}
