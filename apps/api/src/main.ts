import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { configureApp } from './configure-app';
import { AppConfigService } from './config/app-config.service';

/** Starts the HTTP server. */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  configureApp(app);

  const config = app.get(AppConfigService);
  const port = config.get('API_PORT');
  await app.listen(port);
  app.get(Logger).log(`API listening on http://localhost:${port}`, 'Bootstrap');
}

void bootstrap();
