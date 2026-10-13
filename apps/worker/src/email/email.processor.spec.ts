import type { Job } from 'bullmq';
import type { EmailJobData } from '@selfship/shared';
import type { AppConfigService } from '../config/app-config.service';
import { EmailProcessor } from './email.processor';
import type { MailerService } from './mailer.service';

describe('EmailProcessor', () => {
  const mailer = { send: jest.fn().mockResolvedValue('<id@test>') };
  const config = { get: jest.fn().mockReturnValue('Selfship') };
  const processor = new EmailProcessor(
    mailer as unknown as MailerService,
    config as unknown as AppConfigService,
  );
  const data: EmailJobData = {
    template: 'password-changed',
    to: 'ada@example.com',
    data: { name: 'Ada' },
  };

  it('renders the template and sends it to the recipient', async () => {
    const job = { name: 'send', id: '1', data } as Job<EmailJobData, string>;
    await expect(processor.process(job)).resolves.toBe('<id@test>');
    expect(mailer.send).toHaveBeenCalledWith(
      'ada@example.com',
      expect.objectContaining({ subject: 'Your Selfship password was changed' }),
    );
  });

  it('fails unknown job names', async () => {
    const job = { name: 'other', data } as Job<EmailJobData, string>;
    await expect(processor.process(job)).rejects.toThrow('Unknown email job');
  });
});
