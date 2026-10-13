import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { AppConfigService } from '../config/app-config.service';

/** Identity returned by GitHub after a successful sign-in. */
export interface GithubProfile {
  /** GitHub's stable numeric user ID, as a string. */
  id: string;
  login: string;
  name: string;
  /** Primary email, only if GitHub reports it as verified. */
  verifiedEmail: string | null;
  avatarUrl: string | null;
}

/** Thrown when any step of the GitHub OAuth exchange fails. */
export class GithubOAuthError extends Error {
  override name = 'GithubOAuthError';
}

// Responses from GitHub are untrusted input, so they're validated with zod.
const TokenResponseSchema = z.union([
  z.object({ access_token: z.string().min(1) }),
  z.object({ error: z.string(), error_description: z.string().optional() }),
]);

const UserResponseSchema = z.object({
  id: z.number(),
  login: z.string(),
  name: z.string().nullable(),
  avatar_url: z.string().nullable(),
});

const EmailsResponseSchema = z.array(
  z.object({ email: z.string(), primary: z.boolean(), verified: z.boolean() }),
);

const GITHUB_API_HEADERS = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'selfship-auth',
} as const;

/**
 * GitHub OAuth web flow for "Sign in with GitHub".
 *
 * Works with a GitHub OAuth App or a GitHub App's user authorization, since
 * both use the same endpoints. We only read the profile and verified email;
 * the user's access token is discarded after sign-in.
 */
@Injectable()
export class GithubOAuthService {
  private readonly logger = new Logger(GithubOAuthService.name);

  constructor(private readonly config: AppConfigService) {}

  /** Whether GitHub credentials are configured. */
  get isEnabled(): boolean {
    return Boolean(this.config.get('GITHUB_CLIENT_ID') && this.config.get('GITHUB_CLIENT_SECRET'));
  }

  /**
   * Callback URL registered on GitHub. It goes through the web app's `/api`
   * rewrite so the session cookie is set on the web origin.
   */
  get callbackUrl(): string {
    return `${this.config.get('WEB_URL')}/api/auth/github/callback`;
  }

  /**
   * Builds the GitHub authorize URL to redirect the user to.
   *
   * @param state - Random value tied to the browser via a cookie (CSRF protection)
   * @returns Absolute URL on github.com
   */
  authorizeUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.config.get('GITHUB_CLIENT_ID') ?? '',
      redirect_uri: this.callbackUrl,
      scope: 'read:user user:email',
      state,
      allow_signup: 'true',
    });
    return `https://github.com/login/oauth/authorize?${params.toString()}`;
  }

  /**
   * Exchanges the authorization code for the user's GitHub profile.
   *
   * @param code - `code` query parameter from the callback
   * @returns Profile with the verified primary email, if any
   * @throws {GithubOAuthError} If GitHub rejects the code or returns unexpected data
   */
  async fetchProfile(code: string): Promise<GithubProfile> {
    const accessToken = await this.exchangeCode(code);
    const [user, emails] = await Promise.all([
      this.getJson('https://api.github.com/user', accessToken, UserResponseSchema),
      this.getJson('https://api.github.com/user/emails', accessToken, EmailsResponseSchema),
    ]);
    const primary = emails.find((email) => email.primary && email.verified);

    return {
      id: String(user.id),
      login: user.login,
      name: user.name?.trim() || user.login,
      verifiedEmail: primary ? primary.email.toLowerCase() : null,
      avatarUrl: user.avatar_url,
    };
  }

  /** Trades the one-time code for an access token. */
  private async exchangeCode(code: string): Promise<string> {
    const response = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: this.config.get('GITHUB_CLIENT_ID'),
        client_secret: this.config.get('GITHUB_CLIENT_SECRET'),
        code,
        redirect_uri: this.callbackUrl,
      }),
    });
    const parsed = TokenResponseSchema.safeParse(await response.json().catch(() => null));
    if (!parsed.success || 'error' in parsed.data) {
      const reason = parsed.success && 'error' in parsed.data ? parsed.data.error : 'bad response';
      this.logger.warn(`GitHub code exchange failed: ${reason}`);
      throw new GithubOAuthError(`Code exchange failed: ${reason}`);
    }
    return parsed.data.access_token;
  }

  /** GETs a GitHub API endpoint and validates the JSON body. */
  private async getJson<T>(url: string, accessToken: string, schema: z.ZodType<T>): Promise<T> {
    const response = await fetch(url, {
      headers: { ...GITHUB_API_HEADERS, Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) throw new GithubOAuthError(`${url} returned ${response.status}`);
    const parsed = schema.safeParse(await response.json());
    if (!parsed.success) throw new GithubOAuthError(`${url} returned an unexpected body`);
    return parsed.data;
  }
}
