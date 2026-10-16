import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { QueueName } from '@selfship/shared';
import { ServerJobRunner } from './server-job.runner';
import { ServersProcessor } from './servers.processor';

@Module({
  imports: [BullModule.registerQueue({ name: QueueName.SERVERS })],
  providers: [ServersProcessor, ServerJobRunner],
})
export class ServersModule {}
