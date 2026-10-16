import type { KeyObject } from 'node:crypto';
import { z } from 'zod';
import { GithubApiError } from './errors';
import { createAppJwt, parsePrivateKey } from './jwt';

/** Configuration for {@link GithubAppClient}. */
export interface GithubAppConfig {
  appId: string;
  /** App slug, from `https://github.com/apps/<slug>` (needed for {@link GithubAppClient.installUrl}). */
  slug?: string;
  /**
   * OAuth client ID/secret of the app (needed to verify who installed it).
   * The worker only clones repositories, so it can leave these out.
   */
  clientId?: string;
  clientSecret?: string;
  /** Private key (PEM). */
  privateKey: string;
  /** REST API base URL. Default `https://api.github.com` (change for GitHub Enterprise). */
  apiUrl?: string;
  /** Web base URL. Default `https://github.com`. */
  webUrl?: string;
  /** Per-request timeout in ms. Default 15 000. */
  timeoutMs?: number;
  /** Injectable fetch (tests). */
  fetch?: typeof fetch;
}

/** A repository an installation can access. */
export interface GithubRepository {
  id: number;
  name: string;
  fullName: string;
  owner: string;
  private: boolean;
  defaultBranch: string;
  pushedAt: string | null;
}

/** A commit, as shown on a deployment. */
export interface GithubCommit {
  sha: string;
  /** First line of the commit message. */
  message: string;
  /** GitHub login if linked to an account, otherwise the git author name. */
  author: string | null;
}

/** An entry in a directory listing. */
export interface GithubDirEntry {
  name: string;
  path: string;
  type: 'file' | 'dir' | 'symlink' | 'submodule';
  size: number;
}

/** Installation details (account, repository selection, suspension). */
export interface GithubInstallationInfo {
  id: number;
  accountLogin: string;
  accountType: 'User' | 'Organization';
  accountAvatarUrl: string | null;
  repositorySelection: 'all' | 'selected';
  suspended: boolean;
}

// ── Response schemas: GitHub responses are untrusted input ───────────────────

const TokenResponseSchema = z.object({ token: z.string(), expires_at: z.string() });

const RepositorySchema = z.object({
  id: z.number(),
  name: z.string(),
  full_name: z.string(),
  owner: z.object({ login: z.string() }),
  private: z.boolean(),
  default_branch: z.string(),
  pushed_at: z.string().nullable().optional(),
});

const RepositoryPageSchema = z.object({
  total_count: z.number(),
  repositories: z.array(RepositorySchema),
});

const BranchSchema = z.object({ name: z.string() });

const CommitSchema = z.object({
  sha: z.string().regex(/^[0-9a-f]{40}$/),
  commit: z.object({
    message: z.string(),
    author: z.object({ name: z.string() }).nullable().optional(),
  }),
  author: z.object({ login: z.string() }).nullable().optional(),
});

const DirEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
  type: z.enum(['file', 'dir', 'symlink', 'submodule']),
  size: z.number().catch(0),
});

const FileContentSchema = z.object({
  type: z.literal('file'),
  encoding: z.string(),
  content: z.string(),
  size: z.number(),
});

const InstallationSchema = z.object({
  id: z.number(),
  account: z
    .object({ login: z.string(), type: z.string(), avatar_url: z.string().nullable().optional() })
    .nullable(),
  repository_selection: z.enum(['all', 'selected']).catch('selected'),
  suspended_at: z.string().nullable().optional(),
});

const UserInstallationsPageSchema = z.object({
  total_count: z.number(),
  installations: z.array(z.object({ id: z.number() })),
});

const OAuthTokenSchema = z.union([
  z.object({ access_token: z.string().min(1) }),
  z.object({ error: z.string() }),
]);

/** Upper bounds on pagination so a huge account can't stall a request. */
const MAX_REPOSITORY_PAGES = 10; // 1 000 repositories
const MAX_BRANCH_PAGES = 5; // 500 branches
const MAX_INSTALLATION_PAGES = 5;

