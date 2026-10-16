import {
  GithubApiError,
  type GithubCommit,
  type GithubDirEntry,
  type GithubInstallationInfo,
  type GithubRepository,
} from '@selfship/github';

/** A repository in the fake GitHub: metadata, branches and files per branch. */
export interface FakeRepo {
  repo: GithubRepository;
  branches: string[];
  /** path → contents, the same for every branch (enough for tests). */
  files: Record<string, string>;
}

/**
 * In-memory stand-in for `GithubAppClient`, used by e2e tests and shaped
 * exactly like the methods the API calls.
 */
export class FakeGithubClient {
  /** installationId → info */
  readonly installations = new Map<number, GithubInstallationInfo>();
  /** installationId → repos it can access */
  readonly repos = new Map<number, FakeRepo[]>();
  /** OAuth code → installation IDs that user can access */
  readonly codes = new Map<string, number[]>();
  listRepositoriesCalls = 0;

  installUrl(state: string): string {
    return `https://github.example/apps/selfship-test/installations/new?state=${state}`;
  }

  authorizeUrl(state: string, redirectUri: string): string {
    return `https://github.example/login/oauth/authorize?state=${state}&redirect_uri=${encodeURIComponent(redirectUri)}`;
  }

  manageUrl(installationId: number): string {
    return `https://github.example/settings/installations/${installationId}`;
  }

  forgetInstallationToken(): void {
    // nothing cached in the fake
  }

  installationIdsForUserCode(code: string): Promise<number[]> {
    const ids = this.codes.get(code);
    return ids ? Promise.resolve(ids) : Promise.reject(new GithubApiError('bad code', 400));
  }

  getInstallation(id: number): Promise<GithubInstallationInfo> {
    const info = this.installations.get(id);
    return info ? Promise.resolve(info) : Promise.reject(new GithubApiError('not found', 404));
  }

  listRepositories(id: number): Promise<GithubRepository[]> {
    this.listRepositoriesCalls++;
    return Promise.resolve((this.repos.get(id) ?? []).map((r) => r.repo));
  }

  getRepository(id: number, fullName: string): Promise<GithubRepository> {
    const found = this.find(id, fullName);
    return found
      ? Promise.resolve(found.repo)
      : Promise.reject(new GithubApiError('not found', 404));
  }

  listBranches(id: number, fullName: string): Promise<string[]> {
    const found = this.find(id, fullName);
    return found
      ? Promise.resolve(found.branches)
      : Promise.reject(new GithubApiError('not found', 404));
  }

  branchExists(id: number, fullName: string, branch: string): Promise<boolean> {
    return Promise.resolve(this.find(id, fullName)?.branches.includes(branch) ?? false);
  }

  listDirectory(id: number, fullName: string, path: string): Promise<GithubDirEntry[] | null> {
    const found = this.find(id, fullName);
    if (!found) return Promise.reject(new GithubApiError('not found', 404));
    const prefix = path ? `${path}/` : '';
    const names = new Map<string, GithubDirEntry['type']>();
    for (const filePath of Object.keys(found.files)) {
      if (!filePath.startsWith(prefix)) continue;
      const rest = filePath.slice(prefix.length);
      const [first = '', ...more] = rest.split('/');
      names.set(first, more.length > 0 ? 'dir' : 'file');
    }
    if (names.size === 0) return Promise.resolve(null);
    return Promise.resolve(
      [...names].map(([name, type]) => ({ name, type, path: `${prefix}${name}`, size: 1 })),
    );
  }

  getCommit(id: number, fullName: string, ref: string): Promise<GithubCommit> {
    const found = this.find(id, fullName);
    if (!found?.branches.includes(ref)) return Promise.reject(new GithubApiError('not found', 404));
    return Promise.resolve({
      sha: String(found.repo.id).padEnd(40, 'c').slice(0, 40),
      message: `Latest commit on ${ref}`,
      author: 'ada',
    });
  }

  readFile(id: number, fullName: string, path: string): Promise<string | null> {
    return Promise.resolve(this.find(id, fullName)?.files[path] ?? null);
  }

  private find(id: number, fullName: string): FakeRepo | undefined {
    return this.repos.get(id)?.find((r) => r.repo.fullName === fullName);
  }
}

/** Builds a repository fixture. */
export function fakeRepo(
  id: number,
  fullName: string,
  files: Record<string, string>,
  branches = ['main'],
): FakeRepo {
  const [owner = '', name = ''] = fullName.split('/');
  return {
    repo: {
      id,
      name,
      fullName,
      owner,
      private: true,
      defaultBranch: branches[0] ?? 'main',
      pushedAt: `2026-10-${10 + (id % 10)}T00:00:00Z`,
    },
    branches,
    files,
  };
}
