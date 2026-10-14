import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { WorkerModule } from './worker.module';

/**
 * Starts the worker as a standalone Nest application (no HTTP server).
 * BullMQ processors begin consuming jobs as soon as the context initialises.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  app.get(Logger).log('Worker started, waiting for jobs', 'Bootstrap');
}

bootstrap().catch((error: unknown) => {
  // Logger may not be ready yet, so write straight to stderr.
  process.stderr.write(
    `Worker failed to start: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exit(1);
});