/** Refresh installation tokens this long before they expire. */
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;

interface CachedToken {
  token: string;
  expiresAt: number;
}

/**
 * Minimal GitHub App client for what Selfship needs: authenticate as the
 * app, mint installation tokens, list repositories and branches, read files,
 * and verify who installed the app.
 *
 * Installation tokens are cached **in memory only** until shortly before
 * they expire (GitHub issues them for 1 hour). They are never persisted.
 */
export class GithubAppClient {
  private readonly key: KeyObject;
  private readonly apiUrl: string;
  private readonly webUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly tokens = new Map<number, CachedToken>();
  /** In-flight token requests, so concurrent callers share one request. */
  private readonly pendingTokens = new Map<number, Promise<string>>();

  /**
   * @param config - App credentials and options
   * @throws {Error} If the private key is invalid
   */
  constructor(private readonly config: GithubAppConfig) {
    this.key = parsePrivateKey(config.privateKey);
    this.apiUrl = (config.apiUrl ?? 'https://api.github.com').replace(/\/+$/, '');
    this.webUrl = (config.webUrl ?? 'https://github.com').replace(/\/+$/, '');
    this.timeoutMs = config.timeoutMs ?? 15_000;
    this.fetchImpl = config.fetch ?? fetch;
  }

  /**
   * URL that starts the "install the app" flow on GitHub.
   *
   * @param state - CSRF state, echoed back to the setup URL
   * @returns Absolute URL
   */
  installUrl(state: string): string {
    return `${this.webUrl}/apps/${encodeURIComponent(this.required('slug'))}/installations/new?state=${encodeURIComponent(state)}`;
  }

  /**
   * URL that asks the user to authorise the app (no installation step). Used
   * to link installations that already exist, e.g. ones made on github.com.
   * `redirectUri` must be one of the app's registered Callback URLs.
   *
   * @param state - CSRF state, echoed back to `redirectUri`
   * @param redirectUri - Where GitHub sends the user with `?code=…&state=…`
   * @returns Absolute URL
   */
  authorizeUrl(state: string, redirectUri: string): string {
    const params = new URLSearchParams({
      client_id: this.required('clientId'),
      redirect_uri: redirectUri,
      state,
    });
    return `${this.webUrl}/login/oauth/authorize?${params.toString()}`;
  }

  /**
   * URL where the account owner manages which repositories the app can access.
   *
   * @param installationId - GitHub installation ID
   * @param account - Account login and type
   * @returns Absolute URL
   */
  manageUrl(installationId: number, account: { login: string; type: string }): string {
    return account.type === 'Organization'
      ? `${this.webUrl}/organizations/${encodeURIComponent(account.login)}/settings/installations/${installationId}`
      : `${this.webUrl}/settings/installations/${installationId}`;
  }

  /**
   * Fetches installation details using the app's own credentials.
   *
   * @param installationId - GitHub installation ID
   * @returns Installation info
   * @throws {GithubApiError} 404 if the installation no longer exists
   */
  async getInstallation(installationId: number): Promise<GithubInstallationInfo> {
    const data = await this.request(
      `/app/installations/${installationId}`,
      { authorization: `Bearer ${createAppJwt(this.config.appId, this.key)}` },
      InstallationSchema,
    );
    return {
      id: data.id,
      accountLogin: data.account?.login ?? 'unknown',
      accountType: data.account?.type === 'Organization' ? 'Organization' : 'User',
      accountAvatarUrl: data.account?.avatar_url ?? null,
      repositorySelection: data.repository_selection,
      suspended: Boolean(data.suspended_at),
    };
  }

