import path from 'node:path';
import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppConfigService } from './app-config.service';
import { validateEnv } from './env.schema';

/** Loads the monorepo root `.env`, validates it and exposes {@link AppConfigService}. */
@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      envFilePath: [path.resolve(process.cwd(), '../../.env'), path.resolve(process.cwd(), '.env')],
      validate: validateEnv,
      cache: true,
    }),
  ],
  providers: [AppConfigService],
  exports: [AppConfigService],
})
export class AppConfigModule {}
