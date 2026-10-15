import {
  BadGatewayException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { GithubApiError, type GithubAppClient } from '@selfship/github';
import { GithubErrorCode } from '@selfship/shared';
import { GITHUB_CLIENT } from './github.constants';

/**
 * Access to the GitHub App client plus consistent error mapping.
 * The client is null when the server has no GitHub App configured.
 */
@Injectable()
export class GithubAppService {
  constructor(@Inject(GITHUB_CLIENT) private readonly maybeClient: GithubAppClient | null) {}

  /** Whether GitHub App credentials are configured. */
  get isConfigured(): boolean {
    return this.maybeClient !== null;
  }

  /**
   * The client, for endpoints that need GitHub.
   *
   * @throws {ServiceUnavailableException} `GITHUB_NOT_CONFIGURED` when not configured
   */
  get client(): GithubAppClient {
    if (!this.maybeClient) {
      throw new ServiceUnavailableException({
        code: GithubErrorCode.GITHUB_NOT_CONFIGURED,
        message: 'GitHub integration is not configured on this server.',
      });
    }
    return this.maybeClient;
  }

  /**
   * Translates a GitHub failure into an HTTP error with a helpful message.
   * Non-GitHub errors are returned unchanged.
   *
   * @param error - Caught error
   * @param notFound - Code and message to use for 404s (context-specific)
   * @returns An error to throw
   */
  toHttpError(error: unknown, notFound: { code: string; message: string }): unknown {
    if (!(error instanceof GithubApiError)) return error;
    if (error.status === 404) return new NotFoundException(notFound);
    if (error.status === 401 || error.status === 403) {
      return new ForbiddenException({
        code: GithubErrorCode.INSTALLATION_SUSPENDED,
        message:
          'GitHub refused access. The app may have been uninstalled, suspended, or lost access to this repository.',
      });
    }
    return error.status === 0 || error.status >= 500
      ? new BadGatewayException({
          code: GithubErrorCode.GITHUB_UNAVAILABLE,
          message: "GitHub didn't respond properly. Please try again in a moment.",
        })
      : new HttpException(
          { code: GithubErrorCode.GITHUB_UNAVAILABLE, message: 'GitHub rejected the request.' },
          502,
        );
  }
}
