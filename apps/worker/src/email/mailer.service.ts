import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { createTransport } from 'nodemailer';
import { AppConfigService } from '../config/app-config.service';
import type { RenderedEmail } from './templates';

/** Sends emails over SMTP (Mailpit locally, a real provider in production). */
@Injectable()
export class MailerService implements OnModuleDestroy {
  private readonly transport;

  constructor(private readonly config: AppConfigService) {
    const user = config.get('SMTP_USER');
    const pass = config.get('SMTP_PASSWORD');
    this.transport = createTransport({
      host: config.get('SMTP_HOST'),
      port: config.get('SMTP_PORT'),
      secure: config.get('SMTP_SECURE'),
      ...(user && pass ? { auth: { user, pass } } : {}),
    });
  }

  /**
   * Sends one email.
   *
   * @param to - Recipient address
   * @param email - Rendered subject and bodies
   * @returns The SMTP message ID
   * @throws {Error} If the SMTP server rejects the message (the job is retried)
   */
  async send(to: string, email: RenderedEmail): Promise<string> {
    const info = await this.transport.sendMail({
      from: this.config.get('MAIL_FROM'),
      to,
      subject: email.subject,
      text: email.text,
      html: email.html,
    });
    return info.messageId;
  }

  /** Closes SMTP connections on shutdown. */
  onModuleDestroy(): void {
    this.transport.close();
  }
}
