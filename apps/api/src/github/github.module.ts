import { Logger, Module } from '@nestjs/common';
import { GithubAppClient } from '@selfship/github';
import { AppConfigService } from '../config/app-config.service';
import { GithubAppService } from './github-app.service';
import { GITHUB_CLIENT } from './github.constants';
import { GithubController } from './github.controller';
import { GithubInstallationsService } from './github-installations.service';
import { GithubRepositoriesService } from './github-repositories.service';
import { GithubWebhooksController } from './github-webhooks.controller';

/**
 * Builds the GitHub App client from config, or null when the app isn't
 * configured (the rest of Selfship keeps working; GitHub features report
 * "not configured").
 *
 * @param config - Validated configuration
 * @returns Client or null
 * @throws {Error} If credentials are set but the private key is invalid
 */
export function createGithubClient(config: AppConfigService): GithubAppClient | null {
  const appId = config.get('GITHUB_APP_ID');
  const slug = config.get('GITHUB_APP_SLUG');
  const clientId = config.get('GITHUB_APP_CLIENT_ID');
  const clientSecret = config.get('GITHUB_APP_CLIENT_SECRET');
  const privateKey = config.get('GITHUB_APP_PRIVATE_KEY');
  if (!appId || !slug || !clientId || !clientSecret || !privateKey) {
    new Logger('GithubModule').log('GitHub App not configured; repository features are disabled');
    return null;
  }
  try {
    return new GithubAppClient({
      appId,
      slug,
      clientId,
      clientSecret,
      privateKey,
      apiUrl: config.get('GITHUB_API_URL'),
      webUrl: config.get('GITHUB_WEB_URL'),
    });
  } catch (error) {
    throw new Error(
      'GITHUB_APP_PRIVATE_KEY could not be parsed. Paste the full PEM file contents (see docs/guides/github-app-setup.md).',
      { cause: error },
    );
  }
}

/** GitHub App integration: connecting accounts, listing repositories, webhooks. */
@Module({
  controllers: [GithubController, GithubWebhooksController],
  providers: [
    { provide: GITHUB_CLIENT, inject: [AppConfigService], useFactory: createGithubClient },
    GithubAppService,
    GithubInstallationsService,
    GithubRepositoriesService,
  ],
  exports: [GithubAppService, GithubInstallationsService],
})
export class GithubModule {}
