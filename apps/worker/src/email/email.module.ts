import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { QueueName } from '@selfship/shared';
import { EmailProcessor } from './email.processor';
import { MailerService } from './mailer.service';

@Module({
  imports: [BullModule.registerQueue({ name: QueueName.EMAIL })],
  providers: [EmailProcessor, MailerService],
})
export class EmailModule {}
