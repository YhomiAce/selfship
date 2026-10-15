import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { GithubInstallation } from '@selfship/db';
import type { InstallationEvent, InstallationRepositoriesEvent } from '@selfship/github';
import { type GithubInstallationDto, GithubErrorCode } from '@selfship/shared';
import { PrismaService } from '../prisma/prisma.service';
import { GithubAppService } from './github-app.service';
import { toGithubId } from './github.constants';
import { GithubRepositoriesService } from './github-repositories.service';

/** Outcome of linking an installation after the GitHub redirect. */
export type ClaimResult = 'connected' | 'not-yours';

/**
 * Keeps our record of GitHub App installations in sync and decides who may
 * use them. A user may use an installation only after GitHub confirmed (via
 * the OAuth code at install time) that they can access it.
 */
@Injectable()
export class GithubInstallationsService {
  private readonly logger = new Logger(GithubInstallationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly github: GithubAppService,
    private readonly repositories: GithubRepositoriesService,
  ) {}

  /**
   * Links an installation to the signed-in user after GitHub redirects back.
   *
   * The `installation_id` in the redirect URL is user-controlled, so it's
   * only trusted if GitHub lists it among the installations of the user who
   * authorised with `code`.
   *
   * @param userId - Signed-in user
   * @param githubInstallationId - `installation_id` from the redirect
   * @param code - OAuth `code` from the redirect
   * @returns `connected`, or `not-yours` if GitHub doesn't confirm access
   * @throws {GithubApiError} If GitHub can't be reached or the code is invalid
   */
  async claim(userId: string, githubInstallationId: number, code: string): Promise<ClaimResult> {
    const accessible = await this.github.client.installationIdsForUserCode(code);
    if (!accessible.includes(githubInstallationId)) {
      this.logger.warn(
        `User ${userId} tried to claim installation ${githubInstallationId} they can't access`,
      );
      return 'not-yours';
    }

    await this.linkToUser(userId, githubInstallationId);
    return 'connected';
  }

  /**
   * Links every installation of this app that the authorising user can
   * access. Used by "Already installed? Link it", which works even when the
   * installation was made directly on github.com.
   *
   * @param userId - Signed-in user
   * @param code - OAuth code from the authorise redirect
   * @returns Number of installations linked (0 if the app isn't installed anywhere they can see)
   * @throws {GithubApiError} If GitHub can't be reached or the code is invalid
   */
  async claimAll(userId: string, code: string): Promise<number> {
    const ids = await this.github.client.installationIdsForUserCode(code);
    for (const id of ids) await this.linkToUser(userId, id);
    return ids.length;
  }

  /**
   * Records (or refreshes) an installation from GitHub and makes the user a member.
   * Only call after GitHub confirmed the user can access it.
   */
  private async linkToUser(userId: string, githubInstallationId: number): Promise<void> {
    const info = await this.github.client.getInstallation(githubInstallationId);
    const data = {
      accountLogin: info.accountLogin,
      accountType: info.accountType,
      accountAvatarUrl: info.accountAvatarUrl,
      repositorySelection: info.repositorySelection,
      suspendedAt: info.suspended ? new Date() : null,
      deletedAt: null,
    };
    const installation = await this.prisma.githubInstallation.upsert({
      where: { githubInstallationId: BigInt(githubInstallationId) },
      create: { githubInstallationId: BigInt(githubInstallationId), ...data },
      update: data,
    });
    await this.prisma.githubInstallationMember.upsert({
      where: { installationId_userId: { installationId: installation.id, userId } },
      create: { installationId: installation.id, userId },
      update: {},
    });
    await this.relinkProjects(userId, installation);
    await this.repositories.invalidate(githubInstallationId);
  }

  /**
   * Moves the user's projects from removed installations of the same GitHub
   * account to the new one. GitHub issues a new installation ID on reinstall,
   * so without this, projects would stay "GitHub access removed" forever.
   * Repository access is re-checked by GitHub on the next deploy/settings change.
   *
   * @param userId - User whose projects are moved
   * @param installation - The freshly connected installation
   * @returns Number of projects moved
   */
  private async relinkProjects(userId: string, installation: GithubInstallation): Promise<number> {
    const { count } = await this.prisma.project.updateMany({
      where: {
        userId,
        githubInstallationId: { not: installation.id },
        githubInstallation: { accountLogin: installation.accountLogin, deletedAt: { not: null } },
      },
      data: { githubInstallationId: installation.id },
    });
    if (count > 0)
      this.logger.log(`Re-linked ${count} project(s) to installation ${installation.id}`);
    return count;
  }

