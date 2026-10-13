import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { QueueName } from '@platform/shared';
import { MailService } from './mail.service';

/** Provides {@link MailService} to any module that sends emails. */
@Global()
@Module({
  imports: [BullModule.registerQueue({ name: QueueName.EMAIL })],
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
