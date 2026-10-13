import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { EmailJob, type EmailJobData, QueueName } from '@selfship/shared';
import { AppConfigService } from '../config/app-config.service';
import { MailerService } from './mailer.service';
import { renderEmail } from './templates';

/** Renders and sends transactional emails queued by the API. */
@Processor(QueueName.EMAIL)
export class EmailProcessor extends WorkerHost {
  private readonly logger = new Logger(EmailProcessor.name);

  constructor(
    private readonly mailer: MailerService,
    private readonly config: AppConfigService,
  ) {
    super();
  }

  /**
   * Sends one email. Throwing lets BullMQ retry with backoff.
   *
   * @param job - Job carrying the template and its data
   * @returns The SMTP message ID
   * @throws {Error} For unknown job names or SMTP failures
   */
  async process(job: Job<EmailJobData, string>): Promise<string> {
    if (job.name !== EmailJob.SEND) throw new Error(`Unknown email job: ${job.name}`);

    const email = renderEmail(job.data, this.config.get('APP_NAME'));
    const messageId = await this.mailer.send(job.data.to, email);
    // Log the template, not the recipient: email addresses are personal data.
    this.logger.log(`Sent ${job.data.template} email (job ${job.id ?? '?'})`);
    return messageId;
  }
}
