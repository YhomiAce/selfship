import type { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppConfigService } from './config/app-config.service';

/**
 * Applies HTTP-level middleware and settings.
 *
 * Shared by `main.ts` and integration tests so both run the exact same setup.
 *
 * @param app - The Nest application to configure
 */
export function configureApp(app: INestApplication): void {
  const config = app.get(AppConfigService);

  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({ origin: config.get('WEB_URL'), credentials: true });
  app.enableShutdownHooks();
}
