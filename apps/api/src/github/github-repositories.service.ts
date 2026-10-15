import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import type { GithubRepository } from '@selfship/github';
import type {
  GithubBranchListResponse,
  GithubRepositoryDto,
  GithubRepositoryListResponse,
  ListRepositoriesQuery,
} from '@selfship/shared';
import { REDIS_CLIENT } from '../redis/redis.constants';
import { GithubAppService } from './github-app.service';
import { REPOSITORY_CACHE_TTL_SECONDS } from './github.constants';

/**
 * Repository and branch listing for an installation.
 *
 * GitHub has no search on "repositories this installation can access", so we
 * fetch the full list (≤ 1 000), cache it in Redis for a few minutes, and
 * search/paginate locally. Webhooks clear the cache when access changes.
 */
@Injectable()
export class GithubRepositoriesService {
  private readonly logger = new Logger(GithubRepositoriesService.name);

  constructor(
    private readonly github: GithubAppService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /**
   * Lists repositories, most recently pushed first.
   *
   * @param githubInstallationId - GitHub installation ID
   * @param query - Search text and pagination
   * @returns One page of matching repositories
   * @throws {GithubApiError} If GitHub fails
   */
  async list(
    githubInstallationId: number,
    query: ListRepositoriesQuery,
  ): Promise<GithubRepositoryListResponse> {
    const all = await this.cachedRepositories(githubInstallationId);
    const search = query.search?.toLowerCase();
    const matching = search
      ? all.filter((repo) => repo.fullName.toLowerCase().includes(search))
      : all;
    const start = (query.page - 1) * query.pageSize;

    return {
      items: matching.slice(start, start + query.pageSize).map(toDto),
      total: matching.length,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /**
   * Lists branches of a repository, default branch first.
   *
   * @param githubInstallationId - GitHub installation ID
   * @param fullName - `owner/name`
   * @returns Branch names and the default branch
   * @throws {GithubApiError} 404 if the repository isn't accessible
   */
  async branches(
    githubInstallationId: number,
    fullName: string,
  ): Promise<GithubBranchListResponse> {
    const client = this.github.client;
    const [repository, branches] = await Promise.all([
      client.getRepository(githubInstallationId, fullName),
      client.listBranches(githubInstallationId, fullName),
    ]);
    const defaultBranch = repository.defaultBranch;
    const ordered = [
      defaultBranch,
      ...branches.filter((branch) => branch !== defaultBranch).sort(),
    ];
    return { items: branches.includes(defaultBranch) ? ordered : branches.sort(), defaultBranch };
  }

  /**
   * Drops the cached repository list (called when access changes).
   *
   * @param githubInstallationId - GitHub installation ID
   */
  async invalidate(githubInstallationId: number): Promise<void> {
    try {
      await this.redis.del(cacheKey(githubInstallationId));
    } catch (error) {
      // A stale cache only means a slightly outdated list; never fail the caller.
      this.logger.warn(`Could not clear repository cache: ${String(error)}`);
    }
  }

  /** Full repository list, from Redis when fresh. Cache failures fall back to GitHub. */
  private async cachedRepositories(githubInstallationId: number): Promise<GithubRepository[]> {
    const key = cacheKey(githubInstallationId);
    try {
      const cached = await this.redis.get(key);
      if (cached) return JSON.parse(cached) as GithubRepository[];
    } catch (error) {
      this.logger.warn(`Repository cache read failed: ${String(error)}`);
    }

    const repositories = await this.github.client.listRepositories(githubInstallationId);
    repositories.sort((a, b) => (b.pushedAt ?? '').localeCompare(a.pushedAt ?? ''));

    try {
      await this.redis.set(key, JSON.stringify(repositories), 'EX', REPOSITORY_CACHE_TTL_SECONDS);
    } catch (error) {
      this.logger.warn(`Repository cache write failed: ${String(error)}`);
    }
    return repositories;
  }
}

/** Redis key for an installation's repository list. */
function cacheKey(githubInstallationId: number): string {
  return `github:repos:${githubInstallationId}`;
}

/** Maps a repository to the public DTO. */
function toDto(repo: GithubRepository): GithubRepositoryDto {
  return {
    id: repo.id,
    name: repo.name,
    fullName: repo.fullName,
    private: repo.private,
    defaultBranch: repo.defaultBranch,
    pushedAt: repo.pushedAt,
  };
}
