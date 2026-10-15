import { z } from 'zod';
import { RepoFullNameSchema } from '../projects/project.schemas';

/** Response of `GET /github/status`. */
export interface GithubStatusResponse {
  /** False when the server has no GitHub App credentials configured. */
  configured: boolean;
}

/** A GitHub account (user or organization) where the app is installed. */
export interface GithubInstallationDto {
  /** Our ID (use it in API calls). */
  id: string;
  accountLogin: string;
  accountType: 'User' | 'Organization';
  accountAvatarUrl: string | null;
  /** `all` repositories, or only `selected` ones. */
  repositorySelection: 'all' | 'selected';
  suspended: boolean;
  /** Link to change which repositories the app can access. */
  manageUrl: string;
}

/** Response of `GET /github/installations`. */
export interface GithubInstallationListResponse {
  items: GithubInstallationDto[];
}

/** A repository the app can access. */
export interface GithubRepositoryDto {
  id: number;
  name: string;
  fullName: string;
  private: boolean;
  defaultBranch: string;
  /** ISO 8601 timestamp of the last push, if known. */
  pushedAt: string | null;
}

/** Query of `GET /github/installations/:id/repositories`. */
export const ListRepositoriesQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListRepositoriesQuery = z.infer<typeof ListRepositoriesQuerySchema>;

/** Response of `GET /github/installations/:id/repositories`. */
export interface GithubRepositoryListResponse {
  items: GithubRepositoryDto[];
  total: number;
  page: number;
  pageSize: number;
}

/** Query of `GET /github/installations/:id/branches`. */
export const ListBranchesQuerySchema = z.object({ repo: RepoFullNameSchema });
export type ListBranchesQuery = z.infer<typeof ListBranchesQuerySchema>;

/** Response of `GET /github/installations/:id/branches`. */
export interface GithubBranchListResponse {
  items: string[];
  defaultBranch: string;
}

/** Error codes specific to the GitHub integration. */
export const GithubErrorCode = {
  GITHUB_NOT_CONFIGURED: 'GITHUB_NOT_CONFIGURED',
  GITHUB_UNAVAILABLE: 'GITHUB_UNAVAILABLE',
  INSTALLATION_NOT_FOUND: 'INSTALLATION_NOT_FOUND',
  INSTALLATION_SUSPENDED: 'INSTALLATION_SUSPENDED',
} as const;

/** `?github=` values the API appends when redirecting back after installation. */
export const GithubSetupResult = {
  CONNECTED: 'connected',
  PENDING: 'pending',
  ERROR: 'error',
} as const;