  /**
   * Returns a token for acting on an installation's repositories, from the
   * in-memory cache when still valid.
   *
   * @param installationId - GitHub installation ID
   * @returns Installation access token (valid ≥ 5 more minutes)
   * @throws {GithubApiError} If GitHub refuses (e.g. installation deleted/suspended)
   */
  async getInstallationToken(installationId: number): Promise<string> {
    const cached = this.tokens.get(installationId);
    if (cached && cached.expiresAt - TOKEN_REFRESH_MARGIN_MS > Date.now()) return cached.token;

    const pending = this.pendingTokens.get(installationId);
    if (pending) return pending;

    const request = this.request(
      `/app/installations/${installationId}/access_tokens`,
      { authorization: `Bearer ${createAppJwt(this.config.appId, this.key)}`, method: 'POST' },
      TokenResponseSchema,
    )
      .then((data) => {
        const expiresAt = Date.parse(data.expires_at);
        this.tokens.set(installationId, {
          token: data.token,
          // If GitHub sends an unparseable date, assume the documented 1 hour.
          expiresAt: Number.isNaN(expiresAt) ? Date.now() + 60 * 60 * 1000 : expiresAt,
        });
        return data.token;
      })
      .finally(() => this.pendingTokens.delete(installationId));

    this.pendingTokens.set(installationId, request);
    return request;
  }

  /**
   * Forgets a cached token (e.g. after the installation was deleted).
   *
   * @param installationId - GitHub installation ID
   */
  forgetInstallationToken(installationId: number): void {
    this.tokens.delete(installationId);
  }

  /**
   * Lists every repository the installation can access (up to 1 000).
   *
   * @param installationId - GitHub installation ID
   * @returns Repositories, in GitHub's order
   */
  async listRepositories(installationId: number): Promise<GithubRepository[]> {
    const repositories: GithubRepository[] = [];
    for (let page = 1; page <= MAX_REPOSITORY_PAGES; page++) {
      const data = await this.installationRequest(
        installationId,
        `/installation/repositories?per_page=100&page=${page}`,
        RepositoryPageSchema,
      );
      repositories.push(...data.repositories.map(toRepository));
      if (data.repositories.length < 100 || repositories.length >= data.total_count) break;
    }
    return repositories;
  }

  /**
   * Fetches one repository (also proves the installation can access it).
   *
   * @param installationId - GitHub installation ID
   * @param fullName - `owner/name`
   * @returns The repository
   * @throws {GithubApiError} 404 if it doesn't exist or isn't accessible
   */
  async getRepository(installationId: number, fullName: string): Promise<GithubRepository> {
    const data = await this.installationRequest(
      installationId,
      `/repos/${repoPath(fullName)}`,
      RepositorySchema,
    );
    return toRepository(data);
  }

  /**
   * Lists branch names (up to 500).
   *
   * @param installationId - GitHub installation ID
   * @param fullName - `owner/name`
   * @returns Branch names
   */
  async listBranches(installationId: number, fullName: string): Promise<string[]> {
    const branches: string[] = [];
    for (let page = 1; page <= MAX_BRANCH_PAGES; page++) {
      const data = await this.installationRequest(
        installationId,
        `/repos/${repoPath(fullName)}/branches?per_page=100&page=${page}`,
        z.array(BranchSchema),
      );
      branches.push(...data.map((branch) => branch.name));
      if (data.length < 100) break;
    }
    return branches;
  }

  /**
   * Resolves a branch, tag or SHA to its commit.
   *
   * @param installationId - GitHub installation ID
   * @param fullName - `owner/name`
   * @param ref - Branch, tag or commit SHA
   * @returns The commit (full SHA, first message line, author)
   * @throws {GithubApiError} 404/422 if the ref doesn't exist
   */
  async getCommit(installationId: number, fullName: string, ref: string): Promise<GithubCommit> {
    const data = await this.installationRequest(
      installationId,
      `/repos/${repoPath(fullName)}/commits/${encodePath(ref)}`,
      CommitSchema,
    );
    return {
      sha: data.sha,
      message: (data.commit.message.split('\n')[0] ?? '').slice(0, 300),
      author: data.author?.login ?? data.commit.author?.name ?? null,
    };
  }

  /**
   * HTTPS URL for cloning a repository (credentials are sent separately, never in the URL).
   *
   * @param fullName - `owner/name`
   * @returns Clone URL
   */
  cloneUrl(fullName: string): string {
    return `${this.webUrl}/${repoPath(fullName)}.git`;
  }

