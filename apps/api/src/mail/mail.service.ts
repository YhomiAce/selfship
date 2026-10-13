import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { EmailJob, type EmailJobData, QueueName } from '@platform/shared';

/**
 * Queues transactional emails. The worker renders and sends them, so slow
 * SMTP servers never delay API responses, and failed sends are retried.
 */
@Injectable()
export class MailService {
  constructor(@InjectQueue(QueueName.EMAIL) private readonly queue: Queue<EmailJobData>) {}

  /**
   * Enqueues an email.
   *
   * @param email - Template, recipient and template data
   */
  async send(email: EmailJobData): Promise<void> {
    await this.queue.add(EmailJob.SEND, email, {
      attempts: 5,
      backoff: { type: 'exponential', delay: 5000 },
    });
  }
}