  /**
   * Lists installations the user may use (not uninstalled).
   *
   * @param userId - Signed-in user
   * @returns Installations, oldest first
   */
  async listForUser(userId: string): Promise<GithubInstallationDto[]> {
    const installations = await this.prisma.githubInstallation.findMany({
      where: { deletedAt: null, members: { some: { userId } } },
      orderBy: { createdAt: 'asc' },
    });
    return installations.map((installation) => this.toDto(installation));
  }

  /**
   * Loads an installation the user may use.
   *
   * @param userId - Signed-in user
   * @param installationId - Our installation ID
   * @param options.allowSuspended - Return suspended installations instead of failing
   * @returns The installation
   * @throws {NotFoundException} `INSTALLATION_NOT_FOUND` if missing, uninstalled or not shared with the user
   * @throws {ConflictException} `INSTALLATION_SUSPENDED` if suspended (unless allowed)
   */
  async getForUser(
    userId: string,
    installationId: string,
    options: { allowSuspended?: boolean } = {},
  ): Promise<GithubInstallation> {
    const installation = await this.prisma.githubInstallation.findFirst({
      where: { id: installationId, deletedAt: null, members: { some: { userId } } },
    });
    if (!installation) {
      throw new NotFoundException({
        code: GithubErrorCode.INSTALLATION_NOT_FOUND,
        message: 'This GitHub account is not connected. Connect it again from the project wizard.',
      });
    }
    if (installation.suspendedAt && !options.allowSuspended) {
      throw new ConflictException({
        code: GithubErrorCode.INSTALLATION_SUSPENDED,
        message: `The Selfship app is suspended on ${installation.accountLogin}. Unsuspend it on GitHub to continue.`,
      });
    }
    return installation;
  }

  /**
   * Applies an `installation` webhook (created, deleted, suspend, unsuspend…).
   *
   * @param event - Validated webhook payload
   */
  async applyInstallationEvent(event: InstallationEvent): Promise<void> {
    const githubId = BigInt(event.installation.id);
    const account = event.installation.account;

    if (event.action === 'deleted') {
      await this.prisma.githubInstallation.updateMany({
        where: { githubInstallationId: githubId },
        data: { deletedAt: new Date() },
      });
      if (this.github.isConfigured)
        this.github.client.forgetInstallationToken(event.installation.id);
      await this.repositories.invalidate(event.installation.id);
      return;
    }

    const suspendedAt =
      event.action === 'suspend'
        ? new Date()
        : event.action === 'unsuspend'
          ? null
          : event.installation.suspended_at
            ? new Date(event.installation.suspended_at)
            : null;

    const data = {
      accountLogin: account?.login ?? 'unknown',
      accountType: account?.type === 'Organization' ? 'Organization' : 'User',
      accountAvatarUrl: account?.avatar_url ?? null,
      repositorySelection: event.installation.repository_selection,
      suspendedAt,
      deletedAt: null,
    };
    await this.prisma.githubInstallation.upsert({
      where: { githubInstallationId: githubId },
      create: { githubInstallationId: githubId, ...data },
      update: data,
    });
    await this.repositories.invalidate(event.installation.id);
  }

  /**
   * Applies an `installation_repositories` webhook (repo access changed).
   *
   * @param event - Validated webhook payload
   */
  async applyRepositoriesEvent(event: InstallationRepositoriesEvent): Promise<void> {
    await this.prisma.githubInstallation.updateMany({
      where: { githubInstallationId: BigInt(event.installation.id) },
      data: { repositorySelection: event.repository_selection },
    });
    await this.repositories.invalidate(event.installation.id);
  }

  /**
   * Converts a record to the public DTO.
   *
   * @param installation - Database record
   * @returns DTO for the API
   */
  toDto(installation: GithubInstallation): GithubInstallationDto {
    const githubId = toGithubId(installation.githubInstallationId);
    const account = { login: installation.accountLogin, type: installation.accountType };
    return {
      id: installation.id,
      accountLogin: installation.accountLogin,
      accountType: installation.accountType === 'Organization' ? 'Organization' : 'User',
      accountAvatarUrl: installation.accountAvatarUrl,
      repositorySelection: installation.repositorySelection === 'all' ? 'all' : 'selected',
      suspended: installation.suspendedAt !== null,
      manageUrl: this.github.isConfigured ? this.github.client.manageUrl(githubId, account) : '',
    };
  }
}
