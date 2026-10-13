import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
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
      useFactory: (config: AppConfigService): Redis =>
        new Redis(config.get('REDIS_URL'), { lazyConnect: false, maxRetriesPerRequest: 2 }),
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