  /**
   * Checks that a branch exists.
   *
   * @param installationId - GitHub installation ID
   * @param fullName - `owner/name`
   * @param branch - Branch name
   * @returns True if it exists
   */
  async branchExists(installationId: number, fullName: string, branch: string): Promise<boolean> {
    try {
      await this.installationRequest(
        installationId,
        `/repos/${repoPath(fullName)}/branches/${encodePath(branch)}`,
        BranchSchema,
      );
      return true;
    } catch (error) {
      if (error instanceof GithubApiError && error.isNotFound) return false;
      throw error;
    }
  }

  /**
   * Lists a directory at a given ref.
   *
   * @param installationId - GitHub installation ID
   * @param fullName - `owner/name`
   * @param path - Directory path ('' for the repository root)
   * @param ref - Branch, tag or commit
   * @returns Entries, or `null` if the path doesn't exist or isn't a directory
   */
  async listDirectory(
    installationId: number,
    fullName: string,
    path: string,
    ref: string,
  ): Promise<GithubDirEntry[] | null> {
    try {
      const data = await this.installationRequest(
        installationId,
        `${contentsPath(fullName, path)}?ref=${encodeURIComponent(ref)}`,
        z.unknown(),
      );
      const parsed = z.array(DirEntrySchema).safeParse(data);
      return parsed.success ? parsed.data : null; // an object means "this is a file"
    } catch (error) {
      if (error instanceof GithubApiError && error.isNotFound) return null;
      throw error;
    }
  }

  /**
   * Reads a text file at a given ref.
   *
   * @param installationId - GitHub installation ID
   * @param fullName - `owner/name`
   * @param path - File path from the repository root
   * @param ref - Branch, tag or commit
   * @param maxBytes - Larger files are skipped (default 512 KB)
   * @returns UTF-8 contents, or `null` if missing, not a file, or too large
   */
  async readFile(
    installationId: number,
    fullName: string,
    path: string,
    ref: string,
    maxBytes = 512 * 1024,
  ): Promise<string | null> {
    try {
      const data = await this.installationRequest(
        installationId,
        `${contentsPath(fullName, path)}?ref=${encodeURIComponent(ref)}`,
        z.unknown(),
      );
      const parsed = FileContentSchema.safeParse(data);
      if (!parsed.success || parsed.data.size > maxBytes || parsed.data.encoding !== 'base64') {
        return null;
      }
      return Buffer.from(parsed.data.content, 'base64').toString('utf8');
    } catch (error) {
      if (error instanceof GithubApiError && error.isNotFound) return null;
      throw error;
    }
  }

  /**
   * Exchanges the `code` GitHub adds to the setup URL for a user token, then
   * returns the IDs of installations that user can access. This is how we
   * prove an `installation_id` in the URL really belongs to the person
   * signed in, rather than trusting a value anyone could edit.
   *
   * The user token is used for this one call and then discarded.
   *
   * @param code - `code` query parameter from the setup redirect
   * @returns GitHub installation IDs the user can access
   * @throws {GithubApiError} If the code is invalid/expired or GitHub fails
   */
  async installationIdsForUserCode(code: string): Promise<number[]> {
    const tokenData = await this.request(
      `${this.webUrl}/login/oauth/access_token`,
      {
        method: 'POST',
        body: {
          client_id: this.required('clientId'),
          client_secret: this.required('clientSecret'),
          code,
        },
        absolute: true,
      },
      OAuthTokenSchema,
    );
    if ('error' in tokenData)
      throw new GithubApiError(`OAuth code exchange failed: ${tokenData.error}`, 400);

    const ids: number[] = [];
    for (let page = 1; page <= MAX_INSTALLATION_PAGES; page++) {
      const data = await this.request(
        `/user/installations?per_page=100&page=${page}`,
        { authorization: `Bearer ${tokenData.access_token}` },
        UserInstallationsPageSchema,
      );
      ids.push(...data.installations.map((installation) => installation.id));
      if (data.installations.length < 100 || ids.length >= data.total_count) break;
    }
    return ids;
  }

