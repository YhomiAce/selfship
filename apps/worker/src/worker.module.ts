import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { redisConnectionFromUrl } from '@selfship/shared';
import { AppConfigModule } from './config/app-config.module';
import { AppConfigService } from './config/app-config.service';
import { CryptoModule } from './crypto/crypto.module';
import { DeploymentsModule } from './deployments/deployments.module';
import { EmailModule } from './email/email.module';
import { GithubModule } from './github/github.module';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { ServersModule } from './servers/servers.module';
import { SystemModule } from './system/system.module';

@Module({
  imports: [
    AppConfigModule,
    LoggerModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        pinoHttp: {
          level: config.get('LOG_LEVEL'),
          redact: ['*.password', '*.privateKey', '*.token', '*.value'],
          ...(config.get('NODE_ENV') === 'development'
            ? { transport: { target: 'pino-pretty', options: { singleLine: true } } }
            : {}),
        },
      }),
    }),
    BullModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        connection: redisConnectionFromUrl(config.get('REDIS_URL')),
        prefix: config.get('QUEUE_PREFIX'),
      }),
    }),
    PrismaModule,
    RedisModule,
    CryptoModule,
    SystemModule,
    EmailModule,
    ServersModule,
    GithubModule,
    DeploymentsModule,
  ],
})
export class WorkerModule {}
