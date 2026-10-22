import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { flushErrorTracking, initErrorTracking, reportError } from './common/error-tracking';
import { AppConfigService } from './config/app-config.service';
import { WorkerModule } from './worker.module';

/**
 * Starts the worker as a standalone Nest application (no HTTP server).
 * BullMQ processors begin consuming jobs as soon as the context initialises.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  const config = app.get(AppConfigService);
  initErrorTracking({
    dsn: config.get('SENTRY_DSN'),
    environment: config.get('SENTRY_ENVIRONMENT') ?? config.get('NODE_ENV'),
    service: 'worker',
  });
  // Something escaped every handler: report it rather than lose it.
  process.on('unhandledRejection', (reason) => {
    reportError(reason, { kind: 'unhandledRejection' });
  });
  app.get(Logger).log('Worker started, waiting for jobs', 'Bootstrap');
}

bootstrap().catch(async (error: unknown) => {
  // Logger may not be ready yet, so write straight to stderr.
  process.stderr.write(
    `Worker failed to start: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  reportError(error, { kind: 'startup' });
  await flushErrorTracking();
  process.exit(1);
});
