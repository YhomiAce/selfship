import { OnWorkerEvent, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { reportError } from './error-tracking';

/**
 * Base class for queue processors: reports jobs that fail to Sentry (when
 * configured). Expected outcomes (a user's build failing, a server being
 * unreachable) are handled inside the jobs and don't count as failures.
 */
export abstract class ReportingWorkerHost extends WorkerHost {
  /**
   * Called by BullMQ when a job throws.
   *
   * @param job - The failed job (may be undefined for stalled jobs)
   * @param error - What it threw
   */
  @OnWorkerEvent('failed')
  onJobFailed(job: Job | undefined, error: Error): void {
    if (error.name === 'DelayedError') return; // postponed on purpose (busy server)
    reportError(error, { queue: job?.queueName ?? 'unknown', job: job?.name ?? 'unknown' });
  }
}
