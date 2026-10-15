/** Injection token for the GitHub App client (`GithubAppClient | null`). */
export const GITHUB_CLIENT = Symbol('GITHUB_CLIENT');

/** Cookie holding the CSRF state for the "install the app" round trip. */
export const GITHUB_INSTALL_STATE_COOKIE = 'gh_install_state';

/** Lifetime of the install state cookie. */
export const GITHUB_INSTALL_STATE_TTL_MS = 15 * 60 * 1000;

/** How long an installation's repository list is cached in Redis. */
export const REPOSITORY_CACHE_TTL_SECONDS = 300;

/**
 * Converts a GitHub numeric ID stored as BigInt to a JS number. GitHub IDs
 * are far below 2^53, so this is exact.
 *
 * @param id - BigInt from the database
 * @returns The same ID as a number
 */
export function toGithubId(id: bigint): number {
  return Number(id);
}
