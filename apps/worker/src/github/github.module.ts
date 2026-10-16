import { Global, Logger, Module } from '@nestjs/common';
import { GithubAppClient } from '@selfship/github';
import { AppConfigService } from '../config/app-config.service';

/** Injection token for the GitHub App client (`null` when not configured). */
export const GITHUB_CLIENT = Symbol('GITHUB_CLIENT');

/**
 * Builds the GitHub App client the worker uses to mint clone tokens. Only
 * the app ID and private key are needed here (no OAuth settings).
 *
 * @param config - Validated configuration
 * @returns Client, or null when the app isn't configured (deployments then fail with a clear message)
 * @throws {Error} If the private key is set but invalid
 */
export function createGithubClient(config: AppConfigService): GithubAppClient | null {
  const appId = config.get('GITHUB_APP_ID');
  const privateKey = config.get('GITHUB_APP_PRIVATE_KEY');
  if (!appId || !privateKey) {
    new Logger('GithubModule').log('GitHub App not configured; deployments are disabled');
    return null;
  }
  try {
    return new GithubAppClient({
      appId,
      privateKey,
      apiUrl: config.get('GITHUB_API_URL'),
      webUrl: config.get('GITHUB_WEB_URL'),
    });
  } catch (error) {
    throw new Error(
      'GITHUB_APP_PRIVATE_KEY could not be parsed. Paste the full PEM file contents.',
      {
        cause: error,
      },
    );
  }
}

/** Provides {@link GITHUB_CLIENT}. */
@Global()
@Module({
  providers: [
    { provide: GITHUB_CLIENT, inject: [AppConfigService], useFactory: createGithubClient },
  ],
  exports: [GITHUB_CLIENT],
})
export class GithubModule {}
