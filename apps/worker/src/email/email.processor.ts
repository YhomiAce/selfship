import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { type Job, UnrecoverableError } from 'bullmq';
import { EmailJob, type EmailJobData, EmailJobDataSchema, QueueName } from '@selfship/shared';
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
   * Sends one email.
   *
   * Bad jobs (unknown name, malformed payload) fail immediately without
   * retries, since retrying can't fix them. SMTP failures throw a normal
   * error so BullMQ retries with backoff.
   *
   * @param job - Job carrying the template and its data
   * @returns The SMTP message ID
   * @throws {UnrecoverableError} For unknown job names or invalid payloads
   * @throws {Error} For SMTP failures (retried)
   */
  async process(job: Job<unknown, string>): Promise<string> {
    if (job.name !== EmailJob.SEND) {
      throw new UnrecoverableError(`Unknown email job: ${job.name}`);
    }

    const parsed = EmailJobDataSchema.safeParse(job.data);
    if (!parsed.success) {
      const fields = parsed.error.issues.map((issue) => issue.path.join('.') || '(root)');
      throw new UnrecoverableError(`Invalid email job payload (fields: ${fields.join(', ')})`);
    }
    const data: EmailJobData = parsed.data;

    const email = renderEmail(data, this.config.get('APP_NAME'));
    const messageId = await this.mailer.send(data.to, email);
    // Log the template, not the recipient: email addresses are personal data.
    this.logger.log(`Sent ${data.template} email (job ${job.id ?? '?'})`);
    return messageId;
  }
}
