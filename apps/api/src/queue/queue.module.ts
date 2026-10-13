import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { QueueName, redisConnectionFromUrl } from '@platform/shared';
import { AppConfigService } from '../config/app-config.service';

/**
 * Registers BullMQ and the queues the API produces jobs for.
 * Jobs are consumed by `apps/worker`.
 */
@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        connection: redisConnectionFromUrl(config.get('REDIS_URL')),
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: { age: 24 * 3600, count: 1000 },
          removeOnFail: { age: 7 * 24 * 3600 },
        },
      }),
    }),
    BullModule.registerQueue({ name: QueueName.SYSTEM }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
