import { randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import type { IncomingMessage } from 'node:http';
import { ZodValidationPipe } from 'nestjs-zod';
import { LoggerModule } from 'nestjs-pino';
import { AuthModule } from './auth/auth.module';
import { CryptoModule } from './crypto/crypto.module';
import { DeploymentsModule } from './deployments/deployments.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { AppConfigModule } from './config/app-config.module';
import { AppConfigService } from './config/app-config.service';
import { DiagnosticsModule } from './diagnostics/diagnostics.module';
import { EnvVarsModule } from './env-vars/env-vars.module';
import { GithubModule } from './github/github.module';
import { HealthModule } from './health/health.module';
import { LogsModule } from './logs/logs.module';
import { MailModule } from './mail/mail.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProjectsModule } from './projects/projects.module';
import { QueueModule } from './queue/queue.module';
import { RedisModule } from './redis/redis.module';
import { ServersModule } from './servers/servers.module';

/**
 * Picks the request ID: reuse a valid incoming `x-request-id` (from a proxy)
 * or generate a new UUID.
 */
function requestId(req: IncomingMessage): string {
  const header = req.headers['x-request-id'];
  return typeof header === 'string' && /^[\w-]{8,64}$/.test(header) ? header : randomUUID();
}

@Module({
  imports: [
    AppConfigModule,
    LoggerModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        pinoHttp: {
          level: config.get('LOG_LEVEL'),
          genReqId: requestId,
          // Never log credentials, even by accident.
          redact: [
            'req.headers.cookie',
            'req.headers.authorization',
            'res.headers["set-cookie"]',
            '*.password',
            '*.privateKey',
            '*.token',
          ],
          autoLogging: { ignore: (req: IncomingMessage) => req.url === '/health' },
          ...(config.get('NODE_ENV') === 'development'
            ? { transport: { target: 'pino-pretty', options: { singleLine: true } } }
            : {}),
        },
      }),
    }),
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 300 }]),
    PrismaModule,
    RedisModule,
    QueueModule,
    CryptoModule,
    MailModule,
    AuthModule,
    GithubModule,
    ProjectsModule,
    ServersModule,
    LogsModule,
    EnvVarsModule,
    DeploymentsModule,
    HealthModule,
    DiagnosticsModule,
  ],
  providers: [
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