  /** A config value only some features need; throws a clear error when it's missing. */
  private required(name: 'slug' | 'clientId' | 'clientSecret'): string {
    const value = this.config[name];
    if (!value) throw new Error(`GitHub App ${name} is not configured`);
    return value;
  }

  /** Authenticated request on behalf of an installation. Retries once on 401. */
  private async installationRequest<T>(
    installationId: number,
    path: string,
    schema: z.ZodType<T>,
  ): Promise<T> {
    const token = await this.getInstallationToken(installationId);
    try {
      return await this.request(path, { authorization: `token ${token}` }, schema);
    } catch (error) {
      // A cached token can be revoked early (e.g. permissions changed): refresh once.
      if (error instanceof GithubApiError && error.status === 401) {
        this.forgetInstallationToken(installationId);
        const fresh = await this.getInstallationToken(installationId);
        return this.request(path, { authorization: `token ${fresh}` }, schema);
      }
      throw error;
    }
  }

  /**
   * Performs a request with a timeout and validates the JSON response.
   * Error messages never include tokens or response bodies.
   */
  private async request<T>(
    pathOrUrl: string,
    options: { authorization?: string; method?: string; body?: object; absolute?: boolean },
    schema: z.ZodType<T>,
  ): Promise<T> {
    const url = options.absolute ? pathOrUrl : `${this.apiUrl}${pathOrUrl}`;
    const label = `${options.method ?? 'GET'} ${options.absolute ? new URL(pathOrUrl).pathname : (pathOrUrl.split('?')[0] ?? '')}`;

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: options.method ?? 'GET',
        headers: {
          Accept: options.absolute ? 'application/json' : 'application/vnd.github+json',
          'User-Agent': 'selfship',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(options.authorization ? { Authorization: options.authorization } : {}),
          ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(options.body ? { body: JSON.stringify(options.body) } : {}),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      const reason =
        error instanceof Error && error.name === 'TimeoutError' ? 'timed out' : 'network error';
      throw new GithubApiError(`${label}: ${reason}`, 0);
    }

    if (!response.ok)
      throw new GithubApiError(`${label}: HTTP ${response.status}`, response.status);

    const parsed = schema.safeParse(await response.json().catch(() => undefined));
    if (!parsed.success) throw new GithubApiError(`${label}: unexpected response body`, 502);
    return parsed.data;
  }
}

/** Maps GitHub's repository shape to ours. */
function toRepository(data: z.infer<typeof RepositorySchema>): GithubRepository {
  return {
    id: data.id,
    name: data.name,
    fullName: data.full_name,
    owner: data.owner.login,
    private: data.private,
    defaultBranch: data.default_branch,
    pushedAt: data.pushed_at ?? null,
  };
}

/**
 * Encodes each segment of a slash-separated path.
 *
 * @throws {GithubApiError} For `.`/`..` segments, which URL parsing would resolve away
 */
function encodePath(path: string): string {
  const segments = path.split('/');
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    throw new GithubApiError(`Invalid path: ${path}`, 400);
  }
  return segments.map(encodeURIComponent).join('/');
}

/**
 * `owner/name` → URL path with each part encoded.
 *
 * @throws {GithubApiError} For names that would change the URL path (`.`/`..`,
 *   extra slashes); callers validate first, this is defence in depth.
 */
function repoPath(fullName: string): string {
  const parts = fullName.split('/');
  const [owner = '', name = ''] = parts;
  if (parts.length !== 2 || !owner || !name || [owner, name].some((p) => p === '.' || p === '..')) {
    throw new GithubApiError(`Invalid repository name: ${fullName}`, 400);
  }
  return `${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
}

/** Contents API path for a file or directory ('' = repository root). */
function contentsPath(fullName: string, path: string): string {
  const clean = path.replace(/^\/+|\/+$/g, '');
  return `/repos/${repoPath(fullName)}/contents${clean ? `/${encodePath(clean)}` : ''}`;
}
