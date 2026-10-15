import type {
  GithubBranchListResponse,
  GithubInstallationListResponse,
  GithubRepositoryListResponse,
  GithubStatusResponse,
} from '@selfship/shared';
import { apiFetch } from '@/lib/api-client';

/** Typed wrappers around the API's `/github` endpoints. */
export const githubApi = {
  /** Whether the server has a GitHub App configured. */
  status: (): Promise<GithubStatusResponse> => apiFetch('/github/status'),

  /** GitHub accounts the user has connected. */
  installations: (): Promise<GithubInstallationListResponse> => apiFetch('/github/installations'),

  /** One page of repositories, optionally filtered by `search`. */
  repositories: (
    installationId: string,
    params: { search?: string; page?: number; pageSize?: number },
  ): Promise<GithubRepositoryListResponse> => {
    const query = new URLSearchParams();
    if (params.search) query.set('search', params.search);
    if (params.page) query.set('page', String(params.page));
    if (params.pageSize) query.set('pageSize', String(params.pageSize));
    return apiFetch(
      `/github/installations/${encodeURIComponent(installationId)}/repositories?${query.toString()}`,
    );
  },

  /** Branches of a repository, default branch first. */
  branches: (installationId: string, repoFullName: string): Promise<GithubBranchListResponse> =>
    apiFetch(
      `/github/installations/${encodeURIComponent(installationId)}/branches?repo=${encodeURIComponent(repoFullName)}`,
    ),

  /** URL that starts installing the GitHub App (full-page navigation). */
  installUrl: '/api/github/install',

  /** URL that links installations made earlier or directly on github.com. */
  linkUrl: '/api/github/link',
};
