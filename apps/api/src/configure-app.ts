import type { NestExpressApplication } from '@nestjs/platform-express';
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
export function configureApp(app: NestExpressApplication): void {
  const config = app.get(AppConfigService);

  // Trust X-Forwarded-For from the Next.js rewrite / load balancer for req.ip.
  app.set('trust proxy', config.get('TRUST_PROXY'));
  // GitHub push payloads can exceed the 100 KB default.
  app.useBodyParser('json', { limit: '2mb' });
  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({ origin: config.get('WEB_URL'), credentials: true });
  app.enableShutdownHooks();
}
