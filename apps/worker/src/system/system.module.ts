import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { QueueName } from '@selfship/shared';
import { DeploymentsModule } from '../deployments/deployments.module';
import { SystemProcessor } from './system.processor';

@Module({
  imports: [BullModule.registerQueue({ name: QueueName.SYSTEM }), DeploymentsModule],
  providers: [SystemProcessor],
})
export class SystemModule {}
