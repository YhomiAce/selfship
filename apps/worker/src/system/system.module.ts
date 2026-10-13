import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { QueueName } from '@selfship/shared';
import { SystemProcessor } from './system.processor';

@Module({
  imports: [BullModule.registerQueue({ name: QueueName.SYSTEM })],
  providers: [SystemProcessor],
})
export class SystemModule {}
