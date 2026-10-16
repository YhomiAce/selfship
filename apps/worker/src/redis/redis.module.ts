import { Global, Inject, Logger, Module, OnApplicationShutdown } from '@nestjs/common';
import { Redis } from 'ioredis';
import { AppConfigService } from '../config/app-config.service';

/** Injection token for the worker's ioredis client (log streams). */
export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

/** Provides a shared ioredis client; BullMQ keeps its own connections. */
@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService): Redis => {
        const redis = new Redis(config.get('REDIS_URL'), { maxRetriesPerRequest: 3 });
        const logger = new Logger('Redis');
        redis.on('error', (error: Error) => {
          logger.warn(`Redis connection error: ${error.message}`);
        });
        return redis;
      },
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /** Closes the connection on shutdown. */
  async onApplicationShutdown(): Promise<void> {
    await this.redis.quit();
  }
}
