import { Global, Inject, Logger, Module, OnApplicationShutdown } from '@nestjs/common';
import { Redis } from 'ioredis';
import { AppConfigService } from '../config/app-config.service';
import { REDIS_CLIENT } from './redis.constants';

/**
 * Provides a shared ioredis client under the {@link REDIS_CLIENT} token
 * (health checks, rate limiting, pub/sub). BullMQ manages its own connections.
 */
@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService): Redis => {
        const redis = new Redis(config.get('REDIS_URL'), { maxRetriesPerRequest: 2 });
        // Without a listener ioredis prints "Unhandled error event" on every
        // reconnect attempt. It reconnects on its own; we just log it properly.
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

  /** Closes the Redis connection when the app shuts down. */
  async onApplicationShutdown(): Promise<void> {
    await this.redis.quit();
  }
}
