import { Controller, Get, Logger, Param, ParseUUIDPipe, Query, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import {
  GithubSetupResult,
  type GithubBranchListResponse,
  type GithubInstallationListResponse,
  type GithubRepositoryListResponse,
  type GithubStatusResponse,
} from '@selfship/shared';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { generateToken, safeEqual } from '../common/crypto';
import { queryString, readCookie } from '../common/http';
import { AppConfigService } from '../config/app-config.service';
import type { User } from '@selfship/db';
import { ListBranchesQueryDto, ListRepositoriesQueryDto } from './dto/github.dto';
import { GithubAppService } from './github-app.service';
import {
  GITHUB_INSTALL_STATE_COOKIE,
  GITHUB_INSTALL_STATE_TTL_MS,
  toGithubId,
} from './github.constants';
import { GithubInstallationsService } from './github-installations.service';
import { GithubRepositoriesService } from './github-repositories.service';

/** Where the wizard lives; the setup callback sends users back here. */
const WIZARD_PATH = '/dashboard/projects/new';

/** Connecting GitHub accounts and browsing their repositories. */
@Controller('github')
export class GithubController {
  private readonly logger = new Logger(GithubController.name);

  constructor(
    private readonly github: GithubAppService,
    private readonly installations: GithubInstallationsService,
    private readonly repositories: GithubRepositoriesService,
    private readonly config: AppConfigService,
  ) {}

  /**
   * Tells the UI whether the GitHub integration is available.
   *
   * @returns `{ configured }`
   */
  @Get('status')
  status(): GithubStatusResponse {
    return { configured: this.github.isConfigured };
  }

  /**
   * Starts installing the GitHub App: sets a CSRF state cookie and redirects
   * to GitHub, where the user picks an account and repositories.
   *
   * Public so a browser navigation never ends on a JSON error page: signed-out
   * users go to login, and an unconfigured server returns to the wizard.
   */
  @Public()
  @Get('install')
  install(@Req() req: AuthenticatedRequest, @Res() res: Response): void {
    const webUrl = this.config.get('WEB_URL');
    if (!req.auth) {
      res.redirect(new URL(`/login?next=${encodeURIComponent(WIZARD_PATH)}`, webUrl).toString());
      return;
    }
    if (!this.github.isConfigured) {
      res.redirect(
        new URL(
          `${WIZARD_PATH}?github=${GithubSetupResult.ERROR}&reason=not_configured`,
          webUrl,
        ).toString(),
      );
      return;
    }

    const state = generateToken();
    res.cookie(GITHUB_INSTALL_STATE_COOKIE, state, {
      httpOnly: true,
      secure: this.config.isProduction,
      sameSite: 'lax',
      path: '/',
      maxAge: GITHUB_INSTALL_STATE_TTL_MS,
    });
    res.redirect(this.github.client.installUrl(state));
  }

  /**
   * GitHub redirects here after the app is installed or its repository
   * access is changed. Verifies the user really has access to the
   * installation, records it, and returns to the project wizard.
   *
   * Public so an expired session redirects to login instead of showing JSON.
   *
   * @param rawInstallationId - `installation_id` (absent for "request" flows)
   * @param rawSetupAction - `install`, `update` or `request`
   * @param rawCode - OAuth code proving which GitHub user completed the flow
   * @param rawState - Echo of our state, when GitHub includes it
   */
  @Public()
  @Get('setup')
  async setup(
    @Query('installation_id') rawInstallationId: unknown,
    @Query('setup_action') rawSetupAction: unknown,
    @Query('code') rawCode: unknown,
    @Query('state') rawState: unknown,
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
  ): Promise<void> {
    const back = (result: string, reason?: string): void => {
      const url = new URL(WIZARD_PATH, this.config.get('WEB_URL'));
      url.searchParams.set('github', result);
      if (reason) url.searchParams.set('reason', reason);
      res.redirect(url.toString());
    };

    const expectedState = readCookie(req, GITHUB_INSTALL_STATE_COOKIE);
    res.clearCookie(GITHUB_INSTALL_STATE_COOKIE, { path: '/' });

    if (!req.auth) {
      res.redirect(
        new URL(
          `/login?next=${encodeURIComponent(WIZARD_PATH)}`,
          this.config.get('WEB_URL'),
        ).toString(),
      );
      return;
    }

    // When GitHub echoes a state it must match the cookie (CSRF). Installs
    // started on github.com have no state; ownership is still verified below.
    const state = queryString(rawState);
    if (state && (!expectedState || !safeEqual(state, expectedState))) {
      back(GithubSetupResult.ERROR, 'state');
      return;
    }

    if (queryString(rawSetupAction) === 'request') {
      back(GithubSetupResult.PENDING); // an org owner must approve the request first
      return;
    }

    const installationId = Number(queryString(rawInstallationId));
    const code = queryString(rawCode);
    if (!Number.isSafeInteger(installationId) || installationId <= 0) {
      back(GithubSetupResult.ERROR, 'missing_installation');
      return;
    }
    if (!code) {
      // The app must have "Request user authorization (OAuth) during installation" enabled.
      back(GithubSetupResult.ERROR, 'missing_code');
      return;
    }

    try {
      const result = await this.installations.claim(req.auth.user.id, installationId, code);
      back(
        result === 'connected' ? GithubSetupResult.CONNECTED : GithubSetupResult.ERROR,
        result === 'connected' ? undefined : 'not_yours',
      );
    } catch (error) {
      this.logger.warn({ err: error }, 'GitHub installation setup failed');
      back(GithubSetupResult.ERROR, 'github');
    }
  }

  /**
   * Lists the GitHub accounts the user has connected.
   *
   * @returns Installations
   */
  @Get('installations')
  async listInstallations(@CurrentUser() user: User): Promise<GithubInstallationListResponse> {
    return { items: await this.installations.listForUser(user.id) };
  }

  /**
   * Lists repositories of a connected account, searchable and paginated.
   *
   * @param id - Our installation ID
   * @param query - Search text and pagination
   * @returns One page of repositories
   */
  @Get('installations/:id/repositories')
  async listRepositories(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ListRepositoriesQueryDto,
  ): Promise<GithubRepositoryListResponse> {
    const installation = await this.installations.getForUser(user.id, id);
    try {
      return await this.repositories.list(toGithubId(installation.githubInstallationId), query);
    } catch (error) {
      throw this.github.toHttpError(error, {
        code: 'INSTALLATION_NOT_FOUND',
        message: 'GitHub no longer recognises this installation. Connect the account again.',
      });
    }
  }

  /**
   * Lists branches of a repository (default branch first).
   *
   * @param id - Our installation ID
   * @param query - `repo=owner/name`
   * @returns Branch names
   */
  @Get('installations/:id/branches')
  async listBranches(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ListBranchesQueryDto,
  ): Promise<GithubBranchListResponse> {
    const installation = await this.installations.getForUser(user.id, id);
    try {
      return await this.repositories.branches(
        toGithubId(installation.githubInstallationId),
        query.repo,
      );
    } catch (error) {
      throw this.github.toHttpError(error, {
        code: 'REPO_NOT_ACCESSIBLE',
        message: "This repository doesn't exist or the Selfship app can't access it.",
      });
    }
  }
}
