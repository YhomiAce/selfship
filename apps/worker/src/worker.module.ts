import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { redisConnectionFromUrl } from '@platform/shared';
import { AppConfigModule } from './config/app-config.module';
import { AppConfigService } from './config/app-config.service';
import { EmailModule } from './email/email.module';
import { SystemModule } from './system/system.module';

@Module({
  imports: [
    AppConfigModule,
    LoggerModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        pinoHttp: {
          level: config.get('LOG_LEVEL'),
          redact: ['*.password', '*.privateKey', '*.token'],
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
      }),
    }),
    SystemModule,
    EmailModule,
  ],
})
export class WorkerModule {}
