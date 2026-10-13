import { Public } from '../auth/decorators/public.decorator';
import { InjectQueue } from '@nestjs/bullmq';
import { Controller, NotFoundException, Post } from '@nestjs/common';
import { Queue, QueueEvents } from 'bullmq';
import { type PingJobData, QueueName, SystemJob } from '@selfship/shared';
import { AppConfigService } from '../config/app-config.service';

/** Response of `POST /diagnostics/ping-worker`. */
export interface PingWorkerResponse {
  /** Round-trip time API → Redis → worker → API, in milliseconds. */
  roundTripMs: number;
  /** Value returned by the worker. */
  reply: string;
}

/**
 * Development-only endpoints for checking that the moving parts are wired up.
 * Disabled in production.
 */
@Public()
@Controller('diagnostics')
export class DiagnosticsController {
  constructor(
    @InjectQueue(QueueName.SYSTEM) private readonly systemQueue: Queue<PingJobData, string>,
    private readonly config: AppConfigService,
  ) {}

  /**
   * Enqueues a `system:ping` job and waits for the worker to finish it.
   *
   * @returns Round-trip time and the worker's reply
   * @throws {NotFoundException} In production
   */
  @Post('ping-worker')
  async pingWorker(): Promise<PingWorkerResponse> {
    if (this.config.isProduction) throw new NotFoundException();

    const events = new QueueEvents(QueueName.SYSTEM, {
      connection: this.systemQueue.opts.connection,
    });
    try {
      await events.waitUntilReady();
      const startedAt = Date.now();
      const job = await this.systemQueue.add(SystemJob.PING, { sentAt: new Date().toISOString() });
      const reply = await job.waitUntilFinished(events, 5000);
      return { roundTripMs: Date.now() - startedAt, reply };
    } finally {
      await events.close();
    }
  }
}
